# Plan Audit — Ganesh E15 Recovery Portability and Controlled Deletion

**Date:** 2026-09-12
**Mode:** Implementation plan
**Roadmap revision:** `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`
**E15 plan revision:** `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2`
**Audit verdict:** READY and owner-approved
**Owner decision:** APPROVED for the exact plan revision below

This is an implementation-plan build gate for the exact E15 revision above. Earlier E05/E06/E07/E08/E14 or scope-only READY verdicts do not satisfy this gate. A READY verdict is not by itself owner approval, implementation start, evidence that any E15 task passes, production readiness, or scholarly validation. Owner approval of this exact revision is recorded in Owner Decision below; `/bp-build` remains a separate request.

This audit ends at the planning approval checkpoint. It must not start build skills.

## Inputs Audited

- `specs/epics/e15-recovery-portability/epic.yaml`
- Five E15 countable story specifications and five failing task ledgers
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md`
- `specs/IMPACT_LATEST.md`
- `specs/product/SCOPE_LATEST.yaml` R15; `specs/release-plan.yaml` e15 entry (`depends_on` e02, e03, e05; those are done)
- `specs/state.yaml` and `specs/execution-status.yaml`
- `CONVENTIONS.md`; `specs/tech-architecture/tech-stack.md` invariants 5 and 11 plus deletion/export/backup concurrency rows; `specs/UBIQUITOUS_LANGUAGE_LATEST.md` (Project snapshot, Evidence tombstone, Revocation, Review packet); `specs/docs/05-decisions-and-acceptance.md` AC-08, AC-17, AC-20
- Current `src/persistence/schema.ts` `createSchema` / `migrateSchema` / `createE08Schema`, `src/project/project-store.ts` writable ready ensure path, `src/project/project-types.ts` `PROJECT_SCHEMA_VERSION` and `failAt`, `src/branches/recovery.ts` `recoverProject`, `src/artifacts/artifact-store.ts` `inspectArtifactVersion` / `registerArtifactVersion`, `src/policy/disclosure-types.ts` `DISCLOSURE_OPERATIONS`, `src/policy/disclosure-gateway.ts` `requestDisclosure`, `src/policy/policy-store.ts` `withdrawDataUse` and permission status, `src/authority/capability-broker.ts` `protectCanonicalWrite` / `OWNER_OPERATIONS` / `ownerAction`, `src/decisions/commitment-store.ts` `listCommitments`, `src/decisions/readiness-store.ts`, `src/lifecycle/lifecycle-gate.ts`, `src/work/work-runtime.ts` assigned-input unavailable path, `src/index.ts`, `package.json` — static inspection only

No production/test code, dependency, branch, commit or delivery-loop change was made. Story specs, task ledgers, the test plan and IMPACT were not modified after hashing. No build, test, lint, typecheck, preflight or task verification command was run during this planning audit.

Plan-revision digest was recomputed as `shasum -a 256` over the concatenated `shasum -a 256` lines of the twelve story/task/test-plan/IMPACT files (excluding `epic.yaml` stamps) and **matches** `d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2`.

Per-file SHA-256 inputs:

| File | SHA-256 |
|---|---|
| `e15s01-versioned-project-export-integrity-and-permissions.md` | `0accde2d684d4c26f9532b8706fc3ed00ef783aaf0d9965af2b014eb61a6ddf6` |
| `e15s01-tasks.yaml` | `9b9bc58895f1590d8c3f5a4adefa9563488463dd3231eca33f329fa69622ef93` |
| `e15s03-crash-disk-full-corruption-and-concurrent-launches.md` | `ab307d647164e32d5720a202a974ce67568e3d8cbcb7f595633c19efb86d6a15` |
| `e15s03-tasks.yaml` | `4f053f1912ac01596db2e035a63f6fc136843cf2c6b913345ea8645c15ed51d0` |
| `e15s02-backup-restore-migrations-and-restore-drills.md` | `79998e8d19e03ca7cb921fd2ec95d2295be7a7455f19638b183b3e9e05e91c53` |
| `e15s02-tasks.yaml` | `9497a369aa63e0d37961954f52c5e420e94f41a306a6d13d432ca55d66d97088` |
| `e15s04-controlled-deletion-of-derived-content-and-caches.md` | `89a85bf7af29d5a88f3b7b7a8b94b32cdc4bb3ce5924934a7f76a60d2e31defd` |
| `e15s04-tasks.yaml` | `6fbc3b75ad4a36ef8d072ac48480f331c7a6520259620b87a8bdc499944b04d7` |
| `e15s05-stale-restore-cannot-reinstate-withdrawn-grants.md` | `93430f8d9210ee6529d358154a54b8260b0d898bca5276939af7e95692a93b77` |
| `e15s05-tasks.yaml` | `a8b83a3309b91a84efe93e464fa825cd688d698b20d5ba7c4e28f65670729de4` |
| `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` | `9c0d3c044845acee41c100cb75dbe67c765198b6bc591b38754069fb5ef34357` |
| `specs/IMPACT_LATEST.md` | `d908a6393c3cb7e0160a93c570e7c07abd2ef161a261030713227ea36b341ebc` |

## Principles Alignment

| Check | Status | Evidence |
|---|---|---|
| Vertical slices | ✅ | Five user-visible slices: versioned directory export; crash/disk-full/lock hardening; backup/materialize/drill/`migrateWithBackup`; controlled deletion with tombstones; restore-replace that cannot reactivate withdrawn grants. e15s01 and e15s03 are independently demonstrable. e15s04 does not require export. |
| Dependency order | ✅ | `e15s01` first; `e15s03` independent; `e15s02` after s01+s03; `e15s04` after s03; `e15s05` after s01+s02+s04. Release-plan e15 depends on done e02, e03 and e05. |
| Scope bounded | ✅ | Every story has explicit non-goals. Writing-format exporters and review packets stay E13. TUI/viewers stay E14. Diagnostics/runbooks stay E16. Uninstall stays E18. zip/tar, cloud backup SDKs, a second database, OS secure erase and `ownerAction` as the deletion API stay out. |
| Success criteria | ✅ | 20 uniquely named `SC-e15sYY-P{0\|1}-NN` scenarios appear in the test plan, story §17 Gherkin, and task-ledger `scenarios:` lists. |
| Runnable work | ✅ | 20 tasks have non-empty shell `verify:` commands, all begin with a Node.js 24 major-version guard, and all remain `status: failing`. |
| Requirement deltas | ✅ | Net-new contracts are `ADDED`. Ready-project schema initialization is `MODIFIED` with before/after that matches current writable ready ensure of E04/E06/E05/E07/E08 plus `createSchema`/`migrateSchema` E03–E08. Artifact `failAt`/open/recover is `MODIFIED` with before matching the four shipped `failAt` values, unlocked multi-process open, and `recoverProject` temporary-file cleanup. Marker version stays 1. |
| Domain language | ✅ | Project snapshot, Evidence tombstone, Revocation and Review packet stay distinct from conversation backup, retained source copies, recall of disclosed bytes, and E13 review packets. |
| Research integrity | ✅ | Plan forbids claiming provider recall, resurrecting withdrawn grants, treating a drill as live replacement, or minting human commitments from export/restore. |
| Human authority | ✅ | Portability APIs must not call `recordOwnerDecision`. Workers including `allowedOperations: ["*"]` cannot export, restore, backup or delete. Owner identity must match `project.ownerId` inside `protectCanonicalWrite`. |

## Architecture and Impact

| Check | Status | Evidence |
|---|---|---|
| Zoom-out mandate | ✅ | `specs/IMPACT_LATEST.md` names purpose, current callers/dependents and preserved contracts for schema, project-store, project-types, recovery, artifact-store, index, disclosure, policy-store, capability-broker, commitment/readiness stores, lifecycle-gate, work-runtime, claim/evidence stores and frozen `src/workspace/**`. |
| Placement | ✅ | New code targets `src/portability/` plus `src/project/project-lock.ts`. Behavior-owned tests target `tests/portability/` plus `tests/integration/portability-authority.test.ts` and `tests/support/portability-fixtures.ts`. Story IDs remain traceability metadata and `node --test` name patterns, not filenames. `src/portability/`, `src/project/project-lock.ts`, `tests/portability/` and the authority test do not exist yet. |
| Minimal abstraction | ✅ | Types + store files split by caller set (export, backup, restore, deletion, lock). No archive package, cloud backup SDK, lock manager or second TUI. |
| Schema compatibility | ✅ | Additive `createE15Schema` only. Static inspection: `PROJECT_SCHEMA_VERSION` is `1`. Writable ready `openProject` currently ensures E04/E06/E05/E07/E08; `createSchema`/`migrateSchema` currently ensure E03–E08. Plan keeps marker version 1 and preserves `migrateSchema(root)` v0→v1. `schema.ts` is 845 lines; IMPACT forbids splitting it in E15. |
| Disclosure reuse | ✅ | E15 reuses existing `export` kind. Plan does not add a disclosure enum value. Shipped `requestDisclosure` already denies empty `sourceVersions` and local-only material to non-`local` destinations. |
| Lock and recovery | ✅ | Pid-reentrant `.ganesh/write.lock` via `node:fs`, not `proper-lockfile`. Same-process `recoverProject(root)` while a fixture handle is open remains allowed. `recoverProject` must not complete pending lifecycle operations. |
| Restore modes | ✅ | Materialize-into-empty, restore-drill and restore-replace are distinct. Withdrawn/expired cannot return to `active` on replace. Packet bytes for live tombstones stay unavailable. |
| Commitment isolation | ✅ | Export/restore may copy permitted commitment rows. Portability APIs never call `recordOwnerDecision` or insert `scholarly_findings`. `ownerAction` stays the E03 stub and is not the deletion API. |
| Downstream contracts | ✅ | E13 writing/review packets, E16 diagnostics and E18 uninstall stay later. E14 TUI remains frozen. |

## Test Architecture

| Check | Status | Evidence |
|---|---|---|
| Risk scaling | ✅ | 15 P0 and 5 P1 scenarios cover packet integrity, authority, omission, crash/AC-17, ENOSPC, foreign pid, corruption/pending ops, materialize mismatch, AC-08 drills, `migrateWithBackup` vs bare `migrateSchema`, branch isolation, tombstone unlink, blocked use, not-recalled disclosures, monotonic replace, post-replace deny and tombstone survival. |
| Scenario identity | ✅ | All 20 IDs are unique and present in test plan, Gherkin, and ledgers: s01, s03, s02, s04, s05 each P0-01..03 + P1-04. |
| Happy and failure paths | ✅ | Every unfinished story has both: hashed packet versus capability deny/omission; complete recover versus ENOSPC/foreign lock/corrupt pending; materialize versus hash-mismatch and non-mutating drill; unlink/tombstone versus blocked dispatch and worker deny; replace-keep-withdrawn versus disclosure deny and resurrected grant. |
| Isolation | ✅ | Temporary SQLite projects; `failAt` crash/disk-full injection; foreign pid via child/`write.lock`; no `InteractiveMode.run()`, viewers, `~/.pi`, network, zip packages or filling the host volume. Cleanup in `finally`. |
| Regression safety | ✅ | Final tasks require typecheck, lint, build and the complete inherited suite under a Node.js 24 guard. `npm test` already discovers `dist/tests/*/*.test.js`, which covers `tests/portability/` and `tests/integration/`. |
| AC coverage | ✅ | AC-20 is named by e15s01/e15s02/e15s04/e15s05 packet, omission, backup/restore, deletion and monotonic-grant scenarios. AC-17 is named by SC-e15s03-P0-01. AC-08 is named by SC-e15s02-P0-02, SC-e15s02-P1-04 and SC-e15s05-P0-03. Writing-format AC-20 sentences remain E13. |
| Evidence limits | ✅ | Tests prove deterministic software behavior with synthetic fixtures, not backup-media durability, provider-side deletion, legal redistribution rights or complete-release readiness. |

## Dependency Slopcheck and Approval Gates

| Package | Tag | Decision basis |
|---|---|---|
| Existing Node.js 24, `node:sqlite`, `node:fs`, `node:crypto`, `node:test`, E01–E08/E14 lockfile | `[OK]` | Reuse current production stack. No new production or test package is proposed. |
| zip / tar / archiver | `[OK]` rejected | Project packet is a directory with `ganesh-project-packet.json`. `package.json` has no `zip`, `tar` or `archiver` package. Existing `yauzl` remains E06 DOCX/XLSX intake and must not become the packet format. |
| `proper-lockfile` / lockfile package | `[OK]` rejected | Pid-reentrant exclusive create of `.ganesh/write.lock` with dead-pid steal. |

Owner approval of this revision would not need a new `[SUS]` dependency gate unless a package is added. Any new package or archive-format substitution invalidates this audit and requires re-audit.

## Conventions Completeness

| Check | Status | Note |
|---|---|---|
| Agent/project guidance | ✅ | `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` exist and require responsibility ownership, FIRST tests and no direct main commits. |
| Planning layout | ✅ | E15 artifacts are under `specs/epics/e15-recovery-portability/`; shared test/impact/audit artifacts use documented `specs/` ownership. |
| File placement | ✅ | Responsibility folders `src/portability/` and `tests/portability/`; lock lives in `src/project/project-lock.ts`; authority tests in `tests/integration/portability-authority.test.ts`. No epic IDs in filenames. `src/workspace/**` frozen. `schema.ts` stays unsplit. |
| Git mode | ✅ | `solo-git`; no current branch/commit/build authorization. Conventional Commits required later. Implementation must use a feature branch after approval of this READY revision. |
| Runtime | ✅ | Node.js 24 LTS and npm 11; every task command fails before work if foreground `node` is not major 24. |
| CI | ✅ | No CI configured; applicable local checks are required before integration. |

## Pre-flight Answers

| Item | Value |
|---|---|
| Language/runtime | TypeScript on Node.js 24 LTS |
| Framework/runtime reuse | Pi SDK/TUI; local SQLite plus artifact files |
| Existing codebase | Yes; E01–E08 and E14 released locally |
| Test | `npm test` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Preflight | `npm run preflight` |
| Full local gate | `npm test && npm run lint && npm run typecheck && npm run build` |
| CI platform | Not configured |
| Git workflow | Solo/local; feature branch required before implementation |

## Coverage of R15

| R15 / epic acceptance outcome | Owning stories | Named scenarios |
|---|---|---|
| Versioned project export/restore checks integrity and current permissions; migrations, backups and restore drills preserve permitted history and evidence resolution | e15s01, e15s02 | SC-e15s01-P0-01, SC-e15s01-P0-03, SC-e15s01-P1-04, SC-e15s02-P0-01, SC-e15s02-P0-02, SC-e15s02-P0-03, SC-e15s02-P1-04 |
| Crash injection, interrupted writes, disk-full, corruption and concurrent launches produce no partial approvals or silent canonical changes; uncertain external operations are reconciled before retry | e15s03 | SC-e15s03-P0-01, SC-e15s03-P0-02, SC-e15s03-P0-03, SC-e15s03-P1-04 |
| Deletion propagates through derived content, caches and backup policy while retaining only permitted audit stubs; stale restores cannot silently reinstate withdrawn grants and external disclosures are not promised recall | e15s04, e15s05 | SC-e15s04-P0-01, SC-e15s04-P0-02, SC-e15s04-P0-03, SC-e15s04-P1-04, SC-e15s05-P0-01, SC-e15s05-P0-02, SC-e15s05-P0-03, SC-e15s05-P1-04 |
| AC-08, AC-17, AC-20 | e15s01–e15s05 | AC-08: SC-e15s02-P0-02, SC-e15s02-P1-04, SC-e15s05-P0-03; AC-17: SC-e15s03-P0-01; AC-20: SC-e15s01-P0-01, SC-e15s01-P0-03, SC-e15s02-P0-01, SC-e15s04-P0-01, SC-e15s04-P0-03, SC-e15s05-P0-01 |

Epic `acceptance_outcomes` match R15 `success_criteria`. Release-plan e15 depends on e02, e03 and e05, sequence 10, 34 BCP.

Static inspection of shipped contracts **matches** this revision’s reuse claims:

- `DisclosureOperationKind` / `DISCLOSURE_OPERATIONS` currently list twelve kinds including `export` and `retrieval`. E15 must reuse `export` and must not add a thirteenth value.
- `requestDisclosure` denies empty `sourceVersions` (`denied: no source versions specified for disclosure`) and denies local-only material when destination is not `local` (`denied: source material is restricted to local-only destinations`). Unknown operations also deny.
- `PROJECT_SCHEMA_VERSION` is 1. Writable ready open ensures E04/E06/E05/E07/E08. `createSchema` and `migrateSchema` ensure E03–E08. No `createE15Schema` exists yet. `schema.ts` is 845 lines.
- `ArtifactVersionInput.failAt` currently accepts `before-finalize`, `after-finalize-before-register`, `after-commit` and `after-register` only. `disk-full` is absent.
- `openProject` currently has no write lock. `recoverProject` opens a second handle, removes temporary files, retains last complete database state, inspects artifact statuses, and does not touch `lifecycle_operations`.
- `inspectArtifactVersion` already reports `available` / `missing` / `corrupt` / `unavailable` from hash/file presence. `registerArtifactVersion` still finalizes bytes before the SQL commit.
- `PermissionStatus` is `active | withdrawn | expired`. `withdrawDataUse` is monotonic for `withdrawn`.
- `protectCanonicalWrite` requires `OwnerCapability`. `WorkerCapability.canPerform` returns false for `OWNER_OPERATIONS` even when `allowedOperations` includes `*`. `ownerAction` is still a completed stub and is not a deletion implementation.
- `listCommitments` exists as a reader. `assessReadiness` already yields `blocked` when content is unavailable. `work-runtime.ts` throws `unavailable` when assigned input content is unavailable.
- `src/index.ts` already exports E02–E08/E14 APIs; no portability-domain exports exist yet.
- `src/workspace/**` exists as the E14 presenter and is unmodified by this plan.
- `src/portability/` and `src/project/project-lock.ts` do not exist yet.
- `package.json` has no `zip`, `tar`, `archiver` or `proper-lockfile` dependency. Existing `yauzl` is E06 intake.

## Static Validation Evidence

- `bash scripts/lib/plan-consistency-check.sh specs/epics/e15-recovery-portability/` → `CRITICAL=0 HIGH=0 MED=0`, PASS.
- `ruby specs/verifications/check-blueprint.rb` → PASS: 18 epics, 18 outcomes, AC-01–20, dependency/WSJF order, BCP totals, YAML, capsule/task status.
- Custom E15 ledger check → 34 BCP (8+7+7+6+6), 20 failing Node-24-guarded tasks, 20 unique scenario IDs in test plan, Gherkin and ledgers.
- Plan-revision hash of story specs + task ledgers + test plan + IMPACT (excluding `epic.yaml`) → `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2` (matched claimed digest).

These are planning-structure checks. They do not flip any task to passing, do not replace implementation verification, and do not constitute owner approval.

## Open Plan Defects

None blocking this revision.

Non-blocking observations for implementers after owner approval:

- `ownerAction({ action: "delete-project" })` already returns `completed` without unlinking bytes. Keep that stub unchanged. Deletion is `deleteArtifactContent` under `protectCanonicalWrite`.
- `recoverProject` currently opens its own handle and closes it in `finally`. After e15s03 the lock must admit that same-process reentry while a fixture handle remains open.
- `schema.ts` already exceeds the 300-line guideline as a documented exception. Add `createE15Schema` in place. Do not split the file in E15.
- Existing `yauzl` is for E06 archive intake. Directory packets and backups stay unarchived trees. Do not wrap them with `yauzl` or add zip/tar packages.
- AC-20 writing-format and supervisor-review-packet sentences remain E13. This epic covers project packets, omission notices, deletion/tombstones and restore honesty.
- Materialize into a new empty root copies packet policy as history for that new project id. Only restore-replace applies live withdrawals. Do not collapse those modes.
- IMPACT’s “Plan-work is complete on this digest” is accurate for this revision; it is not owner approval or `/bp-build` authorization.

## Owner Decision

**APPROVED** for exact E15 plan revision `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2` at `2026-09-12T13:38:52Z` by explicit owner message.

Approval covers the twelve hashed story/task/test-plan/IMPACT files plus the capsule `epic.yaml` stamps for this revision. It is not implementation start, task passing, production readiness, or scholarly validation. Material changes to scope, acceptance criteria, dependencies, disclosure bind, lock/restore/deletion strategy, or packages require a new digest and a new approval.

## Verdict

**READY and owner-approved** for exact E15 plan revision `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2`.

The capsule has bounded vertical stories, failing Node.js 24 task checks, mapped scenarios, no new packages, additive schema intent, reused `export` disclosure, and reuse claims that match shipped E02/E03/E04/E05/E08/E14 contracts.

`/bp-build` starts implementation from `e15s01` when requested. This audit must not start build skills.
