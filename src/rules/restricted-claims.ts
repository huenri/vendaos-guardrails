import type { GuardrailRule } from "../types.js";
import { normalizePortugueseText, result } from "./shared.js";

const DEFAULT_CLAIMS: Readonly<Record<string, readonly string[]>> = {
  guaranteed_outcome: ["resultado garantido", "100% garantido", "garantia de resultado"],
  no_risk: ["sem risco", "risco zero"],
  guaranteed_profit: ["lucro garantido", "retorno garantido", "renda garantida"],
  medical_cure: ["cura garantida", "cura comprovada"],
};

export interface RestrictedClaimsRuleOptions {
  readonly id?: string;
  readonly claims?: Readonly<Record<string, readonly string[]>>;
}

export function createRestrictedClaimsRule(options: RestrictedClaimsRuleOptions = {}): GuardrailRule {
  const id = options.id ?? "content.restricted-claims";
  const normalizedClaims = Object.entries(options.claims ?? DEFAULT_CLAIMS).map(([category, phrases]) => ({
    category,
    phrases: phrases.map(normalizePortugueseText),
  }));

  if (normalizedClaims.some(({ category, phrases }) => !category || phrases.some((phrase) => !phrase))) {
    throw new Error("Restricted claim categories and phrases must not be empty.");
  }

  return {
    id,
    description: "Routes configured high-risk commercial claims to human review.",
    evaluate({ action }) {
      const normalizedContent = normalizePortugueseText(action.content);
      const categories = normalizedClaims
        .filter(({ phrases }) => phrases.some((phrase) => normalizedContent.includes(phrase)))
        .map(({ category }) => category);

      if (categories.length > 0) {
        return result(
          id,
          "review",
          "RESTRICTED_CLAIM_REVIEW_REQUIRED",
          "The message contains a configured high-risk claim and requires human review.",
          { detectedCategories: categories },
        );
      }

      return result(id, "allow", "NO_RESTRICTED_CLAIM", "No configured high-risk claim was detected.");
    },
  };
}
