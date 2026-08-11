export const CHANNELS = ["email", "sms", "whatsapp", "phone", "in_app"] as const;
export type Channel = (typeof CHANNELS)[number];

export const PURPOSES = ["transactional", "marketing", "sales_follow_up"] as const;
export type ContactPurpose = (typeof PURPOSES)[number];

export const CONSENT_STATUSES = ["granted", "denied", "unknown"] as const;
export type ConsentStatus = (typeof CONSENT_STATUSES)[number];

export const DECISIONS = ["allow", "review", "block"] as const;
export type Decision = (typeof DECISIONS)[number];

export interface ConsentRecord {
  readonly status: ConsentStatus;
  readonly capturedAt?: string;
  readonly source?: string;
}

export interface CustomerContext {
  /** Use a stable, pseudonymous identifier. Do not pass a name, email, CPF, or phone. */
  readonly id: string;
  /** IANA time zone, for example `America/Sao_Paulo`. */
  readonly timezone: string;
  readonly locale?: string;
  /** Permission records are scoped by channel and purpose. */
  readonly consent: Readonly<
    Partial<Record<Channel, Readonly<Partial<Record<ContactPurpose, ConsentRecord>>>>>
  >;
  readonly optedOutChannels: readonly Channel[];
}

export interface ContactEvent {
  readonly at: string;
  readonly channel: Channel;
  readonly purpose: ContactPurpose;
}

export interface CommercialOffer {
  readonly discountPercent?: number;
  readonly totalMinorUnits?: number;
  readonly currency?: string;
}

export interface ApprovalPayload {
  readonly version: 1;
  readonly actionFingerprint: string;
  readonly policyVersion: string;
  readonly ruleIds: readonly string[];
  /** Identity asserted by the authenticated host application. */
  readonly approvedBy: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
  readonly nonce: string;
}

export interface SignedApproval {
  readonly payload: ApprovalPayload;
  readonly signature: string;
}

export interface SalesAction {
  readonly id: string;
  readonly customer: CustomerContext;
  readonly channel: Channel;
  readonly purpose: ContactPurpose;
  readonly content: string;
  /** ISO 8601 timestamp with an explicit offset or `Z`. */
  readonly scheduledAt: string;
  /** Authoritative history supplied by the host application. */
  readonly contactHistory: readonly ContactEvent[];
  readonly offer?: CommercialOffer;
  readonly approval?: SignedApproval;
}

export type RuleDetail = string | number | boolean | readonly string[];

export interface RuleResult {
  readonly ruleId: string;
  readonly decision: Decision;
  readonly code: string;
  readonly message: string;
  /** Details must never include message content, direct identifiers, or secret values. */
  readonly details?: Readonly<Record<string, RuleDetail>>;
  readonly approvalApplied?: boolean;
}

export interface ApprovalStatus {
  readonly valid: boolean;
  readonly reason:
    | "valid"
    | "missing"
    | "secret_not_configured"
    | "malformed"
    | "invalid_signature"
    | "fingerprint_mismatch"
    | "policy_version_mismatch"
    | "not_yet_valid"
    | "expired"
    | "replayed"
    | "nonce_store_failed";
  readonly approvedRuleIds: readonly string[];
  readonly approvedBy?: string;
}

export interface ApprovalNonceConsumption {
  readonly nonce: string;
  readonly actionFingerprint: string;
  readonly policyVersion: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

/**
 * Atomically records a nonce if it has not been consumed before.
 *
 * Implementations must return `true` only for the first successful consumption across every
 * process that can authorize the same side effect. Production implementations should use a
 * durable unique constraint, compare-and-set, or equivalent transaction-safe primitive.
 */
export interface ApprovalNonceConsumer {
  consume(consumption: ApprovalNonceConsumption): boolean | Promise<boolean>;
}

export interface RuleContext {
  readonly action: SalesAction;
  readonly actionFingerprint: string;
  readonly evaluatedAt: Date;
  readonly approval: ApprovalStatus;
}

export interface GuardrailRule {
  readonly id: string;
  readonly description: string;
  evaluate(context: RuleContext): RuleResult | Promise<RuleResult>;
}

export interface Evaluation {
  readonly version: 1;
  readonly policyVersion: string;
  readonly decision: Decision;
  readonly evaluatedAt: string;
  readonly actionFingerprint: string | null;
  readonly results: readonly RuleResult[];
  readonly approval: ApprovalStatus;
}

export type FailureMode = "block" | "review";

export interface EngineOptions {
  readonly rules: readonly GuardrailRule[];
  readonly policyVersion?: string;
  readonly failureMode?: FailureMode;
  readonly approvalSecret?: string | Uint8Array;
  readonly approvalNonceConsumer?: ApprovalNonceConsumer;
  readonly maxContentLength?: number;
  readonly maxContactHistoryLength?: number;
  readonly clock?: () => Date;
}
