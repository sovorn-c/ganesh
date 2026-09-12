# Plan Audit — Ganesh E07 Located Evidence and Accountable Claims

**Date:** 2026-09-12
**Mode:** Implementation plan
**Roadmap revision:** `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`
**E07 plan revision:** `sha256:38482851582c8965e2ad6844ae8f0450e4c5c82e24f9045e6287995bd7d2135a`
**Audit verdict:** READY and owner-approved
**Owner decision:** APPROVED for the exact plan revision below

This is an implementation-plan build gate for the exact E07 revision above. Earlier E05/E06/E14 or scope-only READY verdicts do not satisfy this gate. The previous E07 implementation-plan digest `sha256:742e6d7d56edab63915d67271a4b03e2b12cb5fc226a452f73f5621d53c423a1` is dead and is not this gate. A READY verdict is not by itself owner approval, implementation start, evidence that any E07 task passes, production readiness, or scholarly validation. Owner approval of this exact revision is recorded in Owner Decision below; `/bp-build` remains a separate request.

This audit ends at the planning approval checkpoint. It must not recommend `survey-context`, and it must not start build skills.

## Inputs Audited

- `specs/epics/e07-evidence-claims/epic.yaml`
- Four E07 countable story specifications and four failing task ledgers
- `specs/tech-architecture/e07-TEST_PLAN_LATEST.md`
- `specs/IMPACT_LATEST.md`
- `specs/product/SCOPE_LATEST.yaml` R07; `specs/release-plan.yaml` e07 entry (`depends_on` e05, e06; both done)
- `specs/state.yaml` and `specs/execution-status.yaml`
- `CONVENTIONS.md`; `specs/tech-architecture/tech-stack.md` invariants 2 and 7 and evidence/claim relationships; `specs/UBIQUITOUS_LANGUAGE_LATEST.md` (Evidence item, Claim, Counterevidence, Source locator); `specs/docs/05-decisions-and-acceptance.md` AC-05 and AC-11
- Current `src/sources/source-access.ts` `inspectSource`, `src/persistence/schema.ts` `createE0xSchema` / `PROJECT_SCHEMA_VERSION`, `src/project/project-store.ts` writable ready ensure path, `src/branches/dependency-store.ts` `recordSharedSourceCorrection`, `src/decisions/override-store.ts` `scholarly_findings`, `src/decisions/commitment-store.ts`, `src/work/work-types.ts` `SpecialistRole` `evidence`, `src/workspace/evidence.ts`, `src/index.ts` — static inspection only

No production/test code, dependency, branch, commit or delivery-loop change was made. No build, test, lint, typecheck, preflight or task verification command was run during this planning audit.

Plan-revision digest was recomputed as `shasum -a 256` over the concatenated `shasum -a 256` lines of the ten story/task/test-plan/IMPACT files (excluding `epic.yaml` stamps) and **matches** `38482851582c8965e2ad6844ae8f0450e4c5c82e24f9045e6287995bd7d2135a`.

## Principles Alignment

| Check | Status | Evidence |
|---|---|---|
| Vertical slices | ✅ | Four user-visible slices: located items and statement kinds; claims and citation verification; matrix and source-notice reassessment; method-appropriate appraisal and qualified synthesis. |
| Dependency order | ✅ | `e07s01` first; `e07s02` after `e07s01`; `e07s03` after `e07s01`+`e07s02`; `e07s04` after `e07s01`+`e07s02`+`e07s03`. Release-plan e07 depends on done e05 and e06. |
| Scope bounded | ✅ | Every story has explicit non-goals. E08 discovery, E09 method design, E14 TUI/viewers, E04 commitments/overrides, OCR, provider retrieval, export/deletion/packaging stay out. |
| Success criteria | ✅ | 16 uniquely named `SC-e07sYY-P{0\|1}-NN` scenarios appear in the test plan, story §17 Gherkin, and task-ledger `scenarios:` lists. |
| Runnable work | ✅ | 16 tasks have non-empty shell `verify:` commands, all begin with a Node.js 24 major-version guard, and all remain `status: failing`. |
| Requirement deltas | ✅ | Net-new contracts are `ADDED`. Ready-project schema initialization is `MODIFIED` with before/after that matches current `createE04Schema` / `createE06Schema` / `createE05Schema` on writable ready open, `createSchema`, and `migrateSchema`. Marker version stays 1. |
| Domain language | ✅ | Evidence item, Claim, Counterevidence, and Source locator stay distinct from paper summaries, bibliographic identity, commitments, and scholarly findings. Location refs are a tagged union over `source_locators.id` and `source_segments.id`. |
| Research integrity | ✅ | Plan forbids invented quotations, identity-as-support, and label-as-validity. Quotation oracle is E07 `readLocatedExcerpt`, bound to the two shipped `inspectSource` content paths. It never passes `source_locators.id` as `inspectSource.locatorId` and does not modify `inspectSource`. |
| Human authority | ✅ | Claim, appraisal and synthesis APIs must not call `recordOwnerDecision` or insert `scholarly_findings` by default. Chat, specialist “verified” payloads and schema labels are not commitments or scholarly validity. |

## Architecture and Impact

| Check | Status | Evidence |
|---|---|---|
| Zoom-out mandate | ✅ | `specs/IMPACT_LATEST.md` names purpose, current callers/dependents and preserved contracts for schema, project-store, index, source-access, source-store, dependency-store, commitment/decision stores, override-store, work-store, workspace/evidence and capability-broker. |
| Placement | ✅ | New code targets `src/evidence/`; behavior-owned tests target `tests/evidence/` plus `tests/integration/evidence-authority.test.ts` and `tests/support/evidence-fixtures.ts`. Story IDs remain traceability metadata and `node --test` name patterns, not filenames. `src/evidence/` and `tests/evidence/` do not exist yet. |
| Minimal abstraction | ✅ | Types + store + optional same-folder matrix helper if the 300-line guideline is hit. No citation graph DB, NLP package, workflow engine or second TUI. |
| Schema compatibility | ✅ | Additive `createE07Schema` only. Static inspection: `PROJECT_SCHEMA_VERSION` is `1` in `src/project/project-types.ts`. Writable ready `openProject` currently ensures E04/E06/E05; `createSchema`/`migrateSchema` currently ensure E03–E06. Plan keeps marker version 1. |
| Policy reuse | ✅ | E07 adds `readLocatedExcerpt` as an ADDED contract. Access/integrity gate is `inspectSource({ includeContent: false })`. Text/Markdown excerpts use `inspectSource({ includeContent: true })` with no `locatorId`, then UTF-8 `[startByte, endByte)` from `source_locators`. PDF/DOCX excerpts use `inspectSource({ locatorId: segment.id, includeContent: true })` where `segment.id` is `source_segments.id`. `inspectSource` and `src/workspace/evidence.ts` stay unmodified. |
| Commitment isolation | ✅ | Claims, appraisals and syntheses must leave `listCommitments` empty unless an E04 owner confirmation occurred. Default appraisal must not insert `scholarly_findings`. `recordSharedSourceCorrection` remains the snapshot-safe notice writer. |
| Downstream contracts | ✅ | E08/E09/E13/E17 may consume records later; E07 does not ship those epics. Bounded method kinds appraise acquired sources only. |

## Test Architecture

| Check | Status | Evidence |
|---|---|---|
| Risk scaling | ✅ | 12 P0 and 4 P1 scenarios cover reopen, inaccessible quotations, authority, identity-vs-support, AC-05, missing fields, matrix dissent, reassessment, AC-11 applicability and non-write of commitments/findings. |
| Scenario identity | ✅ | All 16 IDs are unique and present in test plan, Gherkin, and ledgers: s01–s04 each P0-01..03 + P1-04. |
| Happy and failure paths | ✅ | Every unfinished story has both: located reopen versus inaccessible quotation/capability deny; identity/missing-fields versus AC-05 unsupported; matrix retain versus history/unrelated isolation; thematic not-fail versus quantitative analysis-issue and non-commitment. |
| Isolation | ✅ | Temporary SQLite projects; synthetic E06 sources; no `InteractiveMode.run()`, viewers, `~/.pi`, network or live Pi sessions. Cleanup in `finally`. |
| Regression safety | ✅ | Final tasks require typecheck, lint, build and the complete inherited suite under a Node.js 24 guard. |
| AC coverage | ✅ | AC-05 is named by SC-e07s01-P0-02 and restated by SC-e07s02-P0-02. AC-11 software clauses are SC-e07s04-P0-01 and SC-e07s04-P0-02; expert reasoning stays E17. Located-excerpt paths now bind to shipped locator identities in SC-e07s01-P0-01, the test plan, IMPACT, and Gherkin. |
| Evidence limits | ✅ | Tests prove deterministic software behavior with fakes and synthetic fixtures, not scholarly support, legal reuse rights, expert appraisal quality or complete-release readiness. |

## Dependency Slopcheck and Approval Gates

| Package | Tag | Decision basis |
|---|---|---|
| Existing Node.js 24, `node:sqlite`, `node:test`, E01–E06/E14 lockfile | `[OK]` | Reuse current production stack. No new production or test package is proposed. |
| `citation-js` / citeproc / NLP / extra PDF parsers | `[OK]` rejected | Bibliographic identity stays E06 records; `readLocatedExcerpt` binds onto shipped `inspectSource` content paths. |

Owner approval of this revision would not need a new `[SUS]` dependency gate unless a package is added. Any new package or material adapter substitution invalidates this audit and requires re-audit.

## Conventions Completeness

| Check | Status | Note |
|---|---|---|
| Agent/project guidance | ✅ | `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` exist and require responsibility ownership, FIRST tests and no direct main commits. |
| Planning layout | ✅ | E07 artifacts are under `specs/epics/e07-evidence-claims/`; shared test/impact/audit artifacts use documented `specs/` ownership. |
| Git mode | ✅ | `solo-git`; no current branch/commit/build authorization. Conventional Commits required later. Implementation must use a feature branch after approval of this READY revision. |
| Runtime | ✅ | Node.js 24 LTS and npm 11; every task command fails before work if foreground `node` is not major 24. |
| CI | ✅ | No CI configured; applicable local checks are required before integration. |

## Pre-flight Answers

| Item | Value |
|---|---|
| Language/runtime | TypeScript on Node.js 24 LTS |
| Framework/runtime reuse | Pi SDK/TUI; local SQLite plus artifact files |
| Existing codebase | Yes; E01–E06 and E14 released locally |
| Test | `npm test` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Preflight | `npm run preflight` |
| Full local gate | `npm test && npm run lint && npm run typecheck && npm run build` |
| CI platform | Not configured |
| Git workflow | Solo/local; feature branch required before implementation |

## Coverage of R07

| R07 / epic acceptance outcome | Owning stories | Named scenarios |
|---|---|---|
| Structured reading, extraction and critical appraisal distinguish author claims, measured findings, inference and human interpretation with exact source locators | e07s01, e07s04 | SC-e07s01-P0-01, SC-e07s01-P1-04, SC-e07s04-P0-01, SC-e07s04-P0-02 |
| Claim and citation verification distinguishes bibliographic identity from substantive support and inaccessible full text; missing fields and quotations are never invented | e07s01, e07s02 | SC-e07s01-P0-02, SC-e07s02-P0-01, SC-e07s02-P0-02, SC-e07s02-P0-03 |
| Evidence matrices and synthesis retain disagreements, limitations, corrections and retractions; affected claims trigger reassessment | e07s03, e07s04 | SC-e07s03-P0-01, SC-e07s03-P0-02, SC-e07s03-P0-03, SC-e07s04-P0-03 |
| AC-05, AC-11 | e07s01, e07s02, e07s04 | SC-e07s01-P0-02, SC-e07s02-P0-02, SC-e07s04-P0-01, SC-e07s04-P0-02 |

Epic `acceptance_outcomes` match R07 `success_criteria`. Release-plan e07 depends on e05 and e06, sequence 8, 21 BCP.

Static inspection of shipped contracts **matches** this revision’s reuse claims for the quotation oracle:

- `inspectSource` exists and already gates content on `source:inspect`, `access === "full-text"`, `extractionStatus === "complete"` and artifact integrity. Metadata-only / abstract-only / unavailable access values exist on `ArtifactAccess`.
- `locatorId` is resolved against `LocatedSourceSegment.id` (`source_segments`) via `listSourceSegments` only. `inspectSource` does not read `source_locators`.
- Text/Markdown import writes `source_locators` (`locator-{version}-{line}`) and does not create segments. PDF/DOCX extraction writes `source_segments` (`segment-{derived}-{n}`) and does not insert `source_locators`; nested `segment.locator.id` values are `segment-locator-{derived}-{n}` and are not `source_locators` rows.
- Without `locatorId`, `inspectSource({ includeContent: true })` returns full UTF-8 text/Markdown file bytes decoded as a string; PDF/DOCX without `locatorId` returns no full-file content.
- This revision’s `readLocatedExcerpt` uses those two shipped paths and forbids passing `source_locators.id` as `inspectSource.locatorId`. That closes the prior HIGH locator-identity defect on this digest.
- `PROJECT_SCHEMA_VERSION` is 1. Writable ready open ensures E04/E06/E05. `listCommitments`, `recordScholarlyFinding` / `listScholarlyFindings`, `recordSharedSourceCorrection`, `SpecialistRole` `"evidence"`, and `src/workspace/evidence.ts` exist as claimed. `src/index.ts` already exports E02–E06/E14 APIs; no evidence-domain exports exist yet.

## Static Validation Evidence

- `bash scripts/lib/plan-consistency-check.sh specs/epics/e07-evidence-claims/` → `CRITICAL=0 HIGH=0 MED=0`, PASS.
- `ruby specs/verifications/check-blueprint.rb` → PASS: 18 epics, 18 outcomes, AC-01–20, dependency/WSJF order, BCP totals, YAML, capsule/task status.
- Custom E07 ledger check → 21 BCP, 16 failing Node-24-guarded tasks, 16 unique scenario IDs in test plan, Gherkin and ledgers.
- Plan-revision hash of story specs + task ledgers + test plan + IMPACT (excluding `epic.yaml`) → `sha256:38482851582c8965e2ad6844ae8f0450e4c5c82e24f9045e6287995bd7d2135a` (matched claimed digest).

These are planning-structure checks. They do not flip any task to passing, do not replace implementation verification, and do not constitute owner approval.

## Prior HIGH — locator-identity contract (closed on this revision)

The dead digest bound excerpts to `inspectSource(..., { locatorId: source_locators.id })`. Shipped `inspectSource` still matches `locatorId` only to `source_segments.id`. This revision introduces ADDED `readLocatedExcerpt` that:

- uses `inspectSource` as the access/extraction/integrity gate (`includeContent: false` first);
- text/Markdown: `inspectSource` **without** `locatorId`, then slice `source_locators` `startByte`/`endByte`;
- PDF/DOCX: `inspectSource` **with** `locatorId` = `source_segments.id`;
- never passes `source_locators.id` as `inspectSource.locatorId`;
- does not modify `inspectSource` or `src/workspace/evidence.ts`.

That bind is explicit in e07s01 assumptions/constraints/contracts/Gherkin/verification, IMPACT, and the 16-scenario test plan (SC-e07s01-P0-01). e07s02 derives `substantively-supported` from `readLocatedExcerpt` content, not from bibliographic identity. The prior HIGH is closed for this digest.

## Open Plan Defects

None blocking this revision.

Non-blocking observations for implementers after owner approval:

- `inspectSource` returns a decoded JavaScript string, while `source_locators.startByte`/`endByte` are UTF-8 byte offsets from intake. Slice via UTF-8 bytes of that content (re-encode then subarray), not JS string indices, when fixtures are non-ASCII.
- Worker operations `evidence:record`, `claim:record`, `evidence:appraise` and friends are new strings on the existing open `allowedOperations` list, not a closed enum. Fine if tests grant them explicitly.
- AC-11 “an expert checks the reasoning, not only the labels” remains E17; software tests cover applicability labels only.
- Ubiquitous-language “Source locator” remains the position term; E07’s tagged `source-locator` / `source-segment` union is an ID-space refinement, not a second evidence object.

## Owner Decision

**APPROVED** for exact E07 plan revision `sha256:38482851582c8965e2ad6844ae8f0450e4c5c82e24f9045e6287995bd7d2135a` at `2026-09-12T04:19:56Z` by explicit owner message. Dead digest `sha256:742e6d7d56edab63915d67271a4b03e2b12cb5fc226a452f73f5621d53c423a1` is not approved.

Approval covers the ten hashed story/task/test-plan/IMPACT files plus the capsule `epic.yaml` stamps for this revision. It is not implementation start, task passing, production readiness, or scholarly validation. Material changes to scope, acceptance criteria, dependencies, locator bind, or implementation/test strategy require a new digest and a new approval.

## Verdict

**READY and owner-approved** for exact E07 plan revision `sha256:38482851582c8965e2ad6844ae8f0450e4c5c82e24f9045e6287995bd7d2135a`.

The capsule has bounded vertical stories, failing Node.js 24 task checks, mapped scenarios, no new packages, additive schema intent, and a quotation-oracle bind that matches shipped `inspectSource` locator identity.

`/bp-build` starts implementation from `e07s01` when requested. This audit must not recommend `survey-context` and must not start build skills.
