import type { ContactPurpose, GuardrailRule, RuleResult } from "../types.js";

export const PROMOTIONAL_PURPOSES: readonly ContactPurpose[] = ["marketing", "sales_follow_up"];

export function result(
  ruleId: string,
  decision: RuleResult["decision"],
  code: string,
  message: string,
  details?: RuleResult["details"],
): RuleResult {
  return {
    ruleId,
    decision,
    code,
    message,
    ...(details === undefined ? {} : { details }),
  };
}

export function normalizePortugueseText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR")
    .replace(/[^a-z0-9%]+/gu, " ")
    .trim()
    .replace(/\s+/gu, " ");
}

export function assertPositiveNumber(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${name} must be a positive finite number.`);
  }
}

export function assertRuleId(rule: GuardrailRule): GuardrailRule {
  if (!rule.id.trim()) throw new Error("Rule ID must not be empty.");
  return rule;
}
