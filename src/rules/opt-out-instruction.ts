import type { Channel, ContactPurpose, GuardrailRule } from "../types.js";
import { PROMOTIONAL_PURPOSES, normalizePortugueseText, result } from "./shared.js";

const DEFAULT_PHRASES = [
  "responda sair",
  "responda parar",
  "digite sair",
  "pare de receber",
  "cancelar mensagens",
  "nao quero mais receber",
] as const;

export interface OptOutInstructionRuleOptions {
  readonly id?: string;
  readonly purposes?: readonly ContactPurpose[];
  readonly channels?: readonly Channel[];
  readonly acceptedPhrases?: readonly string[];
}

export function createOptOutInstructionRule(options: OptOutInstructionRuleOptions = {}): GuardrailRule {
  const id = options.id ?? "privacy.opt-out-instruction";
  const purposes = options.purposes ?? PROMOTIONAL_PURPOSES;
  const channels = options.channels ?? ["email", "sms", "whatsapp"];
  const phrases = (options.acceptedPhrases ?? DEFAULT_PHRASES).map(normalizePortugueseText);

  if (phrases.some((phrase) => !phrase)) {
    throw new Error("Accepted opt-out phrases must not be empty.");
  }

  return {
    id,
    description: "Requires a clear opt-out instruction in written promotional messages.",
    evaluate({ action }) {
      if (!purposes.includes(action.purpose) || !channels.includes(action.channel)) {
        return result(id, "allow", "NOT_APPLICABLE", "Opt-out instruction rule does not apply to this action.");
      }

      const normalizedContent = normalizePortugueseText(action.content);
      if (!phrases.some((phrase) => normalizedContent.includes(phrase))) {
        return result(
          id,
          "block",
          "OPTOUT_INSTRUCTION_MISSING",
          "The promotional message must include a configured opt-out instruction.",
        );
      }

      return result(id, "allow", "OPTOUT_INSTRUCTION_PRESENT", "The message includes an opt-out instruction.");
    },
  };
}
