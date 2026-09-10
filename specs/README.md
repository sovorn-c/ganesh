# Ganesh discovery artifacts

## Start here

Read [state.yaml](state.yaml) for the next authorized action and [execution-status.yaml](execution-status.yaml) for delivery status. Plans and blueprint audits are not implementation or production evidence.

The owner requested repository organization before E05. The approved source and test migration is implemented, verified, and reviewed on `main`; see [REFACTOR_LATEST.md](REFACTOR_LATEST.md) for scope and [../CONVENTIONS.md](../CONVENTIONS.md) for the rules. E05 remains paused until its planning workflow is explicitly resumed.

## Canonical artifacts

| Artifact | Owns |
|---|---|
| [../AGENTS.md](../AGENTS.md) and [../CONVENTIONS.md](../CONVENTIONS.md) | Agent routing, repository layout, review obligations, and project rules |
| [execution-status.yaml](execution-status.yaml) | Epic and story execution status |
| [epics/](epics/) | Story requirements and task plans; released capsules remain in archive |
| [verifications/](verifications/) | Historical validation evidence, not future promises |
| [adr/](adr/) | Recorded architectural decisions |
| [planning-context.yaml](planning-context.yaml) | Confirmed release intent, constraints, coverage, and exclusions |
| [product/VISION_LATEST.yaml](product/VISION_LATEST.yaml) | Confirmed product vision, operating model, and release-level non-goals |
| [product/PRIOR_ART.md](product/PRIOR_ART.md) | Local reuse findings, inspected evidence, and unperformed integration checks |
| [tech-architecture/tech-stack.md](tech-architecture/tech-stack.md) | Domain relationships, invariants, legal transitions, and concurrency contracts |
| [REFACTOR_LATEST.md](REFACTOR_LATEST.md) | Approved-plan gate and migration map for source/test organization |
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
It supplies acceptance scenarios and explanatory detail, not a competing authority or a required discovery output. Each epic capsule owns its story specifications and task ledgers.
Detailed engineering defaults in that blueprint remain proposals unless explicitly confirmed in canonical discovery artifacts.
The work-package dependency table is illustrative, not an approved epic plan.

## Outstanding technical verification

- Pi distribution/version, license, curated loading, and policy coverage of built-in UI/runtime paths; prior Pi SDK compatibility is treated as settled.
- Distribution support matrix and packaging behavior for the chosen local environments.
- Pi-compatible execution modes, per-project bash-guard behavior, parser/export fidelity, provider terms/access, and SQLite durability/recovery.
- Qualified-human evaluation of representative research cases before production release.

These obligations do not reopen the agreed product boundary, but implementation cannot assume they have passed.
Prior-art research was local and documentation-based; registry, external-source, licensing, and executable checks were not performed.
