# Secure host integration

The library is a decision component, not a complete authorization system. A secure host should treat the agent as untrusted and construct every `SalesAction` itself.

## Recommended sequence

1. Authenticate the internal caller and identify the tenant.
2. Parse only allow-listed proposal fields from the agent with `parseSalesAction` or
   `evaluateUnknown`; keep strict unknown-field rejection enabled.
3. Fetch the customer time zone, consent, opt-out state, and contact history from authoritative stores.
4. Create a proposed action with a unique, high-entropy action ID.
5. Evaluate it with a pinned policy version.
6. If the result is `review`, put the exact fingerprint and proposal into an authenticated review queue.
7. Issue approvals in a separate privilege boundary. Configure `approvalNonceConsumer` over a
   durable atomic insert or compare-and-set so the nonce is consumed exactly once.
8. In a transaction or race-safe outbox flow, refresh authoritative state, evaluate again, persist the minimized audit decision, and enqueue exactly the approved action.
9. Let the channel worker send only the immutable outbox payload.

## Untrusted input boundary

Use `parseSalesAction`, `parseSalesActionJson`, or `GuardrailEngine.evaluateUnknown` before any
untrusted JSON-shaped value reaches policy rules. The adapter returns a newly constructed object,
rejects unknown fields by default, and never includes rejected field names or values in its issues.
Provider metadata should be handled separately rather than disabling strict parsing globally.

The exported `SALES_ACTION_JSON_SCHEMA` is useful at an API gateway, but it does not replace the
package adapter's semantic validation.

## Race conditions

A basic "check, then send" flow can exceed a frequency limit when two workers evaluate concurrently. Use a customer-scoped lock, serializable transaction, atomic counter, or comparable mechanism around the final history check and outbox insertion. The correct mechanism depends on the host data store.

Consent can also change between initial evaluation and delivery. Re-evaluate close to the side effect and let opt-out or hard blocks win over an earlier approval.

The [`race-safe-outbox.mjs`](../examples/race-safe-outbox.mjs) reference defines the database-neutral
host contract. It intentionally does not include an in-memory store that could be mistaken for a
production transaction. See [OUTBOX_PATTERN.md](OUTBOX_PATTERN.md) for the required guarantees.

## Atomic approval nonce consumption

`ApprovalNonceConsumer.consume` must atomically insert a previously unseen nonce and return `true`,
or return `false` if it already exists. The uniqueness guarantee must cover every application
instance that can authorize the same side effect. Place the nonce insert in the same transaction as
the final authoritative state check, audit record, contact-history mutation, and outbox row whenever
the host architecture permits it.

When configured on `GuardrailEngine`, replay and consumer errors keep the action at `review`.
Approvals are not consumed when they cannot change a decision or when any rule has already blocked
the action. Without a consumer, v0.1-compatible verification remains available, and the manifest
reports `host-required` so the integration owns replay prevention explicitly.

## Data minimization

- Use pseudonymous customer IDs with high entropy.
- Do not add names, emails, phone numbers, documents, or free-form CRM notes to `CustomerContext`.
- Do not log the full `SalesAction` or approval secret.
- Store message content only where the product requires it, under explicit access and retention rules.
- Treat rule `details` as operational metadata, never a place for matched text.

## Approval secret lifecycle

The version 1 token format does not include a key ID. Use one active secret per isolated deployment and plan coordinated rotation. A future version is expected to add a versioned key identifier. Until then, rotate by temporarily evaluating against the previous secret only in a controlled compatibility layer, not by weakening verification.

The `approvedBy` field is an assertion from the host. Populate it from an authenticated identity and authorization check, never from agent-provided input.
