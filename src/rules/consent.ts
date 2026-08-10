import type { Channel, ContactPurpose, GuardrailRule } from "../types.js";
import { PROMOTIONAL_PURPOSES, result } from "./shared.js";

export interface ConsentRuleOptions {
  readonly id?: string;
  readonly requiredPurposes?: readonly ContactPurpose[];
  readonly channels?: readonly Channel[];
}

export function createConsentRule(options: ConsentRuleOptions = {}): GuardrailRule {
  const id = options.id ?? "privacy.consent";
  const requiredPurposes = options.requiredPurposes ?? PROMOTIONAL_PURPOSES;
  const channels = options.channels;

  return {
    id,
    description: "Blocks promotional contact after opt-out or without a recorded grant.",
    evaluate({ action }) {
      if (channels && !channels.includes(action.channel)) {
        return result(id, "allow", "CHANNEL_NOT_APPLICABLE", "Consent rule does not apply to this channel.");
      }

      if (!requiredPurposes.includes(action.purpose)) {
        return result(id, "allow", "PURPOSE_NOT_APPLICABLE", "Consent rule does not apply to this purpose.");
      }

      if (action.customer.optedOutChannels.includes(action.channel)) {
        return result(id, "block", "CHANNEL_OPTED_OUT", "The customer opted out of this contact channel.");
      }

      const consent = action.customer.consent[action.channel]?.[action.purpose];
      if (!consent || consent.status !== "granted") {
        return result(
          id,
          "block",
          consent?.status === "denied" ? "CONSENT_DENIED" : "CONSENT_NOT_RECORDED",
          "A recorded grant is required for this promotional contact.",
        );
      }

      return result(id, "allow", "CONSENT_CONFIRMED", "A consent grant is recorded for this channel.");
    },
  };
}
