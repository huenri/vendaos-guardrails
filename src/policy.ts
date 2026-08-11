import type { EngineOptions, FailureMode, GuardrailRule } from "./types.js";

export const DEFAULT_POLICY_VERSION = "unversioned";
export const DEFAULT_FAILURE_MODE: FailureMode = "block";
export const DEFAULT_MAX_CONTENT_LENGTH = 50_000;
export const DEFAULT_MAX_CONTACT_HISTORY_LENGTH = 10_000;

const MAXIMUM_RULES = 256;
const MAXIMUM_CONTENT_LENGTH = 1_000_000;
const MAXIMUM_CONTACT_HISTORY_LENGTH = 100_000;
const RULE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export interface PolicyValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export type PolicyValidationResult =
  | { readonly valid: true; readonly issues: readonly [] }
  | { readonly valid: false; readonly issues: readonly PolicyValidationIssue[] };

export interface PolicyManifestRule {
  readonly id: string;
  readonly description: string;
  readonly order: number;
}

export interface PolicyManifest {
  readonly schemaVersion: 1;
  readonly policyVersion: string;
  readonly failureMode: FailureMode;
  readonly limits: {
    readonly maxContentLength: number;
    readonly maxContactHistoryLength: number;
  };
  readonly approval: {
    readonly signatureAlgorithm: "HMAC-SHA-256";
    readonly exactActionBinding: true;
    readonly nonceConsumption: "atomic-consumer" | "host-required";
  };
  readonly rules: readonly PolicyManifestRule[];
}

function issue(path: string, code: string, message: string): PolicyValidationIssue {
  return { path, code, message };
}

function isPositiveSafeIntegerWithin(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0 && (value as number) <= maximum;
}

function validateRule(rule: unknown, index: number): readonly PolicyValidationIssue[] {
  if (!rule || typeof rule !== "object") {
    return [issue(`rules[${index}]`, "INVALID_RULE", "Each rule must be an object.")];
  }

  const candidate = rule as Partial<GuardrailRule>;
  const issues: PolicyValidationIssue[] = [];
  if (typeof candidate.id !== "string" || !RULE_ID_PATTERN.test(candidate.id)) {
    issues.push(
      issue(
        `rules[${index}].id`,
        "INVALID_RULE_ID",
        "Rule IDs must contain 1 to 128 letters, numbers, dots, underscores, colons, or hyphens.",
      ),
    );
  }
  if (
    typeof candidate.description !== "string" ||
    candidate.description.trim().length === 0 ||
    candidate.description.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(candidate.description)
  ) {
    issues.push(
      issue(
        `rules[${index}].description`,
        "INVALID_RULE_DESCRIPTION",
        "Rule descriptions must contain 1 to 512 printable characters.",
      ),
    );
  }
  if (typeof candidate.evaluate !== "function") {
    issues.push(
      issue(`rules[${index}].evaluate`, "INVALID_RULE_EVALUATOR", "Each rule needs an evaluator."),
    );
  }
  return issues;
}

function validatePolicyConfigurationValue(input: unknown): PolicyValidationResult {
  const issues: PolicyValidationIssue[] = [];

  if (!input || typeof input !== "object") {
    return {
      valid: false,
      issues: [issue("$", "INVALID_POLICY", "Policy configuration must be an object.")],
    };
  }
  const options = input as Partial<EngineOptions>;

  if (!Array.isArray(options.rules) || options.rules.length === 0) {
    issues.push(issue("rules", "MISSING_RULES", "At least one guardrail rule is required."));
  } else if (options.rules.length > MAXIMUM_RULES) {
    issues.push(
      issue("rules", "TOO_MANY_RULES", `A policy may contain at most ${MAXIMUM_RULES} rules.`),
    );
  } else {
    options.rules.forEach((rule, index) => issues.push(...validateRule(rule, index)));
    const ids = options.rules
      .map((rule) => (rule && typeof rule === "object" ? (rule as Partial<GuardrailRule>).id : undefined))
      .filter((id): id is string => typeof id === "string");
    if (new Set(ids).size !== ids.length) {
      issues.push(issue("rules", "DUPLICATE_RULE_ID", "Every rule ID must be unique."));
    }
  }

  const policyVersion = options.policyVersion ?? DEFAULT_POLICY_VERSION;
  if (
    typeof policyVersion !== "string" ||
    policyVersion.trim().length === 0 ||
    policyVersion.length > 128 ||
    CONTROL_CHARACTER_PATTERN.test(policyVersion)
  ) {
    issues.push(
      issue(
        "policyVersion",
        "INVALID_POLICY_VERSION",
        "Policy version must contain 1 to 128 printable characters.",
      ),
    );
  }

  const failureMode = options.failureMode ?? DEFAULT_FAILURE_MODE;
  if (failureMode !== "block" && failureMode !== "review") {
    issues.push(
      issue("failureMode", "INVALID_FAILURE_MODE", "Failure mode must be block or review."),
    );
  }

  const maxContentLength = options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH;
  if (!isPositiveSafeIntegerWithin(maxContentLength, MAXIMUM_CONTENT_LENGTH)) {
    issues.push(
      issue(
        "maxContentLength",
        "INVALID_CONTENT_LIMIT",
        `Maximum content length must be between 1 and ${MAXIMUM_CONTENT_LENGTH}.`,
      ),
    );
  }

  const maxContactHistoryLength =
    options.maxContactHistoryLength ?? DEFAULT_MAX_CONTACT_HISTORY_LENGTH;
  if (!isPositiveSafeIntegerWithin(maxContactHistoryLength, MAXIMUM_CONTACT_HISTORY_LENGTH)) {
    issues.push(
      issue(
        "maxContactHistoryLength",
        "INVALID_HISTORY_LIMIT",
        `Maximum contact history length must be between 1 and ${MAXIMUM_CONTACT_HISTORY_LENGTH}.`,
      ),
    );
  }

  if (
    options.approvalNonceConsumer !== undefined &&
    (typeof options.approvalNonceConsumer !== "object" ||
      typeof options.approvalNonceConsumer.consume !== "function")
  ) {
    issues.push(
      issue(
        "approvalNonceConsumer",
        "INVALID_NONCE_CONSUMER",
        "Approval nonce consumer must provide an atomic consume function.",
      ),
    );
  }

  if (options.approvalNonceConsumer !== undefined && options.approvalSecret === undefined) {
    issues.push(
      issue(
        "approvalSecret",
        "MISSING_APPROVAL_SECRET",
        "An approval secret is required when nonce consumption is configured.",
      ),
    );
  }

  if (options.approvalSecret !== undefined) {
    if (
      typeof options.approvalSecret !== "string" &&
      !(options.approvalSecret instanceof Uint8Array)
    ) {
      issues.push(
        issue(
          "approvalSecret",
          "INVALID_APPROVAL_SECRET",
          "Approval secret must be a string or byte array.",
        ),
      );
    } else {
      const secretLength =
        typeof options.approvalSecret === "string"
          ? Buffer.byteLength(options.approvalSecret, "utf8")
          : options.approvalSecret.byteLength;
      if (secretLength < 32) {
        issues.push(
          issue(
            "approvalSecret",
            "WEAK_APPROVAL_SECRET",
            "Approval secret must contain at least 32 bytes.",
          ),
        );
      }
    }
  }

  return issues.length === 0 ? { valid: true, issues: [] } : { valid: false, issues };
}

export function validatePolicyConfiguration(input: unknown): PolicyValidationResult {
  try {
    return validatePolicyConfigurationValue(input);
  } catch {
    return {
      valid: false,
      issues: [issue("$", "INVALID_POLICY", "Policy configuration could not be inspected safely.")],
    };
  }
}

export function assertValidPolicyConfiguration(options: EngineOptions): void {
  const result = validatePolicyConfiguration(options);
  if (!result.valid) {
    const summary = result.issues.map(({ path, code }) => `${path}:${code}`).join(", ");
    const duplicateHint = result.issues.some(({ code }) => code === "DUPLICATE_RULE_ID")
      ? " Every rule ID must be unique."
      : "";
    throw new Error(`Invalid policy configuration (${summary}).${duplicateHint}`);
  }
}

export function createPolicyManifest(options: EngineOptions): PolicyManifest {
  assertValidPolicyConfiguration(options);

  const rules = options.rules.map((rule, order) =>
    Object.freeze({ id: rule.id, description: rule.description, order }),
  );
  const manifest: PolicyManifest = {
    schemaVersion: 1,
    policyVersion: (options.policyVersion ?? DEFAULT_POLICY_VERSION).trim(),
    failureMode: options.failureMode ?? DEFAULT_FAILURE_MODE,
    limits: Object.freeze({
      maxContentLength: options.maxContentLength ?? DEFAULT_MAX_CONTENT_LENGTH,
      maxContactHistoryLength:
        options.maxContactHistoryLength ?? DEFAULT_MAX_CONTACT_HISTORY_LENGTH,
    }),
    approval: Object.freeze({
      signatureAlgorithm: "HMAC-SHA-256",
      exactActionBinding: true,
      nonceConsumption:
        options.approvalNonceConsumer === undefined ? "host-required" : "atomic-consumer",
    }),
    rules: Object.freeze(rules),
  };
  return Object.freeze(manifest);
}
