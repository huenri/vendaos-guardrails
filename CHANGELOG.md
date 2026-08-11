# Changelog

All notable changes will be documented here.

## [Unreleased]

## [0.2.0] — 2026-08-11

### Added

- Runtime adapters for untrusted JSON-shaped actions, including strict unknown-field handling,
  bounded minimized issues, an exported JSON Schema, and `GuardrailEngine.evaluateUnknown`.
- Atomic `ApprovalNonceConsumer` integration and `verifyAndConsumeApproval` for replay prevention.
- Validated, serializable policy manifests that exclude rules' executable code and secret material.
- Race-safe serialized outbox example that keeps evaluation, audit, history, and enqueue decisions
  in one transaction boundary.
- Deterministic property-style malformed-input tests and concurrent nonce-consumption tests.

### Changed

- Approval nonces are consumed only when an approval can change the final decision; storage errors
  and replay fail closed to `review`.
- Engine construction now validates policy versions, rule metadata, resource limits, nonce
  consumers, and approval secret strength.


## [0.1.0] — 2026-08-10

### Added

- Fail-closed rule engine with aggregate `allow`, `review`, and `block` decisions.
- Purpose-scoped consent, opt-out, local contact-window, frequency, discount, sensitive-data, and restricted-claim rules.
- Conservative Brazilian Portuguese starter policy.
- HMAC-SHA-256 approvals bound to the policy version, exact action context, and rule IDs.
- Privacy-minimized hash-chain audit records.
- Strict TypeScript build and synthetic test suite.
- Pinned CI, CodeQL, dependency review, and Dependabot configuration.
- English and Brazilian Portuguese documentation, threat model, governance, and security policy.
