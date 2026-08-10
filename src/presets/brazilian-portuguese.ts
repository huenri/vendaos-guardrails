import type { GuardrailRule } from "../types.js";
import { createConsentRule } from "../rules/consent.js";
import {
  createContactWindowRule,
  type WeeklySchedule,
} from "../rules/contact-window.js";
import { createDiscountRule } from "../rules/discount.js";
import { createFrequencyCapRule } from "../rules/frequency-cap.js";
import { createOptOutInstructionRule } from "../rules/opt-out-instruction.js";
import { createRestrictedClaimsRule } from "../rules/restricted-claims.js";
import { createSensitiveDataRule } from "../rules/sensitive-data.js";

const DEFAULT_SCHEDULE: WeeklySchedule = {
  mon: [{ start: "09:00", end: "18:00" }],
  tue: [{ start: "09:00", end: "18:00" }],
  wed: [{ start: "09:00", end: "18:00" }],
  thu: [{ start: "09:00", end: "18:00" }],
  fri: [{ start: "09:00", end: "18:00" }],
};

export interface BrazilianPortuguesePolicyOptions {
  readonly schedule?: WeeklySchedule;
  readonly maximumContacts?: number;
  readonly rollingWindowHours?: number;
  readonly maximumAutomaticDiscountPercent?: number;
  readonly discountHardLimitPercent?: number;
  readonly includeRestrictedClaimsReview?: boolean;
}

/**
 * Conservative starter rules for Brazilian Portuguese sales flows.
 *
 * This preset is not a legal determination, certification, or substitute for counsel. Hosts must
 * configure it for their sector, location, channel, lawful basis, contracts, and current rules.
 */
export function createBrazilianPortuguesePolicy(
  options: BrazilianPortuguesePolicyOptions = {},
): readonly GuardrailRule[] {
  const rules: GuardrailRule[] = [
    createConsentRule(),
    createContactWindowRule({ schedule: options.schedule ?? DEFAULT_SCHEDULE }),
    createFrequencyCapRule({
      maximumContacts: options.maximumContacts ?? 3,
      rollingWindowHours: options.rollingWindowHours ?? 24,
    }),
    createDiscountRule({
      maximumAutomaticPercent: options.maximumAutomaticDiscountPercent ?? 15,
      hardLimitPercent: options.discountHardLimitPercent ?? 50,
    }),
    createOptOutInstructionRule(),
    createSensitiveDataRule(),
  ];

  if (options.includeRestrictedClaimsReview ?? true) {
    rules.push(createRestrictedClaimsRule());
  }

  return rules;
}
