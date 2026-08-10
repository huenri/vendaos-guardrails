import assert from "node:assert/strict";
import test from "node:test";

import {
  createActionFingerprint,
  createAuditRecord,
  createDiscountRule,
  GuardrailEngine,
  issueApproval,
  verifyApproval,
  verifyAuditChain,
  type AuditRecord,
} from "../src/index.js";
import { makeAction } from "./fixtures.js";

const SECRET = "test-only-approval-secret-with-at-least-32-bytes";
const NOW = new Date("2026-08-10T12:00:00.000Z");

test("rejects expired approvals", () => {
  const action = makeAction({ offer: { discountPercent: 20 } });
  const fingerprint = createActionFingerprint(action);
  const approval = issueApproval(
    {
      actionFingerprint: fingerprint,
      policyVersion: "approval-test-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
      ttlMs: 1_000,
    },
    SECRET,
  );

  const status = verifyApproval(
    approval,
    fingerprint,
    "approval-test-v1",
    new Date(NOW.getTime() + 1_001),
    SECRET,
  );
  assert.equal(status.valid, false);
  assert.equal(status.reason, "expired");
});

test("rejects a modified approval signature", () => {
  const action = makeAction({ offer: { discountPercent: 20 } });
  const fingerprint = createActionFingerprint(action);
  const approval = issueApproval(
    {
      actionFingerprint: fingerprint,
      policyVersion: "approval-test-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    SECRET,
  );
  const replacement = approval.signature.endsWith("A") ? "B" : "A";
  const tampered = { ...approval, signature: `${approval.signature.slice(0, -1)}${replacement}` };

  const status = verifyApproval(tampered, fingerprint, "approval-test-v1", NOW, SECRET);
  assert.equal(status.valid, false);
  assert.equal(status.reason, "invalid_signature");
});

test("rejects an approval issued for another policy version", () => {
  const action = makeAction();
  const fingerprint = createActionFingerprint(action);
  const approval = issueApproval(
    {
      actionFingerprint: fingerprint,
      policyVersion: "policy-v1",
      ruleIds: ["commercial.discount-authority"],
      approvedBy: "reviewer-user-7",
      now: NOW,
    },
    SECRET,
  );

  const status = verifyApproval(approval, fingerprint, "policy-v2", NOW, SECRET);
  assert.equal(status.valid, false);
  assert.equal(status.reason, "policy_version_mismatch");
});

test("refuses to issue an approval with an empty rule ID", () => {
  const action = makeAction();
  assert.throws(
    () =>
      issueApproval(
        {
          actionFingerprint: createActionFingerprint(action),
          policyVersion: "approval-test-v1",
          ruleIds: [""],
          approvedBy: "reviewer-user-7",
          now: NOW,
        },
        SECRET,
      ),
    /required/u,
  );
});

test("creates and verifies a privacy-preserving audit chain", async () => {
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    policyVersion: "audit-test-v1",
    clock: () => NOW,
  });
  const firstAction = makeAction({ content: "Mensagem privada A" });
  const secondAction = makeAction({ id: "action-demo-002", content: "Mensagem privada B" });
  const firstEvaluation = await engine.evaluate(firstAction);
  const secondEvaluation = await engine.evaluate(secondAction);
  const first = createAuditRecord(firstAction, firstEvaluation, { sequence: 0, recordedAt: NOW });
  const second = createAuditRecord(secondAction, secondEvaluation, {
    sequence: 1,
    recordedAt: NOW,
    previousHash: first.recordHash,
  });

  assert.equal(verifyAuditChain([first, second]), true);
  const serialized = JSON.stringify([first, second]);
  assert.doesNotMatch(serialized, /Mensagem privada/u);
  assert.doesNotMatch(serialized, /customer-pseudonym-42/u);
});

test("detects a modified audit record", async () => {
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    clock: () => NOW,
  });
  const action = makeAction();
  const evaluation = await engine.evaluate(action);
  const original = createAuditRecord(action, evaluation, { sequence: 0, recordedAt: NOW });
  const tampered: AuditRecord = { ...original, decision: "block" };

  assert.equal(verifyAuditChain([tampered]), false);
});

test("refuses to audit an evaluation against a different action", async () => {
  const engine = new GuardrailEngine({
    rules: [createDiscountRule({ maximumAutomaticPercent: 15, hardLimitPercent: 50 })],
    clock: () => NOW,
  });
  const evaluatedAction = makeAction({ id: "evaluated-action" });
  const differentAction = makeAction({ id: "different-action" });
  const evaluation = await engine.evaluate(evaluatedAction);

  assert.throws(
    () => createAuditRecord(differentAction, evaluation, { sequence: 0, recordedAt: NOW }),
    /does not match/u,
  );
});
