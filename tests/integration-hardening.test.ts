import assert from "node:assert/strict";
import test from "node:test";

import {
  createActionFingerprint,
  createBrazilianPortuguesePolicy,
  createDiscountRule,
  GuardrailEngine,
  issueApproval,
  parseSalesAction,
  parseSalesActionJson,
  SALES_ACTION_JSON_SCHEMA,
  validatePolicyConfiguration,
  type ApprovalNonceConsumer,
} from "../src/index.js";
import { makeAction } from "./fixtures.js";

const NOW = new Date("2026-08-11T12:00:00.000Z");
const SECRET = "test-only-approval-secret-with-at-least-32-bytes";
const POLICY_VERSION = "pt-BR-integration-v2";

function makeReviewAction() {
  return makeAction({ offer: { discountPercent: 20 } });
}

function makeApproval() {
  const action = makeReviewAction();
  return issueApproval(
    {
      actionFingerprint: createActionFingerprint(action),
      policyVersion: POLICY_VERSION,
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    SECRET,
  );
}

test("parses and clones a valid JSON-shaped SalesAction", () => {
  const source = makeAction();
  const parsed = parseSalesAction(source);

  assert.equal(parsed.success, true);
  if (!parsed.success) return;
  assert.deepEqual(parsed.value, source);
  assert.notEqual(parsed.value, source);
  assert.notEqual(parsed.value.customer, source.customer);
});

test("rejects unknown fields without echoing their names or values", () => {
  const sensitiveMarker = "private-marker-that-must-not-be-returned";
  const parsed = parseSalesAction({ ...makeAction(), [sensitiveMarker]: sensitiveMarker });

  assert.equal(parsed.success, false);
  assert.doesNotMatch(JSON.stringify(parsed), new RegExp(sensitiveMarker, "u"));
  if (!parsed.success) assert.ok(parsed.issues.some((issue) => issue.code === "UNKNOWN_FIELD"));
});

test("can ignore unknown fields only when explicitly configured", () => {
  const parsed = parseSalesAction(
    { ...makeAction(), providerMetadata: { untrusted: true } },
    { rejectUnknownFields: false },
  );

  assert.equal(parsed.success, true);
  if (parsed.success) assert.equal(Object.hasOwn(parsed.value, "providerMetadata"), false);
});

test("rejects accessor properties without invoking them", () => {
  let getterCalls = 0;
  const input = makeAction() as unknown as Record<string, unknown>;
  Object.defineProperty(input, "content", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return "must not run";
    },
  });

  const parsed = parseSalesAction(input);
  assert.equal(parsed.success, false);
  assert.equal(getterCalls, 0);
});

test("bounds JSON text before parsing", () => {
  const parsed = parseSalesActionJson("x".repeat(101), { maxJsonLength: 100 });
  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(parsed.issues[0]?.code, "INPUT_TOO_LARGE");
});

test("returns a minimized issue for malformed JSON", () => {
  const parsed = parseSalesActionJson('{"content":"private",');
  assert.equal(parsed.success, false);
  assert.doesNotMatch(JSON.stringify(parsed), /private/u);
});

test("exposes a serializable strict JSON Schema", () => {
  const serialized = JSON.stringify(SALES_ACTION_JSON_SCHEMA);
  assert.match(serialized, /additionalProperties/u);
  assert.match(serialized, /SalesAction/u);
  assert.doesNotMatch(serialized, /function/u);
});

test("evaluateUnknown fails closed without exposing rejected input", async () => {
  const secretMarker = "untrusted-private-message";
  const engine = new GuardrailEngine({
    rules: createBrazilianPortuguesePolicy(),
    policyVersion: POLICY_VERSION,
    clock: () => NOW,
  });
  const evaluation = await engine.evaluateUnknown({ ...makeAction(), content: secretMarker, extra: true });

  assert.equal(evaluation.decision, "block");
  assert.equal(evaluation.actionFingerprint, null);
  assert.equal(evaluation.results[0]?.code, "INPUT_SCHEMA_REJECTED");
  assert.doesNotMatch(JSON.stringify(evaluation), new RegExp(secretMarker, "u"));
});

test("policy validation reports bounded machine-readable issues", () => {
  const invalidRule = { id: "invalid id", description: "", evaluate: "not-a-function" };
  const validation = validatePolicyConfiguration({
    rules: [invalidRule] as never,
    policyVersion: "valid-version",
  });

  assert.equal(validation.valid, false);
  if (!validation.valid) {
    assert.ok(validation.issues.some((issue) => issue.code === "INVALID_RULE_ID"));
    assert.doesNotMatch(JSON.stringify(validation), /not-a-function/u);
  }
});

test("policy validation fails safely when configuration access throws", () => {
  const input = Object.defineProperty({}, "rules", {
    get() {
      throw new Error("private configuration detail");
    },
  });
  const validation = validatePolicyConfiguration(input);

  assert.equal(validation.valid, false);
  assert.doesNotMatch(JSON.stringify(validation), /private configuration detail/u);
});

test("runtime adapter bounds objects even when unknown fields are ignored", () => {
  const input: Record<string, unknown> = { ...makeAction() };
  for (let index = 0; index < 100; index += 1) input[`metadata-${index}`] = index;
  const parsed = parseSalesAction(input, { rejectUnknownFields: false });

  assert.equal(parsed.success, false);
  if (!parsed.success) assert.equal(parsed.issues[0]?.code, "INPUT_TOO_LARGE");
});

test("policy manifest is deterministic, serializable, and excludes secrets", () => {
  const engine = new GuardrailEngine({
    rules: createBrazilianPortuguesePolicy(),
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
  });
  const first = engine.getPolicyManifest();
  const second = engine.getPolicyManifest();
  const serialized = JSON.stringify(first);

  assert.deepEqual(first, second);
  assert.equal(first.policyVersion, POLICY_VERSION);
  assert.equal(first.rules.length, 7);
  assert.doesNotMatch(serialized, new RegExp(SECRET, "u"));
  assert.doesNotMatch(serialized, /evaluate/u);
});

test("atomically consumes an approval nonce and rejects replay", async () => {
  const consumed = new Set<string>();
  const consumer: ApprovalNonceConsumer = {
    consume({ nonce }) {
      if (consumed.has(nonce)) return false;
      consumed.add(nonce);
      return true;
    },
  };
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    approvalNonceConsumer: consumer,
    clock: () => NOW,
  });
  const action = { ...makeReviewAction(), approval: makeApproval() };

  const first = await engine.evaluate(action);
  const replay = await engine.evaluate(action);
  assert.equal(first.decision, "allow");
  assert.equal(replay.decision, "review");
  assert.equal(replay.approval.reason, "replayed");
});

test("only one concurrent evaluation can consume the same nonce", async () => {
  const consumed = new Set<string>();
  const consumer: ApprovalNonceConsumer = {
    async consume({ nonce }) {
      await Promise.resolve();
      if (consumed.has(nonce)) return false;
      consumed.add(nonce);
      return true;
    },
  };
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    approvalNonceConsumer: consumer,
    clock: () => NOW,
  });
  const action = { ...makeReviewAction(), approval: makeApproval() };
  const evaluations = await Promise.all([engine.evaluate(action), engine.evaluate(action)]);

  assert.deepEqual(evaluations.map((entry) => entry.decision).sort(), ["allow", "review"]);
});

test("nonce-store errors fail closed and do not leak internal errors", async () => {
  const internalMarker = "database-connection-private-detail";
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    approvalNonceConsumer: {
      consume() {
        throw new Error(internalMarker);
      },
    },
    clock: () => NOW,
  });
  const evaluation = await engine.evaluate({ ...makeReviewAction(), approval: makeApproval() });

  assert.equal(evaluation.decision, "review");
  assert.equal(evaluation.approval.reason, "nonce_store_failed");
  assert.doesNotMatch(JSON.stringify(evaluation), new RegExp(internalMarker, "u"));
});

test("does not consume a nonce that cannot affect a review decision", async () => {
  let calls = 0;
  const original = makeReviewAction();
  const approval = issueApproval(
    {
      actionFingerprint: createActionFingerprint(original),
      policyVersion: POLICY_VERSION,
      ruleIds: ["unrelated.rule"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    SECRET,
  );
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    approvalNonceConsumer: { consume: () => (calls += 1) > 0 },
    clock: () => NOW,
  });

  const evaluation = await engine.evaluate({ ...original, approval });
  assert.equal(evaluation.decision, "review");
  assert.equal(calls, 0);
});

test("preserves v0.1 approval behavior when the host has not added a nonce consumer", async () => {
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    clock: () => NOW,
  });
  const evaluation = await engine.evaluate({ ...makeReviewAction(), approval: makeApproval() });

  assert.equal(evaluation.decision, "allow");
  assert.equal(engine.getPolicyManifest().approval.nonceConsumption, "host-required");
});

test("does not consume an approval when another rule already blocks the action", async () => {
  let calls = 0;
  const original = makeReviewAction();
  const engine = new GuardrailEngine({
    rules: [
      createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 }),
      {
        id: "test.hard-block",
        description: "Blocks for nonce-consumption regression testing.",
        evaluate: () => ({
          ruleId: "test.hard-block",
          decision: "block",
          code: "TEST_BLOCK",
          message: "Synthetic hard block.",
        }),
      },
    ],
    policyVersion: POLICY_VERSION,
    approvalSecret: SECRET,
    approvalNonceConsumer: { consume: () => (calls += 1) > 0 },
    clock: () => NOW,
  });

  const evaluation = await engine.evaluate({ ...original, approval: makeApproval() });
  assert.equal(evaluation.decision, "block");
  assert.equal(calls, 0);
});

test("rejects an approval secret shorter than 32 bytes during configuration", () => {
  assert.throws(
    () =>
      new GuardrailEngine({
        rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
        approvalSecret: "too-short",
      }),
    /WEAK_APPROVAL_SECRET/u,
  );
});

test("property-style malformed values never escape the runtime adapter", () => {
  let state = 0x5eed1234;
  const next = () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state;
  };
  const fields = ["id", "customer", "channel", "purpose", "content", "scheduledAt", "contactHistory"] as const;
  const invalidValues: Readonly<Record<(typeof fields)[number], readonly unknown[]>> = {
    id: [null, true, 0, "", [], {}],
    customer: [null, true, 0, "", [], {}],
    channel: [null, true, 0, "fax", [], {}],
    purpose: [null, true, 0, "profiling", [], {}],
    content: [null, true, 0, [], {}],
    scheduledAt: [null, true, 0, "", "2026-08-11T12:00:00", [], {}],
    contactHistory: [null, true, 0, "", {}],
  };

  for (let index = 0; index < 500; index += 1) {
    const field = fields[next() % fields.length];
    assert.ok(field);
    const values = invalidValues[field];
    const value = values[next() % values.length];
    const candidate = { ...makeAction(), [field]: value };
    assert.doesNotThrow(() => parseSalesAction(candidate));
    const parsed = parseSalesAction(candidate);
    assert.equal(parsed.success, false);
  }
});
