import { createHash } from "node:crypto";

import { createActionFingerprint, hashIdentifier } from "./fingerprint.js";
import type { Evaluation, RuleResult, SalesAction } from "./types.js";

export interface AuditRuleResult {
  readonly ruleId: string;
  readonly decision: RuleResult["decision"];
  readonly code: string;
  readonly approvalApplied: boolean;
}

export interface AuditRecord {
  readonly version: 1;
  readonly sequence: number;
  readonly recordedAt: string;
  readonly policyVersion: string;
  readonly decision: Evaluation["decision"];
  readonly actionReferenceHash: string;
  readonly customerReferenceHash: string;
  readonly actionFingerprint: string | null;
  readonly ruleResults: readonly AuditRuleResult[];
  readonly previousHash: string | null;
  readonly recordHash: string;
}

export interface CreateAuditRecordOptions {
  readonly sequence: number;
  readonly recordedAt?: Date;
  readonly previousHash?: string | null;
}

function digest(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function calculateRecordHash(record: Omit<AuditRecord, "recordHash">): string {
  return digest(JSON.stringify({
    version: record.version,
    sequence: record.sequence,
    recordedAt: record.recordedAt,
    policyVersion: record.policyVersion,
    decision: record.decision,
    actionReferenceHash: record.actionReferenceHash,
    customerReferenceHash: record.customerReferenceHash,
    actionFingerprint: record.actionFingerprint,
    ruleResults: record.ruleResults.map((ruleResult) => ({
      ruleId: ruleResult.ruleId,
      decision: ruleResult.decision,
      code: ruleResult.code,
      approvalApplied: ruleResult.approvalApplied,
    })),
    previousHash: record.previousHash,
  }));
}

export function createAuditRecord(
  action: SalesAction,
  evaluation: Evaluation,
  options: CreateAuditRecordOptions,
): AuditRecord {
  if (!Number.isSafeInteger(options.sequence) || options.sequence < 0) {
    throw new Error("Audit sequence must be a non-negative safe integer.");
  }

  const recordedAt = options.recordedAt ?? new Date();
  if (Number.isNaN(recordedAt.getTime())) {
    throw new Error("Audit time must be a valid date.");
  }

  if (
    evaluation.actionFingerprint !== null &&
    createActionFingerprint(action) !== evaluation.actionFingerprint
  ) {
    throw new Error("Evaluation fingerprint does not match the action being audited.");
  }

  const unsignedRecord: Omit<AuditRecord, "recordHash"> = {
    version: 1,
    sequence: options.sequence,
    recordedAt: recordedAt.toISOString(),
    policyVersion: evaluation.policyVersion,
    decision: evaluation.decision,
    actionReferenceHash: hashIdentifier(action.id),
    customerReferenceHash: hashIdentifier(action.customer.id),
    actionFingerprint: evaluation.actionFingerprint,
    ruleResults: evaluation.results.map((result) => ({
      ruleId: result.ruleId,
      decision: result.decision,
      code: result.code,
      approvalApplied: result.approvalApplied ?? false,
    })),
    previousHash: options.previousHash ?? null,
  };

  return { ...unsignedRecord, recordHash: calculateRecordHash(unsignedRecord) };
}

export function verifyAuditChain(records: readonly AuditRecord[]): boolean {
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) return false;

    const previousRecord = records[index - 1];
    const expectedPreviousHash = previousRecord?.recordHash ?? null;
    if (record.previousHash !== expectedPreviousHash) return false;
    if (record.sequence !== index) return false;
    if (calculateRecordHash(record) !== record.recordHash) return false;
  }

  return true;
}
