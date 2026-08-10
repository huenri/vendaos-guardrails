# Security policy

## Supported versions

Until 1.0, only the most recent tagged minor release receives security fixes. APIs may still change between minor versions and will be documented in the changelog.

## Report a vulnerability privately

Do not open a public issue for a suspected vulnerability. Use GitHub's private vulnerability report at:

https://github.com/huenri/vendaos-guardrails/security/advisories/new

Include:

- affected version and environment;
- a minimal reproduction using synthetic data only;
- security impact and affected trust boundary;
- any proposed mitigation;
- whether you know of active exploitation or public disclosure.

Do not send credentials, production logs, real customer messages, direct identifiers, or third-party personal data. If GitHub private reporting is unavailable, open a public issue containing no vulnerability detail and ask a maintainer to establish a private channel.

We aim to acknowledge a complete report within five business days. Resolution time depends on severity and complexity. We will coordinate disclosure and credit with the reporter unless anonymity is requested.

## In scope

- A path from `block` or `review` to an unauthorized `allow`.
- Approval forgery, scope bypass, fingerprint confusion, or unexpected approval of a block.
- Leakage of raw content, direct identifiers, secrets, or approval material through documented outputs.
- Audit-chain verification flaws.
- Denial of service within documented input limits.
- Supply-chain or workflow flaws in this repository.

Configuration choices, outdated local policies, missing host authentication, incomplete history supplied by the host, and heuristic false positives are normally integration concerns unless the library contradicts its documented security boundary.

## Disclosure and fixes

Security fixes should include a regression test, impact statement, affected versions, and safe upgrade guidance. Releases may withhold exploit detail until users have a reasonable opportunity to update.
