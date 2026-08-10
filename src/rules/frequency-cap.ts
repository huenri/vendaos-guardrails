import type { ContactPurpose, GuardrailRule } from "../types.js";
import { PROMOTIONAL_PURPOSES, assertPositiveNumber, result } from "./shared.js";

export interface FrequencyCapRuleOptions {
  readonly id?: string;
  readonly maximumContacts: number;
  readonly rollingWindowHours: number;
  readonly purposes?: readonly ContactPurpose[];
}

export function createFrequencyCapRule(options: FrequencyCapRuleOptions): GuardrailRule {
  const id = options.id ?? "contact.frequency-cap";
  assertPositiveNumber(options.maximumContacts, "maximumContacts");
  assertPositiveNumber(options.rollingWindowHours, "rollingWindowHours");

  if (!Number.isSafeInteger(options.maximumContacts)) {
    throw new Error("maximumContacts must be a positive safe integer.");
  }

  if (options.rollingWindowHours > 8_760) {
    throw new Error("rollingWindowHours must not exceed one year.");
  }

  const purposes = options.purposes ?? PROMOTIONAL_PURPOSES;
  const windowMs = options.rollingWindowHours * 60 * 60 * 1_000;

  return {
    id,
    description: "Limits promotional contact frequency using authoritative contact history.",
    evaluate({ action }) {
      if (!purposes.includes(action.purpose)) {
        return result(id, "allow", "PURPOSE_NOT_APPLICABLE", "Frequency cap does not apply to this purpose.");
      }

      const proposedAt = new Date(action.scheduledAt).getTime();
      let count = 0;

      for (const contact of action.contactHistory) {
        const contactAt = new Date(contact.at).getTime();
        if (Number.isNaN(contactAt)) {
          return result(id, "block", "INVALID_CONTACT_HISTORY", "Contact history contains an invalid timestamp.");
        }

        if (
          purposes.includes(contact.purpose) &&
          contactAt <= proposedAt &&
          contactAt > proposedAt - windowMs
        ) {
          count += 1;
        }
      }

      if (count >= options.maximumContacts) {
        return result(
          id,
          "block",
          "FREQUENCY_CAP_REACHED",
          "The promotional contact frequency cap has been reached.",
          {
            contactsInWindow: count,
            maximumContacts: options.maximumContacts,
            rollingWindowHours: options.rollingWindowHours,
          },
        );
      }

      return result(id, "allow", "BELOW_FREQUENCY_CAP", "The proposed contact is below the frequency cap.", {
        contactsInWindow: count,
        maximumContacts: options.maximumContacts,
      });
    },
  };
}
