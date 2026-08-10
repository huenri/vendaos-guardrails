import type { GuardrailRule } from "../types.js";
import { result } from "./shared.js";

export interface DiscountRuleOptions {
  readonly id?: string;
  readonly maximumAutomaticPercent: number;
  readonly hardLimitPercent: number;
}

export function createDiscountRule(options: DiscountRuleOptions): GuardrailRule {
  const id = options.id ?? "commercial.discount-authority";

  if (
    !Number.isFinite(options.maximumAutomaticPercent) ||
    !Number.isFinite(options.hardLimitPercent) ||
    options.maximumAutomaticPercent < 0 ||
    options.hardLimitPercent > 100 ||
    options.maximumAutomaticPercent > options.hardLimitPercent
  ) {
    throw new Error("Discount thresholds must satisfy 0 <= automatic <= hard limit <= 100.");
  }

  return {
    id,
    description: "Requires exact-action human approval above the automatic discount threshold.",
    evaluate({ action }) {
      const discount = action.offer?.discountPercent;
      if (discount === undefined) {
        return result(id, "allow", "NO_DISCOUNT", "The action does not contain a percentage discount.");
      }

      if (!Number.isFinite(discount) || discount < 0 || discount > 100) {
        return result(id, "block", "INVALID_DISCOUNT", "Discount percentage must be between 0 and 100.");
      }

      if (discount > options.hardLimitPercent) {
        return result(id, "block", "DISCOUNT_HARD_LIMIT_EXCEEDED", "The discount exceeds the configured hard limit.", {
          discountPercent: discount,
          hardLimitPercent: options.hardLimitPercent,
        });
      }

      if (discount > options.maximumAutomaticPercent) {
        return result(
          id,
          "review",
          "DISCOUNT_REQUIRES_APPROVAL",
          "The discount requires human approval bound to the exact action.",
          { discountPercent: discount, maximumAutomaticPercent: options.maximumAutomaticPercent },
        );
      }

      return result(id, "allow", "DISCOUNT_WITHIN_AUTHORITY", "The discount is within automatic authority.");
    },
  };
}
