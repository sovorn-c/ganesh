# Plan Audit — Ganesh E05 Bounded Autonomous Work

**Date:** 2026-09-12
**Mode:** Implementation plan
**Roadmap revision:** `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`
**E05 plan revision:** `sha256:68a783527f733bbea19d8948785168e9469dfa45e9fb3b60c358ace5fa7ab373`
**Audit verdict:** READY for owner review
**Owner decision:** APPROVED for the exact plan revision below

This is an implementation-plan build gate for the exact E05 revision above. Earlier scope-only or epic-only READY verdicts do not satisfy this gate. A READY verdict is not by itself owner approval, implementation start, evidence that any E05 task passes, production readiness, or scholarly validation. Owner approval of this exact revision is recorded in Owner Decision below; `/bp-build` remains a separate request.

This audit ends at the planning approval checkpoint. It must not recommend `survey-context`, and it must not start build skills.

## Inputs Audited

- `specs/epics/e05-bounded-work/epic.yaml`
- Five E05 countable story specifications and five failing task ledgers
- `specs/tech-architecture/e05-TEST_PLAN_LATEST.md`
- `specs/IMPACT_LATEST.md`
- `specs/product/SCOPE_LATEST.yaml` R05; `specs/release-plan.yaml` e05 entry
- `specs/state.yaml` and `specs/execution-status.yaml`
- `CONVENTIONS.md`; `specs/tech-architecture/tech-stack.md` work/execution transitions; `specs/UBIQUITOUS_LANGUAGE_LATEST.md`; ADR 0001; `specs/tech-architecture/DESIGN_PLAN_LATEST.md` focused commands
- Current `src/index.ts`, `src/lifecycle/lifecycle-types.ts`, `src/authority/capability-types.ts`, `src/persistence/schema.ts` create/migrate/open paths, and `src/project/project-store.ts` writable-ready ensure — static inspection only

No production/test code, dependency, branch, commit or delivery-loop change was made. No build, test, lint, typecheck, preflight or task verification command was run during this planning audit.

Plan-revision digest was recomputed as `shasum -a 256` over the twelve story/task/test-plan/IMPACT files (excluding `epic.yaml` stamps) and matches `68a783527f733bbea19d8948785168e9469dfa45e9fb3b60c358ace5fa7ab373`.

## Principles Alignment

| Check | Status | Evidence |
|---|---|---|
| Vertical slices | ✅ | Five user-visible slices: one authorized least-privilege run; five-role candidates and disagreements; cumulative budgets/spend caps; cancel fences and late-output quarantine; honest provider degradation and session rebind. |
| Dependency order | ✅ | `e05s01` first; `e05s02` and `e05s03` after `e05s01`; `e05s04` after `e05s01`+`e05s03`; `e05s05` after `e05s01`+`e05s03`+`e05s04`. |
| Scope bounded | ✅ | Every story has explicit non-goals. Scholarly competencies (E07–E13), terminal UX (E14), analysis execution (E11), export/deletion (E15), live provider spend and production-release claims stay out. |
| Success criteria | ✅ | 19 uniquely named `SC-e05sYY-P{0\|1}-NN` scenarios appear in the test plan, story §17 Gherkin, and task-ledger `scenarios:` lists. |
| Runnable work | ✅ | 20 tasks have non-empty shell `verify:` commands, all begin with a Node.js 24 major-version guard, and all remain `status: failing`. |
| Requirement deltas | ✅ | Net-new contracts are `ADDED`. Schema initialization is `MODIFIED` with explicit before/after that matches current `createSchema` / `migrateSchema` / writable-ready `openProject` (E04+E06 ensure today). |
| Domain language | ✅ | Work contract, run, standing permission, specialist role, candidate, and human commitment remain distinct; Ganesh Supervisor is not the academic supervisor. |
| Research integrity | ✅ | SessionPort fakes and schema-validated specialist bytes are not treated as scholarly correctness; E07–E13 own competencies. |
| Human authority | ✅ | Succeeded runs register candidates only; tests must keep `listCommitments` empty. E04 owner disposition remains the exclusive commitment path. The plan uses DESIGN_PLAN name `disposePacket`; shipped code is `recordOwnerDecision` / commitment APIs. Observable prohibition is the empty commitment list, not a new commitment helper. |

## Architecture and Impact

| Check | Status | Evidence |
|---|---|---|
| Zoom-out mandate | ✅ | `specs/IMPACT_LATEST.md` names purpose, current callers/dependents and preserved contracts for schema, project-store, capability-broker, lifecycle-gate, policy/disclosure, decisions and `src/index.ts` (plus artifact registration). |
| Placement | ✅ | New code targets `src/work/`; behavior-owned tests target `tests/work/` and `tests/support/work-fixtures.ts`. Story IDs remain traceability metadata and `node --test` name patterns, not filenames. `src/work/` and `tests/work/` do not exist yet. |
| Minimal abstraction | ✅ | Focused commands; no workflow engine, plugin registry or second agent SDK. A one-implementation `SpecialistSessionPort` is justified so tests never construct `createAgentSessionRuntime`. |
| Schema compatibility | ✅ | Schema marker stays v1. Idempotent `createE05Schema` is planned on create, migrate and writable ready-open. Explicit read-only, migration-required and unknown-future opens never mutate. Missing tables return typed `work-schema-unavailable`. Static inspection: current ensure paths call only `createE04Schema` and `createE06Schema`. |
| Policy reuse | ✅ | Each run maps to a lifecycle operation. Dispatch calls `checkLifecyclePolicy`; provider calls use phase `external` plus `requestDisclosure`; `acceptSubmission` requires a passing acceptance checkpoint; resume reuses existing `resumeOperation` rather than caching contract-time grants. Unauthorized fallback is forbidden. |
| Commitment isolation | ✅ | Candidate registration uses E02; run success must not call E04 disposition/commitment APIs. |
| Downstream contracts | ✅ | Role-tagged candidates, diagnostics, disagreements, budgets and quarantine records support E07–E14/E16/E17 without implementing those epics. |

## Test Architecture

| Check | Status | Evidence |
|---|---|---|
| Risk scaling | ✅ | 15 P0 and 4 P1 scenarios cover authority, policy, accounting, cancel/quarantine, providers and rebind. |
| Scenario identity | ✅ | All 19 IDs are unique and present in test plan, Gherkin, and ledgers: s01 P0-01..03 + P1-04; s02 P0-01..03 + P1-04; s03 P0-01..04; s04 P0-01..02 + P1-03; s05 P0-01..03 + P1-04. |
| Happy and failure paths | ✅ | Every unfinished story has both: admit/register versus deny; retain disagreement versus recursive-authority deny; admit versus over-admission/unknown-price deny; cancel fence versus late/current and remote-stop failure; rebind versus timeout/fallback/uncertain-zero. |
| Isolation | ✅ | Temporary SQLite projects; injected `SpecialistSessionPort`; no `~/.pi`, network, real research data or real Pi session. Cleanup in `finally`. |
| Regression safety | ✅ | Final tasks require typecheck, lint, build and the complete inherited suite under a Node.js 24 guard. |
| AC coverage | ✅ | AC-09: SC-e05s01-P1-04 and snapshot/capability denies. AC-14: SC-e05s02-P0-02. AC-17: SC-e05s04-P0-02 plus reservation/reopen and uncertain-usage rules. |
| Evidence limits | ✅ | Tests prove deterministic software behavior with fakes and synthetic fixtures, not model quality, provider uptime, scholarship or complete-release readiness. |

## Dependency Slopcheck and Approval Gates

| Package | Tag | Decision basis |
|---|---|---|
| `@earendil-works/pi-coding-agent@0.85.1` | `[OK]` | Already locked. Production adapter may wrap `createAgentSessionRuntime` and must re-subscribe after `runtime.session` replacement per installed `docs/sdk.md`. Tests inject a port fake and never touch the network. |

No new production or test package is proposed. Rejected: additional agent frameworks, queue/workflow engines, extra HTTP clients and real provider SDKs.

Owner approval of this exact revision does not need a new `[SUS]` dependency gate. Any new package or material adapter substitution invalidates this approval candidate and requires re-audit.

## Conventions Completeness

| Check | Status | Note |
|---|---|---|
| Agent/project guidance | ✅ | `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` exist and require responsibility ownership, FIRST tests and no direct main commits. |
| Planning layout | ✅ | E05 artifacts are under `specs/epics/e05-bounded-work/`; shared test/impact/audit artifacts use documented `specs/` ownership. |
| Git mode | ✅ | `solo-git`; no current branch/commit/build authorization. Conventional Commits required later. Implementation must use a feature branch after approval. |
| Runtime | ✅ | Node.js 24 LTS and npm 11; every task command fails before work if foreground `node` is not major 24. |
| CI | ✅ | No CI configured; applicable local checks are required before integration. |

## Pre-flight Answers

| Item | Value |
|---|---|
| Language/runtime | TypeScript on Node.js 24 LTS |
| Framework/runtime reuse | Pi SDK/TUI; local SQLite plus artifact files |
| Existing codebase | Yes; E01–E04 and E06 released locally |
| Test | `npm test` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Preflight | `npm run preflight` |
| Full local gate | `npm test && npm run lint && npm run typecheck && npm run build` |
| CI platform | Not configured |
| Git workflow | Solo/local; feature branch required before implementation |

## Coverage of R05

| R05 / epic acceptance outcome | Owning stories | Named scenarios |
|---|---|---|
| Five roles, least-privilege snapshots, versioned candidates, diagnostics, disagreements | e05s01 tracer; e05s02 | SC-e05s02-P0-01, SC-e05s02-P0-02, SC-e05s02-P1-04 |
| Exact contracts and standing permissions; finite token/call/time; cumulative reservation across retry, concurrency, revision, restart | e05s01, e05s03 | SC-e05s01-P0-01, SC-e05s01-P0-03, SC-e05s03-P0-01, SC-e05s03-P0-02 |
| Cancel fences dispatch and acceptance; late outputs quarantined; unknown/uncertain not zero | e05s03, e05s04, e05s05 | SC-e05s04-P0-01, SC-e05s04-P0-02, SC-e05s03-P0-04, SC-e05s05-P1-04 |
| Provider failure/timeout, bounded retries, consented destination, session rebind, no unauthorized fallback | e05s05 | SC-e05s05-P0-01, SC-e05s05-P0-02, SC-e05s05-P0-03 |
| Known-price spend cap reserved before dispatch and preserved; unknown pricing cannot satisfy a required monetary guarantee | e05s03 | SC-e05s03-P0-03, SC-e05s03-P0-04 |
| AC-09, AC-14, AC-17 | e05s01, e05s02, e05s04 | SC-e05s01-P1-04, SC-e05s02-P0-02, SC-e05s04-P0-02 |

Epic `acceptance_outcomes` match R05 `success_criteria`. Release-plan e05 depends on e03 and e04, sequence 6, 34 BCP.

## Static Validation Evidence

- `bash scripts/lib/plan-consistency-check.sh specs/epics/e05-bounded-work/` → `CRITICAL=0 HIGH=0 MED=0`, PASS.
- `ruby specs/verifications/check-blueprint.rb` → PASS: 18 epics, 18 outcomes, AC-01–20, dependency/WSJF order, BCP totals, YAML, capsule/task status.
- Custom E05 ledger check → 34 BCP, 20 failing Node-24-guarded tasks, 19 unique scenario IDs in test plan, Gherkin and ledgers.
- Plan-revision hash of story specs + task ledgers + test plan + IMPACT (excluding `epic.yaml`) → `sha256:68a783527f733bbea19d8948785168e9469dfa45e9fb3b60c358ace5fa7ab373`.

These are planning-structure checks. They do not flip any task to passing and do not replace implementation verification.

## Open Plan Defects

None that block this exact revision.

Non-blocking observations for implementers after owner approval:

- DESIGN_PLAN names `disposePacket` and `resumeRun`; shipped E04/E03 entry points are `recordOwnerDecision` and `resumeOperation`. The plan already requires empty commitments and lifecycle mapping.
- The current-policy NFR regex omits the literal `resume`; resume coverage is the existing lifecycle-gate plus IMPACT’s mapping obligation.

## Owner Decision

**APPROVED** for exact E05 plan revision `sha256:68a783527f733bbea19d8948785168e9469dfa45e9fb3b60c358ace5fa7ab373` at `2026-09-11T20:58:00Z` from an explicit owner message. This does not authorize implementation start, evidence that any E05 task passes, production readiness, or scholarly validation. Implementation start remains a separate `/bp-build` request.

## Verdict

**READY and owner-approved** for exact E05 plan revision `sha256:68a783527f733bbea19d8948785168e9469dfa45e9fb3b60c358ace5fa7ab373`.

The plan has bounded vertical stories, explicit contracts/non-goals, shared-module impact, 19 mapped scenarios, runnable Node.js 24 task checks, no new packages, and no unresolved CRITICAL/HIGH plan defect. E05 remains unimplemented and not production-ready.

Plan approval is recorded. `/bp-build` is the next authorized command and starts at `e05s01` on an authorized feature branch. This audit must not recommend `survey-context`.
