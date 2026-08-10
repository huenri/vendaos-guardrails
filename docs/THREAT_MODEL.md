# Threat model

This document describes the v0.1 security boundary. It is a living design artifact, not a penetration-test report or security certification.

## Protected assets

- The ability to send a message or trigger another customer-facing side effect.
- Consent, opt-out state, contact history, and commercial authority.
- The server-side approval secret and reviewer identity.
- Decision and audit integrity.
- Customer privacy and message confidentiality.

## Trust boundaries

The sales agent and message content are untrusted. The guardrail package is a deterministic library running inside a trusted host. Consent, opt-out state, contact history, time, and reviewer identity must come from authenticated host services. The channel adapter must accept only an `allow` decision produced for the exact action it sends.

The package does not connect to a database, CRM, identity provider, or channel by itself. That keeps the core independent, but it means the host must enforce the boundary correctly.

## Threats and mitigations

| Threat | Current mitigation | Remaining responsibility |
|---|---|---|
| Agent invents consent or removes history | Required structured context; promotional rules fail closed | Host must fetch authoritative state and prevent agent-controlled fields |
| Agent changes an approved offer or message | Approval is HMAC-signed and bound to an exact fingerprint | Review service must protect the secret and reviewer authentication |
| Agent tries to approve a hard-blocked action | Engine applies approvals only to `review` | Host must reject sends unless the final aggregate decision is `allow` |
| Approval replay | Expiry, action binding, random nonce | Host must store consumed nonces durably and reject reuse |
| Rule crashes or returns malformed output | Exceptions and invalid outputs use the configured failure mode; default is `block` | Operators should alert on `RULE_EXECUTION_FAILED` |
| Customer is contacted at the wrong local time | IANA time-zone evaluation and explicit-offset timestamps | Host must maintain the correct customer time zone and current schedule |
| Excessive contact | Rolling-window cap over required history | Host must supply complete, race-safe history and serialize concurrent sends |
| Secret or identifier leaks in outbound content | Credential patterns block; selected identifiers route to review | Add domain-specific DLP; pattern detection is incomplete |
| Sensitive data appears in audit logs | Raw content and direct IDs are excluded; references are hashed | Use an append-only, access-controlled store and appropriate retention |
| Audit records are changed or reordered | Previous-hash chain detects in-memory changes | Anchor or sign chain heads externally; a hash chain alone is not secure storage |
| Resource exhaustion from very large content | Configurable maximum content length | Apply request, concurrency, and execution time limits in the host |
| Supply-chain compromise | No production dependencies; lockfile; pinned Actions; CI, CodeQL, dependency review | Protect branches, require reviews, enable secret scanning, verify releases |
| Outdated legal or policy defaults | Preset is versioned and explicitly non-certifying | Obtain current sector/location review and own the policy version lifecycle |

## Known limitations

- CPF, CNPJ, card, credential, and claim detectors are heuristic. They can miss transformed data and can flag harmless content.
- HMAC authenticates approval integrity; it does not authenticate the reviewer by itself.
- The engine runs rules sequentially but does not lock external state. A host must prevent time-of-check/time-of-use races.
- Customer and action identifiers are hashed without a secret in audit output. Low-entropy identifiers could be guessed. Use high-entropy pseudonymous IDs or add a host-side keyed transform before passing them.
- A compromised host process can bypass the library, steal approval material, or fabricate authoritative context.
- This package does not provide legal-basis determination, data-subject request handling, retention automation, or channel-provider compliance.

## Secure integration checklist

- Keep the agent in an untrusted execution boundary.
- Build `SalesAction` on the server from allow-listed fields.
- Read consent, opt-out state, and history from authoritative stores.
- Keep approval issuance in a separate authenticated service or privilege boundary.
- Store the HMAC secret in a managed secret store and rotate it through a versioned migration.
- Reject approvals after first use using the nonce.
- Re-evaluate immediately before sending and send exactly the fingerprinted action.
- Persist the evaluation and a minimized audit record atomically with the send decision.
- Monitor blocks, reviews, failures, and unusual approval volume.
- Test bypasses and race conditions in the complete integration, not only this package.
