import type { GuardrailRule } from "../types.js";
import { result } from "./shared.js";

const SECRET_PATTERNS = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/gu,
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/gu,
  /\bAKIA[A-Z0-9]{16}\b/gu,
] as const;

const CPF_CANDIDATE = /(?<!\d)\d{3}[.\s-]?\d{3}[.\s-]?\d{3}[-.\s]?\d{2}(?!\d)/gu;
const CNPJ_CANDIDATE = /(?<!\d)\d{2}[.\s-]?\d{3}[.\s-]?\d{3}[\/\s-]?\d{4}[-.\s]?\d{2}(?!\d)/gu;
const CARD_CANDIDATE = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/gu;

function digits(value: string): string {
  return value.replace(/\D/gu, "");
}

function allDigitsEqual(value: string): boolean {
  return [...value].every((digit) => digit === value[0]);
}

function cpfDigit(base: string, factor: number): number {
  let sum = 0;
  for (const digit of base) {
    sum += Number(digit) * factor;
    factor -= 1;
  }
  const remainder = (sum * 10) % 11;
  return remainder === 10 ? 0 : remainder;
}

function isValidCpf(candidate: string): boolean {
  const value = digits(candidate);
  if (value.length !== 11 || allDigitsEqual(value)) return false;
  const first = cpfDigit(value.slice(0, 9), 10);
  const second = cpfDigit(value.slice(0, 9) + String(first), 11);
  return value.endsWith(`${first}${second}`);
}

function cnpjDigit(base: string, weights: readonly number[]): number {
  const sum = [...base].reduce((total, digit, index) => total + Number(digit) * (weights[index] ?? 0), 0);
  const remainder = sum % 11;
  return remainder < 2 ? 0 : 11 - remainder;
}

function isValidCnpj(candidate: string): boolean {
  const value = digits(candidate);
  if (value.length !== 14 || allDigitsEqual(value)) return false;
  const first = cnpjDigit(value.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = cnpjDigit(value.slice(0, 12) + String(first), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return value.endsWith(`${first}${second}`);
}

function passesLuhn(candidate: string): boolean {
  const value = digits(candidate);
  if (value.length < 13 || value.length > 19 || allDigitsEqual(value)) return false;
  let sum = 0;
  let shouldDouble = false;

  for (let index = value.length - 1; index >= 0; index -= 1) {
    let digit = Number(value[index]);
    if (shouldDouble) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    shouldDouble = !shouldDouble;
  }

  return sum % 10 === 0;
}

function hasCandidate(content: string, pattern: RegExp, validator: (value: string) => boolean): boolean {
  pattern.lastIndex = 0;
  return [...content.matchAll(pattern)].some((match) => validator(match[0]));
}

export interface SensitiveDataRuleOptions {
  readonly id?: string;
}

export function createSensitiveDataRule(options: SensitiveDataRuleOptions = {}): GuardrailRule {
  const id = options.id ?? "privacy.sensitive-data";

  return {
    id,
    description: "Blocks apparent secrets and requires review for sensitive numeric identifiers.",
    evaluate({ action }) {
      if (SECRET_PATTERNS.some((pattern) => {
        pattern.lastIndex = 0;
        return pattern.test(action.content);
      })) {
        return result(
          id,
          "block",
          "POSSIBLE_SECRET_EXPOSURE",
          "The message appears to contain a credential or API secret.",
          { detectedCategories: ["credential"] },
        );
      }

      const categories: string[] = [];
      if (hasCandidate(action.content, CPF_CANDIDATE, isValidCpf)) categories.push("cpf");
      if (hasCandidate(action.content, CNPJ_CANDIDATE, isValidCnpj)) categories.push("cnpj");
      if (hasCandidate(action.content, CARD_CANDIDATE, passesLuhn)) categories.push("payment_card");

      if (categories.length > 0) {
        return result(
          id,
          "review",
          "SENSITIVE_DATA_REVIEW_REQUIRED",
          "The message may contain sensitive identifiers and requires human review.",
          { detectedCategories: categories },
        );
      }

      return result(id, "allow", "NO_SENSITIVE_PATTERN", "No configured sensitive-data pattern was detected.");
    },
  };
}
