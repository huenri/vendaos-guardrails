import { verifyAndConsumeApproval, verifyApproval } from "./approval.js";
import { createActionFingerprint } from "./fingerprint.js";
import {
  assertValidPolicyConfiguration,
  createPolicyManifest,
  type PolicyManifest,
} from "./policy.js";
import { parseSalesAction } from "./schema.js";
import type {
  ApprovalStatus,
  Decision,
  EngineOptions,
  Evaluation,
  RuleResult,
  SalesAction,
} from "./types.js";
import { validateAction } from "./validation.js";

const DECISION_WEIGHT: Readonly<Record<Decision, number>> = {
  allow: 0,
  review: 1,
  block: 2,
};

const NO_APPROVAL: ApprovalStatus = {
  valid: false,
  reason: "missing",
  approvedRuleIds: [],
};

export class GuardrailEngine {
  readonly #options: Required<
    Pick<
      EngineOptions,
      "policyVersion" | "failureMode" | "maxContentLength" | "maxContactHistoryLength" | "clock"
    >
  > &
    Pick<EngineOptions, "approvalNonceConsumer" | "approvalSecret">;
  readonly #rules: EngineOptions["rules"];
  readonly #manifest: PolicyManifest;

  constructor(options: EngineOptions) {
    assertValidPolicyConfiguration(options);

    if (!Array.isArray(options.rules) || options.rules.length === 0) {
      throw new Error("At least one guardrail rule is required.");
    }

    const ruleIds = options.rules.map((rule) => rule.id);
    if (new Set(ruleIds).size !== ruleIds.length || ruleIds.some((id) => !id.trim())) {
      throw new Error("Every guardrail rule must have a unique, non-empty ID.");
    }

    const maxContentLength = options.maxContentLength ?? 50_000;
    if (!Number.isSafeInteger(maxContentLength) || maxContentLength <= 0) {
      throw new Error("Maximum content length must be a positive safe integer.");
    }

    const maxContactHistoryLength = options.maxContactHistoryLength ?? 10_000;
    if (!Number.isSafeInteger(maxContactHistoryLength) || maxContactHistoryLength <= 0) {
      throw new Error("Maximum contact history length must be a positive safe integer.");
    }

    this.#rules = [...options.rules];
    this.#options = {
      policyVersion: options.policyVersion ?? "unversioned",
      failureMode: options.failureMode ?? "block",
      maxContentLength,
      maxContactHistoryLength,
      clock: options.clock ?? (() => new Date()),
      ...(options.approvalSecret === undefined ? {} : { approvalSecret: options.approvalSecret }),
      ...(options.approvalNonceConsumer === undefined
        ? {}
        : { approvalNonceConsumer: options.approvalNonceConsumer }),
    };
    this.#manifest = createPolicyManifest({
      ...options,
      policyVersion: this.#options.policyVersion,
      failureMode: this.#options.failureMode,
      maxContentLength: this.#options.maxContentLength,
      maxContactHistoryLength: this.#options.maxContactHistoryLength,
    });
  }

  getPolicyManifest(): PolicyManifest {
    return this.#manifest;
  }

  /**
   * Parses untrusted JSON-shaped input into a fresh allow-listed object before evaluation.
   * Schema failures always return a minimized block and never echo input values.
   */
  async evaluateUnknown(input: unknown): Promise<Evaluation> {
    const parsed = parseSalesAction(input, {
      maxContentLength: this.#options.maxContentLength,
      maxContactHistoryLength: this.#options.maxContactHistoryLength,
    });
    if (parsed.success) return this.evaluate(parsed.value);

    const evaluatedAt = this.#options.clock();
    if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
      throw new Error("Engine clock returned an invalid date.");
    }
    const firstIssue = parsed.issues[0];
    return {
      version: 1,
      policyVersion: this.#options.policyVersion,
      decision: "block",
      evaluatedAt: evaluatedAt.toISOString(),
      actionFingerprint: null,
      results: [{
        ruleId: "core.input-schema",
        decision: "block",
        code: "INPUT_SCHEMA_REJECTED",
        message: "Untrusted input did not match the SalesAction schema.",
        details: {
          issueCode: firstIssue?.code ?? "INVALID_ACTION",
          issuePath: firstIssue?.path ?? "$",
          issueCount: parsed.issues.length,
        },
      }],
      approval: NO_APPROVAL,
    };
  }

  async evaluate(action: SalesAction): Promise<Evaluation> {
    const evaluatedAt = this.#options.clock();
    if (!(evaluatedAt instanceof Date) || Number.isNaN(evaluatedAt.getTime())) {
      throw new Error("Engine clock returned an invalid date.");
    }

    const validationResult = validateAction(
      action,
      this.#options.maxContentLength,
      this.#options.maxContactHistoryLength,
    );
    if (validationResult) {
      return {
        version: 1,
        policyVersion: this.#options.policyVersion,
        decision: "block",
        evaluatedAt: evaluatedAt.toISOString(),
        actionFingerprint: null,
        results: [validationResult],
        approval: NO_APPROVAL,
      };
    }

    const actionFingerprint = createActionFingerprint(action);
    let approval = verifyApproval(
      action.approval,
      actionFingerprint,
      this.#options.policyVersion,
      evaluatedAt,
      this.#options.approvalSecret,
    );
    const results: RuleResult[] = [];

    for (const rule of this.#rules) {
      let result: RuleResult;
      try {
        result = await rule.evaluate({
          action,
          actionFingerprint,
          evaluatedAt,
          approval,
        });
        this.#assertValidRuleResult(rule.id, result);
      } catch {
        result = {
          ruleId: rule.id,
          decision: this.#options.failureMode,
          code: "RULE_EXECUTION_FAILED",
          message: "A rule failed to execute; the configured failure mode was applied.",
        };
      }

      results.push(result);
    }

    const approvalWouldApply =
      approval.valid &&
      !results.some((result) => result.decision === "block") &&
      results.some(
        (result) =>
          result.decision === "review" && approval.approvedRuleIds.includes(result.ruleId),
      );

    if (approvalWouldApply && this.#options.approvalNonceConsumer) {
      approval = await verifyAndConsumeApproval(
        action.approval,
        actionFingerprint,
        this.#options.policyVersion,
        evaluatedAt,
        this.#options.approvalSecret,
        this.#options.approvalNonceConsumer,
      );
    }

    const finalizedResults = results.map((result): RuleResult => {
      if (
        result.decision !== "review" ||
        !approvalWouldApply ||
        !approval.valid ||
        !approval.approvedRuleIds.includes(result.ruleId)
      ) {
        return result;
      }

      return {
        ...result,
        decision: "allow",
        code: "HUMAN_APPROVAL_ACCEPTED",
        message: "A valid human approval is bound to this exact action and rule.",
        approvalApplied: true,
      };
    });

    const decision = finalizedResults.reduce<Decision>(
      (current, result) =>
        DECISION_WEIGHT[result.decision] > DECISION_WEIGHT[current] ? result.decision : current,
      "allow",
    );

    return {
      version: 1,
      policyVersion: this.#options.policyVersion,
      decision,
      evaluatedAt: evaluatedAt.toISOString(),
      actionFingerprint,
      results: finalizedResults,
      approval,
    };
  }

  #assertValidRuleResult(expectedRuleId: string, result: RuleResult): void {
    if (
      !result ||
      result.ruleId !== expectedRuleId ||
      !Object.hasOwn(DECISION_WEIGHT, result.decision) ||
      !result.code ||
      !result.message
    ) {
      throw new Error(`Rule ${expectedRuleId} returned an invalid result.`);
    }
  }
}
