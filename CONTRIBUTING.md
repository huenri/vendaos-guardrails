# Contributing

Thank you for helping build a small, auditable guardrail layer for sales agents.

## Before opening a change

- Read the [threat model](docs/THREAT_MODEL.md).
- Search existing issues and pull requests.
- For a new rule or changed default, open a focused issue describing both false-allow and false-block risks.
- Report security concerns privately according to [SECURITY.md](SECURITY.md).

## Local setup

```bash
npm ci --ignore-scripts
npm run check
```

The repository supports Node.js 22 and 24. `npm run check` performs strict type-checking, runs tests, builds declarations, and inspects the package contents.

## Change requirements

- Keep the production dependency count at zero unless a proposal documents a compelling security and maintenance case.
- Preserve fail-closed defaults. Any relaxed failure mode must be explicit.
- Never allow human approval to override `block`.
- Do not put raw message content, direct identifiers, matched sensitive values, or secrets into evaluation details or audit records.
- Bind commercial approvals to the exact proposed action.
- Add tests for allowed, review, blocked, malformed, and bypass cases where applicable.
- Use synthetic fixtures only.
- Keep public APIs provider-neutral and independently usable.
- Update the English and Brazilian Portuguese docs when user-visible behavior changes.

## Commit and pull request scope

Keep changes small enough to review. Explain the security boundary, tradeoffs, and compatibility effect in the pull request template. Maintainers may request a threat-model update or an independent review for high-impact changes.

By contributing, you agree that your contribution is licensed under Apache-2.0 and that you have the right to submit it.
