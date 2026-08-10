# Governance

VendaOS Guardrails is maintained in public under the Apache-2.0 license.

## Roles

- **Contributors** submit issues, documentation, tests, and code.
- **Reviewers** provide substantive review on areas they understand.
- **Maintainers** triage, merge, release, and handle private security reports.

The initial maintainer is the GitHub account `huenri`. Additional maintainers should demonstrate sustained, security-conscious contributions and agree to the repository's disclosure process.

## Decisions

Routine decisions are made through reviewed pull requests. Changes to decision semantics, approval verification, audit formats, trust boundaries, default rules, or licensing require:

- a public design issue, except during an embargoed security fix;
- explicit compatibility and threat analysis;
- tests demonstrating intended behavior and known failure modes;
- approval by a maintainer who did not author the final change when another maintainer is available.

Maintainers may reject changes that expand scope without a clear security boundary, add unnecessary dependencies, or imply legal certification.

## Releases

Releases follow semantic versioning once the public API stabilizes. Before 1.0, breaking changes may occur in minor versions and must be called out in the changelog. Release artifacts should be produced by reviewed automation with provenance when package publishing begins.

## Independence

The open-source core must remain usable without proprietary VendaOS services. Proprietary adapters may integrate with it, but the rules engine, tests, documentation, and public interfaces may not depend on private infrastructure.
