import { verifyApproval } from "./approval.js";
import { createActionFingerprint } from "./fingerprint.js";
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
    Pick<EngineOptions, "approvalSecret">;
  readonly #rules: EngineOptions["rules"];

  constructor(options: EngineOptions) {
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
    const approval = verifyApproval(
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

      if (
        result.decision === "review" &&
        approval.valid &&
        approval.approvedRuleIds.includes(rule.id)
      ) {
        result = {
          ...result,
          decision: "allow",
          code: "HUMAN_APPROVAL_ACCEPTED",
          message: "A valid human approval is bound to this exact action and rule.",
          approvalApplied: true,
        };
      }

      results.push(result);
    }

    const decision = results.reduce<Decision>(
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
      results,
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
