# Ganesh discovery artifacts

## Status

The owner confirmed the complete production-release intent, project conventions, and domain model.
The complete release blueprint is audited READY for `/bp-plan`, and e01 now has a complete implementation-ready story plan: 18 epics cover the full release.
No dependencies or application code were created; e01 story specifications and task ledgers now exist for the authorized planning step.
Environment blockers remain assigned to release epics; e01 planning readiness is not build or production readiness.
Blueprint artifacts are planning documents, not implementation or production evidence.

## Canonical artifacts

| Artifact | Owns |
|---|---|
| [../CLAUDE.md](../CLAUDE.md) and [../CONVENTIONS.md](../CONVENTIONS.md) | Approved project conventions and intended commands |
| [planning-context.yaml](planning-context.yaml) | Confirmed release intent, constraints, coverage, and exclusions |
| [product/VISION_LATEST.yaml](product/VISION_LATEST.yaml) | Confirmed product vision, operating model, and release-level non-goals |
| [product/PRIOR_ART.md](product/PRIOR_ART.md) | Local reuse findings, inspected evidence, and unperformed integration checks |
| [tech-architecture/tech-stack.md](tech-architecture/tech-stack.md) | Domain relationships, invariants, legal transitions, and concurrency contracts |
| [adr/0001-research-authority-outside-pi-sessions.md](adr/0001-research-authority-outside-pi-sessions.md) | Accepted authority/persistence trade-off |
| [UBIQUITOUS_LANGUAGE_LATEST.md](UBIQUITOUS_LANGUAGE_LATEST.md) | Canonical terminology; product glossary YAML is an index to this file |
| [product/SCOPE_LATEST.yaml](product/SCOPE_LATEST.yaml) | Complete release outcomes and exclusions |
| [release-plan.yaml](release-plan.yaml) | Ordered epic index, dependencies and provisional estimates |
| [tech-architecture/DESIGN_PLAN_LATEST.md](tech-architecture/DESIGN_PLAN_LATEST.md) | Interface alternatives and selected design |
| [PLAN-AUDIT_LATEST.md](PLAN-AUDIT_LATEST.md) | Blueprint audit, coverage and pre-build blockers |
| [state.yaml](state.yaml) | Current lifecycle status and next command |
| [verifications/DISCOVERY_LATEST.md](verifications/DISCOVERY_LATEST.md) | Documentation checks and limits of the readiness verdict |

## Supplementary material

[docs/README.md](docs/README.md) indexes the earlier six-document blueprint, reconciled with the confirmed discovery decisions.
It supplies acceptance scenarios and explanatory detail, not a competing authority or a required discovery output. The active e01 capsule owns its story specifications and task ledgers after `/bp-plan`.
Detailed engineering defaults in that blueprint remain proposals unless explicitly confirmed in canonical discovery artifacts.
The work-package dependency table is illustrative, not an approved epic plan.

## Outstanding technical verification

- Pi distribution/version, license, curated loading, and policy coverage of built-in UI/runtime paths; prior Pi SDK compatibility is treated as settled.
- Distribution support matrix and packaging behavior for the chosen local environments.
- Pi-compatible execution modes, per-project bash-guard behavior, parser/export fidelity, provider terms/access, and SQLite durability/recovery.
- Qualified-human evaluation of representative research cases before production release.

These obligations do not reopen the agreed product boundary, but implementation cannot assume they have passed.
Prior-art research was local and documentation-based; registry, external-source, licensing, and executable checks were not performed.
