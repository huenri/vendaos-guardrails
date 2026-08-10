export { createAuditRecord, verifyAuditChain } from "./audit.js";
export type {
  AuditRecord,
  AuditRuleResult,
  CreateAuditRecordOptions,
} from "./audit.js";
export { issueApproval, verifyApproval } from "./approval.js";
export type { IssueApprovalInput } from "./approval.js";
export { GuardrailEngine } from "./engine.js";
export { createActionFingerprint, hashIdentifier } from "./fingerprint.js";
export { createBrazilianPortuguesePolicy } from "./presets/brazilian-portuguese.js";
export type { BrazilianPortuguesePolicyOptions } from "./presets/brazilian-portuguese.js";
export { createConsentRule } from "./rules/consent.js";
export type { ConsentRuleOptions } from "./rules/consent.js";
export { createContactWindowRule, WEEKDAYS } from "./rules/contact-window.js";
export type {
  ContactWindowRuleOptions,
  TimeRange,
  Weekday,
  WeeklySchedule,
} from "./rules/contact-window.js";
export { createDiscountRule } from "./rules/discount.js";
export type { DiscountRuleOptions } from "./rules/discount.js";
export { createFrequencyCapRule } from "./rules/frequency-cap.js";
export type { FrequencyCapRuleOptions } from "./rules/frequency-cap.js";
export { createOptOutInstructionRule } from "./rules/opt-out-instruction.js";
export type { OptOutInstructionRuleOptions } from "./rules/opt-out-instruction.js";
export { createRestrictedClaimsRule } from "./rules/restricted-claims.js";
export type { RestrictedClaimsRuleOptions } from "./rules/restricted-claims.js";
export { createSensitiveDataRule } from "./rules/sensitive-data.js";
export type { SensitiveDataRuleOptions } from "./rules/sensitive-data.js";
export {
  CHANNELS,
  CONSENT_STATUSES,
  DECISIONS,
  PURPOSES,
} from "./types.js";
export type {
  ApprovalPayload,
  ApprovalStatus,
  Channel,
  CommercialOffer,
  ConsentRecord,
  ConsentStatus,
  ContactEvent,
  ContactPurpose,
  CustomerContext,
  Decision,
  EngineOptions,
  Evaluation,
  FailureMode,
  GuardrailRule,
  RuleContext,
  RuleDetail,
  RuleResult,
  SalesAction,
  SignedApproval,
} from "./types.js";
