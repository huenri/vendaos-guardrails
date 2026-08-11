import { createAuditRecord, GuardrailEngine } from "../dist/index.js";

/**
 * Reference integration boundary. `store.withCustomerTransaction` must provide a serializable
 * transaction or a customer-scoped lock. The transaction methods shown here are host contracts,
 * not database implementations supplied by this package.
 */
export async function evaluateAndEnqueue({
  store,
  rules,
  policyVersion,
  approvalSecret,
  customerReference,
  untrustedProposal,
}) {
  return store.withCustomerTransaction(customerReference, async (transaction) => {
    const authoritative = await transaction.loadCustomerState(customerReference);

    // Copy only proposal fields the agent is allowed to suggest. Consent, opt-out state, time zone,
    // identity, and history always come from authoritative host stores inside this transaction.
    const candidate = {
      id: await transaction.createActionId(),
      customer: {
        id: authoritative.pseudonymousId,
        timezone: authoritative.timezone,
        locale: authoritative.locale,
        consent: authoritative.consent,
        optedOutChannels: authoritative.optedOutChannels,
      },
      channel: untrustedProposal?.channel,
      purpose: untrustedProposal?.purpose,
      content: untrustedProposal?.content,
      scheduledAt: untrustedProposal?.scheduledAt,
      contactHistory: authoritative.contactHistory,
      ...(untrustedProposal?.offer === undefined ? {} : { offer: untrustedProposal.offer }),
      ...(untrustedProposal?.approval === undefined
        ? {}
        : { approval: untrustedProposal.approval }),
    };

    const engine = new GuardrailEngine({
      rules,
      policyVersion,
      approvalSecret,
      // This must be backed by a unique constraint or compare-and-set in the same transaction.
      approvalNonceConsumer: {
        consume: (consumption) => transaction.consumeApprovalNonce(consumption),
      },
    });
    const evaluation = await engine.evaluateUnknown(candidate);

    if (evaluation.actionFingerprint === null) {
      await transaction.recordRejectedInput({
        policyVersion,
        code: evaluation.results[0]?.code ?? "INPUT_SCHEMA_REJECTED",
      });
      return evaluation;
    }

    const auditHead = await transaction.loadAuditHead();
    const auditRecord = createAuditRecord(candidate, evaluation, {
      sequence: auditHead === null ? 0 : auditHead.sequence + 1,
      previousHash: auditHead?.recordHash ?? null,
    });
    await transaction.appendAudit(auditRecord);

    if (evaluation.decision === "allow") {
      await transaction.insertOutbox({
        idempotencyKey: candidate.id,
        actionFingerprint: evaluation.actionFingerprint,
        policyVersion,
        channel: candidate.channel,
        payload: {
          content: candidate.content,
          scheduledAt: candidate.scheduledAt,
          offer: candidate.offer ?? null,
        },
      });
    }

    // Commit includes authoritative reads, nonce consumption, audit, and outbox insertion.
    return evaluation;
  });
}
