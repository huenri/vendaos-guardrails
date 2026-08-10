# Roadmap

The roadmap is directional. Security and correctness take priority over feature count.

## 0.1 — auditable core

- Deterministic `allow` / `review` / `block` engine.
- Brazilian Portuguese starter policy.
- Exact-action HMAC approvals.
- Privacy-minimized hash-chain audit records.
- Strict types, synthetic tests, CI, CodeQL, and dependency review.

## 0.2 — integration hardening

- Runtime schema adapters for untrusted JSON input.
- Reference nonce-consumption interface for replay prevention.
- Race-safe host integration example with an outbox pattern.
- Policy configuration validation and machine-readable policy manifests.
- Expanded bypass and property-based tests.

## 0.3 — extensibility

- Web Crypto adapter for additional runtimes without weakening defaults.
- Versioned audit export schema and conformance fixtures.
- Domain packs maintained separately from the provider-neutral core.
- OpenTelemetry-safe event hooks that exclude content and direct identifiers.

## 1.0 criteria

- Stable public API and migration policy.
- Independent security review of approval and audit primitives.
- Documented production integration by at least one external adopter.
- Maintainer rotation and release provenance tested end to end.
- Clear compatibility and support policy.

Not planned for the core: CRM storage, message delivery, identity management, customer profiling, hidden behavioral inference, or claims of automatic legal compliance.
