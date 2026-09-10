# Ganesh release blueprint audit

**Verdict: READY — e02 is ready for `/bp-build`; e01 is complete and the remaining release is not implementation-ready**

## Gate scope

This audit covers the complete release blueprint, the released e01 baseline, and the completed e02 `/bp-plan` handoff. It is not a build or production-readiness verdict for e02 or the remaining epics.
E01 is released locally. E02 has three vertical story specifications, a risk-scaled test plan, and runnable task ledgers; the other 16 epics remain intentionally blueprint-only.
Product discovery is confirmed; no release outcome is removed to accommodate sequencing.

## Principles and conventions

| Check | Result | Evidence |
|---|---|---|
| Complete bounded release | PASS | R01–R18 each map to exactly one epic; exclusions have reasons |
| Architecture constraints | PASS | Three interface alternatives compared; focused commands selected in ADR 0002 |
| Greenfield applicability | N/A | No implemented modules to deepen; no fabricated depth scores or refactoring |
| Observable epic outcomes | PASS | Every manifest retains its scope acceptance outcomes |
| Domain language | PASS | Canonical glossary, domain model and ADR 0001 preserved |
| Stable epic IDs and dependencies | PASS | Eighteen capsule manifests; dependency-constrained WSJF order |
| Estimates | PROVISIONAL | 440 aggregate BCP; uncalibrated epic estimates, ranges and formula recorded |
| Story vertical slices and task checks | PASS for e01/e02; DEFERRED for e03–e18 | E01 is released; e02 has three dependency-ordered vertical stories, an epic test plan, and runnable failing-ledger verification; remaining epics retain deferred planning |
| Agent/project conventions | PASS | CLAUDE.md and CONVENTIONS.md present; Conventional Commits and solo-git |
| Source control | PASS | E01 is merged into local main; e02 planning remains on main with no new feature branch or commit created in this planning step |
| Implementation readiness | READY for e02 build handoff; BLOCKED for e02 execution/release | E01's baseline exists and is released; e02 tasks are implementation-ready, but e02 persistence code and behavior remain unbuilt |

## Complete scope-to-roadmap coverage

Order respects dependencies; each eligible set is sorted by descending WSJF, then stable ID.
There is no independent intermediate production release.

| Order | Epic | Outcome | Scope | BCP | WSJF | Prerequisites |
|---|---|---|---|---|---|---|
| 1 | e01 | Verified development and runtime baseline | R01 | 13 | 2.154 | — |
| 2 | e02 | Durable versioned research projects | R02 | 21 | 1.381 | e01 |
| 3 | e03 | Enforced data-use and capability controls | R03 | 34 | 0.882 | e01, e02 |
| 4 | e04 | Human commitments and research alternatives | R04 | 21 | 1.381 | e02, e03 |
| 5 | e06 | Local import and source inspection | R06 | 21 | 1.095 | e02, e03 |
| 6 | e05 | Bounded autonomous work and specialist coordination | R05 | 34 | 0.853 | e03, e04 |
| 7 | e14 | Accessible terminal research workspace | R14 | 21 | 1.238 | e04, e05, e06 |
| 8 | e07 | Located evidence and accountable claims | R07 | 21 | 1.190 | e05, e06 |
| 9 | e08 | Literature discovery and contribution challenge | R08 | 21 | 1.000 | e07 |
| 10 | e15 | Recovery portability and controlled deletion | R15 | 34 | 0.853 | e02, e03, e05 |
| 11 | e16 | Private operational diagnostics and reliability | R16 | 21 | 1.143 | e01, e05, e15 |
| 12 | e09 | Research framing and method-sensitive design | R09 | 34 | 0.706 | e08, e04 |
| 13 | e10 | Ethics and external authorization | R10 | 21 | 1.333 | e09, e03 |
| 14 | e12 | Study progress and protocol change | R12 | 13 | 1.615 | e04, e09, e10 |
| 15 | e11 | User-controlled local analysis and test execution | R11 | 34 | 0.824 | e05, e06, e09, e10 |
| 16 | e13 | Interpretation writing and supervisor exchange | R13 | 21 | 1.095 | e07, e11, e12 |
| 17 | e17 | Scholarly and adversarial release qualification | R17 | 34 | 0.882 | e08, e09, e10, e11, e12, e13, e14, e15, e16 |
| 18 | e18 | Installable maintained local release | R18 | 21 | 1.381 | e17 |

## Research competency ownership

This table maps the complete competency catalog in `docs/03-agents-and-skills.md`, not just generic lifecycle headings.
Runtime packaging and role/capability contracts belong to e05; metadata/license/example qualification belongs to e17.

| Competency | Owning epic |
|---|---|
| Research orientation and problem framing | e09 |
| Research landscape mapping | e08 |
| Review protocol and query design | e08 |
| Literature discovery and citation exploration | e08 |
| Corpus screening and coverage assessment | e08 |
| Structured paper reading | e07 |
| Claim and evidence extraction | e07 |
| Critical appraisal | e07 |
| Claim and citation verification | e07 |
| Evidence matrix and synthesis | e07 |
| Gap and contribution challenge | e08 |
| Research-question and framework design | e09 |
| Philosophy and positionality alignment | e09 |
| Methodology comparison and study design | e09 |
| Sampling and recruitment planning | e09 |
| Measurement and instrument design | e09 |
| Analysis planning and execution guidance | e09 + e11 |
| Methodology alignment audit | e09 |
| Ethics, cultural responsibility and data planning | e10 |
| Study progress and amendment assessment | e12 |
| Interpretation and research writing | e13 |
| Research review and feedback resolution | e13 |

## Preflight answers and hard gates

| Question | Answer |
|---|---|
| Test | `npm test` — e01 baseline passed under Node.js 24; e02 scenarios remain unimplemented |
| Build | `npm run build` — e01 baseline passed; e02 implementation is not yet built |
| Lint | `npm run lint` — e01 baseline passed; e02 implementation is not yet linted |
| Typecheck | `npm run typecheck` — e01 baseline passed; e02 implementation is not yet typechecked |
| Preflight | `npm test && npm run lint && npm run typecheck && npm run build` — e01 baseline passed; e02 behavior remains unimplemented |
| CI | None; local repeatable gates required by e01/e17/e18; hosted CI intentionally deferred |
| Workflow | solo-git; explicit authorization for branches, commits and publication |
| Stack | TypeScript, Node 24 LTS target, reused Pi SDK/TUI, SQLite and artifacts; local execution follows user-selected Pi modes |
| Baseline | E01 TypeScript/Node runtime baseline is implemented and released; e02 product persistence code and tests remain absent |

- **e01:** released locally with manifest/lockfile, Node 24 target, dependency evidence, reproducible commands, and preflight baseline.
- **e02:** implement SQLite/artifact durability, exact dependency references, branch concurrency/history, recovery, schema status, and read-only inspection according to the active capsule and test plan.
- **e03:** prove no owner-authority/disclosure bypass through Pi commands, sessions, resources, tools or attachments before sensitive data or autonomous operations.
- **e11:** define and verify Pi-compatible ask/approve/full-access behavior and the per-project bash guard before enabling agent-run local commands; no sandbox guarantee is implied.
- **e14:** qualify accessible critical terminal flows; naming a keyboard shortcut is not accessibility evidence.
- **e15/e16:** prove recovery, migration, retention, private diagnostics and reliability outcomes before shipment.
- **e17:** obtain qualified-human evaluation and adversarial behavioral evidence across all approved method profiles and disciplinary contexts.
- **e18:** verify distribution, applicable signing, installation/upgrade/uninstall, user guidance and final release evidence before explicit publication.

## Validation and review evidence

- Executed `ruby specs/verifications/check-blueprint.rb`: PASS after validating the released e01 capsule, planned e02 story manifests, task ledgers, BCP totals, maturity, dependency order, and runnable verification fields while retaining deferred-empty validation for e03–e18.
- The check parses YAML, verifies scope/epic acceptance equality, all AC-01–20 ownership outside the qualification epic, dependencies, eligible WSJF selection, estimates, manifests, status IDs, and planned-story artifact consistency.
- The standard `validate-specs-yaml.sh specs` was attempted and failed because Python lacks PyYAML. Its generic invalid-YAML message is not evidence of a syntax defect; independent Ruby parsing passed.
- This alternate documentation gate does not waive the missing standard tooling requirement assigned to e01/B04. E01 installed and verified its locked baseline; e02 planning adds no application dependency and uses the Node.js 24 SQLite boundary as an implementation verification obligation.
- First independent review found incorrect scenario references and an omitted explicit monetary cap; both were corrected in scope and manifests.
- E02 planning adds `e02-TEST_PLAN_LATEST.md` with nine risk-scaled scenarios covering restart, atomicity, concurrency, branch isolation, recovery, schema compatibility, and read-only inspection.
- Independent re-audit returned READY FOR `/bp-plan`, confirming semantic scenario ownership, all 22 competencies, full production coverage, dependencies and monetary-cap acceptance.
- No e02 application tests, build, lint, typecheck, runtime security checks or scholarly evaluations ran; e02 task ledgers therefore remain failing by design. E01's baseline checks are historical release evidence.
- The package-referenced `scripts/sync-status-from-epics.sh` is absent. E02 status was synchronized through explicit `specs/execution-status.yaml`, `specs/planning-status.yaml`, and `specs/state.yaml` edits; this is a tooling limitation, not a hidden gate bypass.

## Handoff limits

E02 is ready for `/bp-build` planning handoff, not evidence that e02 implementation or persistence behavior passes. E01 is complete; e03–e18 remain blueprint-only and the complete release is not production-ready.
Every recorded runtime/operational blocker has an owning epic. No approved scope outcome is deferred outside the release.
