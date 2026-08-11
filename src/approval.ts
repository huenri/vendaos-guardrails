import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type {
  ApprovalNonceConsumer,
  ApprovalPayload,
  ApprovalStatus,
  SignedApproval,
} from "./types.js";

const MINIMUM_SECRET_BYTES = 32;
const DEFAULT_TTL_MS = 15 * 60 * 1_000;
const MAXIMUM_TTL_MS = 24 * 60 * 60 * 1_000;
const FINGERPRINT_PATTERN = /^[a-f0-9]{64}$/u;
const RULE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const NONCE_PATTERN = /^[a-f0-9]{32}$/u;
const SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const MAXIMUM_APPROVED_RULES = 64;

export interface IssueApprovalInput {
  readonly actionFingerprint: string;
  readonly policyVersion: string;
  readonly ruleIds: readonly string[];
  readonly approvedBy: string;
  readonly ttlMs?: number;
  readonly now?: Date;
}

function asSecretBuffer(secret: string | Uint8Array): Buffer {
  const secretBuffer = typeof secret === "string" ? Buffer.from(secret, "utf8") : Buffer.from(secret);

  if (secretBuffer.byteLength < MINIMUM_SECRET_BYTES) {
    throw new Error(`Approval secret must contain at least ${MINIMUM_SECRET_BYTES} bytes.`);
  }

  return secretBuffer;
}

function canonicalPayload(payload: ApprovalPayload): string {
  return JSON.stringify({
    version: payload.version,
    actionFingerprint: payload.actionFingerprint,
    policyVersion: payload.policyVersion,
    ruleIds: [...payload.ruleIds].sort(),
    approvedBy: payload.approvedBy,
    approvedAt: payload.approvedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  });
}

function signPayload(payload: ApprovalPayload, secret: string | Uint8Array): string {
  return createHmac("sha256", asSecretBuffer(secret))
    .update(canonicalPayload(payload), "utf8")
    .digest("base64url");
}

export function issueApproval(
  input: IssueApprovalInput,
  secret: string | Uint8Array,
): SignedApproval {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEFAULT_TTL_MS;
  const uniqueRuleIds = [...new Set(input.ruleIds)].sort();

  if (Number.isNaN(now.getTime())) {
    throw new Error("Approval time must be a valid date.");
  }

  if (!Number.isSafeInteger(ttlMs) || ttlMs <= 0 || ttlMs > MAXIMUM_TTL_MS) {
    throw new Error(`Approval TTL must be greater than zero and at most ${MAXIMUM_TTL_MS} ms.`);
  }

  if (
    !FINGERPRINT_PATTERN.test(input.actionFingerprint) ||
    !input.policyVersion.trim() ||
    input.policyVersion.length > 128 ||
    !input.approvedBy.trim() ||
    input.approvedBy.length > 256 ||
    uniqueRuleIds.length === 0 ||
    uniqueRuleIds.length > MAXIMUM_APPROVED_RULES ||
    uniqueRuleIds.some((ruleId) => !RULE_ID_PATTERN.test(ruleId))
  ) {
    throw new Error("Approval fingerprint, approver, and at least one rule ID are required.");
  }

  const payload: ApprovalPayload = {
    version: 1,
    actionFingerprint: input.actionFingerprint,
    policyVersion: input.policyVersion.trim(),
    ruleIds: uniqueRuleIds,
    approvedBy: input.approvedBy.trim(),
    approvedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + ttlMs).toISOString(),
    nonce: randomBytes(16).toString("hex"),
  };

  return { payload, signature: signPayload(payload, secret) };
}

function safeEqualBase64Url(left: string, right: string): boolean {
  try {
    if (!SIGNATURE_PATTERN.test(left) || !SIGNATURE_PATTERN.test(right)) return false;
    const leftBuffer = Buffer.from(left, "base64url");
    const rightBuffer = Buffer.from(right, "base64url");
    if (leftBuffer.toString("base64url") !== left || rightBuffer.toString("base64url") !== right) {
      return false;
    }
    return leftBuffer.byteLength === rightBuffer.byteLength && timingSafeEqual(leftBuffer, rightBuffer);
  } catch {
    return false;
  }
}

export function verifyApproval(
  approval: SignedApproval | undefined,
  expectedFingerprint: string,
  expectedPolicyVersion: string,
  now: Date,
  secret?: string | Uint8Array,
): ApprovalStatus {
  if (!approval) {
    return { valid: false, reason: "missing", approvedRuleIds: [] };
  }

  if (!secret) {
    return { valid: false, reason: "secret_not_configured", approvedRuleIds: [] };
  }

  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    return { valid: false, reason: "malformed", approvedRuleIds: [] };
  }

  try {
    const { payload, signature } = approval;
    const approvedAt = new Date(payload.approvedAt);
    const expiresAt = new Date(payload.expiresAt);

    if (
      payload.version !== 1 ||
      !FINGERPRINT_PATTERN.test(payload.actionFingerprint) ||
      typeof payload.policyVersion !== "string" ||
      !payload.policyVersion.trim() ||
      payload.policyVersion.length > 128 ||
      !payload.approvedBy.trim() ||
      payload.approvedBy.length > 256 ||
      !NONCE_PATTERN.test(payload.nonce) ||
      !Array.isArray(payload.ruleIds) ||
      payload.ruleIds.length === 0 ||
      payload.ruleIds.length > MAXIMUM_APPROVED_RULES ||
      new Set(payload.ruleIds).size !== payload.ruleIds.length ||
      payload.ruleIds.some((ruleId) => typeof ruleId !== "string" || !RULE_ID_PATTERN.test(ruleId)) ||
      Number.isNaN(approvedAt.getTime()) ||
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= approvedAt.getTime() ||
      expiresAt.getTime() - approvedAt.getTime() > MAXIMUM_TTL_MS ||
      typeof signature !== "string"
    ) {
      return { valid: false, reason: "malformed", approvedRuleIds: [] };
    }

    const expectedSignature = signPayload(payload, secret);
    if (!safeEqualBase64Url(signature, expectedSignature)) {
      return { valid: false, reason: "invalid_signature", approvedRuleIds: [] };
    }

    if (payload.actionFingerprint !== expectedFingerprint) {
      return { valid: false, reason: "fingerprint_mismatch", approvedRuleIds: [] };
    }

    if (payload.policyVersion !== expectedPolicyVersion) {
      return { valid: false, reason: "policy_version_mismatch", approvedRuleIds: [] };
    }

    if (approvedAt.getTime() > now.getTime()) {
      return { valid: false, reason: "not_yet_valid", approvedRuleIds: [] };
    }

    if (expiresAt.getTime() <= now.getTime()) {
      return { valid: false, reason: "expired", approvedRuleIds: [] };
    }

    return {
      valid: true,
      reason: "valid",
      approvedRuleIds: [...new Set(payload.ruleIds)],
      approvedBy: payload.approvedBy,
    };
  } catch {
    return { valid: false, reason: "malformed", approvedRuleIds: [] };
  }
}

/**
 * Verifies an approval and atomically consumes its nonce before returning a valid status.
 * A consumer error fails closed and is never exposed in the returned status.
 */
export async function verifyAndConsumeApproval(
  approval: SignedApproval | undefined,
  expectedFingerprint: string,
  expectedPolicyVersion: string,
  now: Date,
  secret: string | Uint8Array | undefined,
  nonceConsumer: ApprovalNonceConsumer,
): Promise<ApprovalStatus> {
  const status = verifyApproval(
    approval,
    expectedFingerprint,
    expectedPolicyVersion,
    now,
    secret,
  );
  if (!status.valid || !approval) return status;

  try {
    const consumed = await nonceConsumer.consume({
      nonce: approval.payload.nonce,
      actionFingerprint: approval.payload.actionFingerprint,
      policyVersion: approval.payload.policyVersion,
      approvedAt: approval.payload.approvedAt,
      expiresAt: approval.payload.expiresAt,
    });
    if (consumed !== true) {
      return { valid: false, reason: "replayed", approvedRuleIds: [] };
    }
  } catch {
    return { valid: false, reason: "nonce_store_failed", approvedRuleIds: [] };
  }

  return status;
}
