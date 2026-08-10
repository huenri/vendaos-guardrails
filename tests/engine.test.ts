import assert from "node:assert/strict";
import test from "node:test";

import {
  createActionFingerprint,
  createBrazilianPortuguesePolicy,
  GuardrailEngine,
  issueApproval,
  type GuardrailRule,
} from "../src/index.js";
import { makeAction } from "./fixtures.js";

const NOW = new Date("2026-08-10T12:00:00.000Z");
const APPROVAL_SECRET = "test-only-approval-secret-with-at-least-32-bytes";

function makeEngine(overrides: ConstructorParameters<typeof GuardrailEngine>[0] = {
  rules: createBrazilianPortuguesePolicy(),
}): GuardrailEngine {
  return new GuardrailEngine({
    policyVersion: "pt-BR-test-v1",
    clock: () => NOW,
    ...overrides,
  });
}

test("allows a conservative promotional action", async () => {
  const evaluation = await makeEngine().evaluate(makeAction());

  assert.equal(evaluation.decision, "allow");
  assert.equal(evaluation.results.length, 7);
  assert.ok(evaluation.results.every((entry) => entry.decision === "allow"));
  assert.match(evaluation.actionFingerprint ?? "", /^[a-f0-9]{64}$/u);
});

test("blocks opted-out promotional contact", async () => {
  const action = makeAction({
    customer: {
      ...makeAction().customer,
      optedOutChannels: ["whatsapp"],
    },
  });

  const evaluation = await makeEngine().evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.ok(evaluation.results.some((entry) => entry.code === "CHANNEL_OPTED_OUT"));
});

test("blocks marketing when consent is unknown", async () => {
  const action = makeAction({
    customer: {
      ...makeAction().customer,
      consent: { whatsapp: { marketing: { status: "unknown" } } },
    },
  });

  const evaluation = await makeEngine().evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.ok(evaluation.results.some((entry) => entry.code === "CONSENT_NOT_RECORDED"));
});

test("does not reuse a grant recorded for a different purpose", async () => {
  const action = makeAction({
    customer: {
      ...makeAction().customer,
      consent: { whatsapp: { sales_follow_up: { status: "granted" } } },
    },
  });

  const evaluation = await makeEngine().evaluate(action);
  assert.equal(evaluation.decision, "block");
  assert.ok(evaluation.results.some((entry) => entry.code === "CONSENT_NOT_RECORDED"));
});

test("does not apply promotional rules to transactional contact", async () => {
  const action = makeAction({
    purpose: "transactional",
    content: "Seu pedido foi confirmado.",
    scheduledAt: "2026-08-10T03:00:00.000Z",
    customer: {
      ...makeAction().customer,
      consent: {},
      optedOutChannels: ["whatsapp"],
    },
  });

  const evaluation = await makeEngine().evaluate(action);
  assert.equal(evaluation.decision, "allow");
});

test("requires review for a discount above automatic authority", async () => {
  const action = makeAction({ offer: { discountPercent: 20 } });
  const evaluation = await makeEngine().evaluate(action);

  assert.equal(evaluation.decision, "review");
  assert.ok(evaluation.results.some((entry) => entry.code === "DISCOUNT_REQUIRES_APPROVAL"));
});

test("accepts a signed approval bound to the exact action and rule", async () => {
  const unsignedAction = makeAction({ offer: { discountPercent: 20 } });
  const approval = issueApproval(
    {
      actionFingerprint: createActionFingerprint(unsignedAction),
      policyVersion: "pt-BR-test-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    APPROVAL_SECRET,
  );
  const action = { ...unsignedAction, approval };
  const evaluation = await makeEngine({
    rules: createBrazilianPortuguesePolicy(),
    policyVersion: "pt-BR-test-v1",
    clock: () => NOW,
    approvalSecret: APPROVAL_SECRET,
  }).evaluate(action);

  assert.equal(evaluation.decision, "allow");
  assert.equal(evaluation.approval.valid, true);
  assert.ok(
    evaluation.results.some(
      (entry) => entry.ruleId === "commercial.discount-authority" && entry.approvalApplied,
    ),
  );
});

test("rejects approval after message content changes", async () => {
  const original = makeAction({ offer: { discountPercent: 20 } });
  const approval = issueApproval(
    {
      actionFingerprint: createActionFingerprint(original),
      policyVersion: "pt-BR-test-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    APPROVAL_SECRET,
  );
  const changed = { ...original, content: `${original.content} Alterado.`, approval };
  const evaluation = await makeEngine({
    rules: createBrazilianPortuguesePolicy(),
    clock: () => NOW,
    approvalSecret: APPROVAL_SECRET,
  }).evaluate(changed);

  assert.equal(evaluation.decision, "review");
  assert.equal(evaluation.approval.reason, "fingerprint_mismatch");
});

test("does not let approval override a hard block", async () => {
  const original = makeAction({ offer: { discountPercent: 75 } });
  const approval = issueApproval(
    {
      actionFingerprint: createActionFingerprint(original),
      policyVersion: "pt-BR-test-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    APPROVAL_SECRET,
  );
  const evaluation = await makeEngine({
    rules: createBrazilianPortuguesePolicy(),
    clock: () => NOW,
    approvalSecret: APPROVAL_SECRET,
  }).evaluate({ ...original, approval });

  assert.equal(evaluation.approval.valid, true);
  assert.equal(evaluation.decision, "block");
  assert.ok(evaluation.results.some((entry) => entry.code === "DISCOUNT_HARD_LIMIT_EXCEEDED"));
});

test("fails closed when a rule throws", async () => {
  const brokenRule: GuardrailRule = {
    id: "test.broken",
    description: "Throws for testing.",
    evaluate() {
      throw new Error("sensitive internal detail");
    },
  };

  const evaluation = await makeEngine({ rules: [brokenRule], clock: () => NOW }).evaluate(makeAction());
  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "RULE_EXECUTION_FAILED");
  assert.doesNotMatch(evaluation.results[0]?.message ?? "", /sensitive internal detail/u);
});

test("can route rule failures to review when explicitly configured", async () => {
  const brokenRule: GuardrailRule = {
    id: "test.broken",
    description: "Throws for testing.",
    evaluate() {
      throw new Error("boom");
    },
  };

  const evaluation = await makeEngine({
    rules: [brokenRule],
    failureMode: "review",
    clock: () => NOW,
  }).evaluate(makeAction());
  assert.equal(evaluation.decision, "review");
});

test("blocks malformed timestamps before running policy rules", async () => {
  const action = makeAction({ scheduledAt: "2026-08-10T10:00:00" });
  const evaluation = await makeEngine().evaluate(action);

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.actionFingerprint, null);
  assert.equal(evaluation.results[0]?.code, "INVALID_SCHEDULE");
});

test("enforces a maximum message size", async () => {
  const evaluation = await makeEngine({
    rules: createBrazilianPortuguesePolicy(),
    maxContentLength: 10,
    clock: () => NOW,
  }).evaluate(makeAction());

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "INVALID_CONTENT");
});

test("enforces a maximum authoritative history size", async () => {
  const historyEntry = {
    at: "2026-08-09T13:00:00.000Z",
    channel: "email" as const,
    purpose: "transactional" as const,
  };
  const evaluation = await makeEngine({
    rules: createBrazilianPortuguesePolicy(),
    maxContactHistoryLength: 1,
    clock: () => NOW,
  }).evaluate(makeAction({ contactHistory: [historyEntry, historyEntry] }));

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "CONTACT_HISTORY_TOO_LARGE");
});

test("validates time zones even when promotional window rules do not apply", async () => {
  const action = makeAction({
    purpose: "transactional",
    customer: { ...makeAction().customer, timezone: "Mars/Olympus_Mons" },
  });
  const evaluation = await makeEngine().evaluate(action);

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "INVALID_TIMEZONE");
});

test("blocks malformed commercial totals before fingerprinting", async () => {
  const action = makeAction({ offer: { totalMinorUnits: Number.NaN, currency: "BRL" } });
  const evaluation = await makeEngine().evaluate(action);

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "INVALID_OFFER_TOTAL");
  assert.equal(evaluation.actionFingerprint, null);
});

test("treats a custom rule with an inherited decision name as malformed", async () => {
  const maliciousRule: GuardrailRule = {
    id: "test.inherited-decision",
    description: "Returns malformed runtime data for testing.",
    evaluate() {
      return {
        ruleId: "test.inherited-decision",
        decision: "__proto__",
        code: "INVALID",
        message: "Invalid decision",
      } as unknown as ReturnType<GuardrailRule["evaluate"]>;
    },
  };
  const evaluation = await makeEngine({ rules: [maliciousRule], clock: () => NOW }).evaluate(makeAction());

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.results[0]?.code, "RULE_EXECUTION_FAILED");
});

test("rejects duplicate rule IDs at construction", () => {
  const rule = createBrazilianPortuguesePolicy()[0];
  assert.ok(rule);
  assert.throws(() => new GuardrailEngine({ rules: [rule, rule] }), /unique/u);
});

test("fingerprints are deterministic and change with commercial terms", () => {
  const first = createActionFingerprint(makeAction({ offer: { discountPercent: 10 } }));
  const repeated = createActionFingerprint(makeAction({ offer: { discountPercent: 10 } }));
  const changed = createActionFingerprint(makeAction({ offer: { discountPercent: 11 } }));

  assert.equal(first, repeated);
  assert.notEqual(first, changed);
});

test("fingerprints bind every policy-relevant action context", () => {
  const original = makeAction({ offer: { discountPercent: 10, totalMinorUnits: 9_000, currency: "BRL" } });
  const originalFingerprint = createActionFingerprint(original);
  const mutations = [
    makeAction({ ...original, id: "different-action" }),
    makeAction({ ...original, customer: { ...original.customer, id: "different-customer" } }),
    makeAction({ ...original, customer: { ...original.customer, timezone: "UTC" } }),
    makeAction({ ...original, customer: { ...original.customer, locale: "en-US" } }),
    makeAction({
      ...original,
      customer: {
        ...original.customer,
        consent: { whatsapp: { marketing: { status: "denied" } } },
      },
    }),
    makeAction({ ...original, customer: { ...original.customer, optedOutChannels: ["whatsapp"] } }),
    makeAction({ ...original, channel: "email" }),
    makeAction({ ...original, purpose: "sales_follow_up" }),
    makeAction({ ...original, content: `${original.content} Alterada.` }),
    makeAction({ ...original, scheduledAt: "2026-08-10T14:00:00.000Z" }),
    makeAction({
      ...original,
      contactHistory: [
        { at: "2026-08-09T13:00:00.000Z", channel: "email", purpose: "marketing" },
      ],
    }),
    makeAction({ ...original, offer: { ...original.offer, totalMinorUnits: 8_999 } }),
  ];

  for (const mutation of mutations) {
    assert.notEqual(createActionFingerprint(mutation), originalFingerprint);
  }
});

test("fingerprinting is independent of contact-history retrieval order", () => {
  const first = { at: "2026-08-08T13:00:00.000Z", channel: "email" as const, purpose: "marketing" as const };
  const second = { at: "2026-08-09T13:00:00.000Z", channel: "sms" as const, purpose: "sales_follow_up" as const };

  assert.equal(
    createActionFingerprint(makeAction({ contactHistory: [first, second] })),
    createActionFingerprint(makeAction({ contactHistory: [second, first] })),
  );
});

test("fingerprinting rejects ambiguous local timestamps", () => {
  assert.throws(
    () => createActionFingerprint(makeAction({ scheduledAt: "2026-08-10T10:00:00" })),
    /explicit offset/u,
  );
});
