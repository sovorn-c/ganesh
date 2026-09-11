# Plan Audit — Ganesh E06 Local Import and Source Inspection

**Date:** 2026-09-10
**Mode:** Implementation plan
**Roadmap revision:** `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`
**E06 plan revision:** `sha256:ac23b8069f2390638f6d26d2c662766590fbed5bf71022cdafcc9510558e9440`
**Audit verdict:** READY for owner review
**Owner decision:** APPROVED for the exact plan revision below

The owner approved this exact plan and its three `[SUS]` dependency gates on 2026-09-11T00:55:28Z. This does not claim implementation authorization, evidence that any E06 task passes, production readiness or scholarly validation; implementation start remains a separate request.

## Inputs Audited

- `specs/epics/e06-source-intake/epic.yaml`
- Four E06 countable story specifications and four failing task ledgers
- `specs/tech-architecture/e06-TEST_PLAN_LATEST.md`
- `specs/IMPACT_LATEST.md`
- Approved scope, architecture, glossary, roadmap and status artifacts
- Current E01-E04 source contracts and tests by static inspection
- Two independent Pi-fork reviews; the first identified three HIGH and five MED plan gaps, and the second returned READY after correction with four MED cleanup items that were then resolved

No production/test code, dependency, branch, commit or delivery-loop change was made. No build, test, lint, typecheck, preflight or task verification command was run during this planning audit.

## Principles Alignment

| Check | Status | Evidence |
|---|---|---|
| Vertical slices | ✅ | Four user-visible slices: text/Markdown intake; PDF/DOCX extraction; bibliography/tables; matching and permission-gated inspection. |
| Dependency order | ✅ | `e06s01 → e06s02 → e06s03 → e06s04`; later stories consume prior durable contracts. |
| Scope bounded | ✅ | Every story has explicit non-goals; OCR execution, provider retrieval, evidence verification, viewer launch, export/deletion and release readiness remain with later epics. |
| Success criteria | ✅ | 19 uniquely named P0/P1 scenarios appear in the test plan and Gherkin story criteria and map explicitly into task ledgers. |
| Runnable work | ✅ | 16 tasks have non-empty shell verification commands, all begin with a Node.js 24 guard, and all remain `status: failing`. |
| Requirement deltas | ✅ | Net-new contracts are `ADDED`; schema/path and disclosure vocabulary changes are `MODIFIED` with explicit before/after in story and manifest. |
| Domain language | ✅ | Source identity, acquired source version, extraction, locator, diagnostic, metadata-only access, match proposal, inspection and handoff remain distinct. |
| Research integrity | ✅ | Parser success, identity resolution, access and scholarly verification are never conflated; metadata-only/image-only inputs cannot fabricate quotations or page support. |
| Human authority | ✅ | No source, parser or agent output can classify, grant, accept a relationship or create human commitment. |

## Architecture and Impact

| Check | Status | Evidence |
|---|---|---|
| Zoom-out mandate | ✅ | `specs/IMPACT_LATEST.md` names purpose, current callers/dependents and preserved contracts for schema, project, capability, artifact, policy, disclosure and public-index modules. |
| Placement | ✅ | New code targets `src/sources/`; behavior-owned tests target `tests/sources/` and `tests/integration/`; story IDs remain traceability metadata only. |
| Minimal abstraction | ✅ | Direct format switches and focused persistence/worker/preflight/access functions; no plugin registry, factory or one-implementation interface. |
| Schema compatibility | ✅ | Plan deliberately keeps schema marker v1 for additive feature tables, adds idempotent `createE06Schema` to create/migrate/writable-ready-open paths, never mutates read-only/future projects, and specifies typed missing-feature behavior. |
| Registration recovery | ✅ | Durable command/payload operation plus deterministic artifact ID; artifact commits first; source+locator completion is one transaction; identical retry resumes; conflicts reject; pending/orphan state never claims completion. |
| Capability paths | ✅ | Matching project/operation, segment-aware lexical containment, realpath containment, no-symlink regular-file reads, descriptor recheck and denial-without-path close the existing sibling-prefix/symlink gap. |
| Policy operations | ✅ | Additive `inspection` operation is precise for local viewer descriptors; downstream requests use the actual existing operation. All handoffs still route through `requestDisclosure`. |
| Downstream contracts | ✅ | Exact source/artifact versions and locator algorithms support E07/E08/E11/E14/E15 without implementing those epics. |

## Test Architecture

| Check | Status | Evidence |
|---|---|---|
| Risk scaling | ✅ | 18 P0 and one P1 scenario cover persistence, authority, hostile parsers, locators, matching and disclosure. |
| Stable locators | ✅ | Exact artifact and algorithm/parser versions; UTF-8 byte spans; newline/duplicate-heading rules; PDF page/item; DOCX body/table coordinates; bibliography/CSV/XLSX coordinates. |
| Hostile inputs | ✅ | Bytes-only adapters, ZIP preflight, DTD/entity rejection, no eval/render/fetch/process, active-content diagnostics, finite archive/record/cell/output/time/memory ceilings and worker termination. |
| Independent fixtures | ✅ | Tiny synthetic fixtures with independent expected hashes/text/coordinates; no production parser generates its own oracle; low injected ceilings replace huge fixtures/sleeps. |
| Isolation | ✅ | Temporary SQLite projects, no global Pi state/network/real research data, cleanup in `finally`. |
| Regression safety | ✅ | Final tasks require the complete E01-E04 suite plus typecheck/lint/build under a Node.js 24 guard. |
| Evidence limits | ✅ | Tests prove deterministic software behavior for synthetic fixtures only, not universal parser fidelity, legal rights, scholarship or complete-release readiness. |

## Dependency Slopcheck and Approval Gates

| Package | Tag | Decision basis |
|---|---|---|
| `pdfjs-dist@6.3.289` | `[OK]` | Apache-2.0; official PDF.js; bytes only; eval/resources disabled. |
| `mammoth@1.12.2` | `[SUS]` | BSD-2-Clause; upstream no-sanitization warning. HTML stays inert/in-memory, parse5 consumes structure, and image/external access is disabled. |
| `parse5@8.0.1` | `[OK]` | MIT; inert parsing of generated HTML only. |
| `yauzl@3.4.0` / `@types/yauzl@3.4.0` | `[OK]` | MIT; lazy bounded ZIP preflight. |
| `biblatex-csl-converter@3.6.0` | `[SUS]` | LGPL-3.0; parser fit is strong, but distribution notice/source-link obligations require owner acceptance. |
| `csv-parse@7.0.2` | `[OK]` | MIT; small typed streaming parser with finite options. |
| `read-excel-file@9.3.10` | `[SUS]` | MIT; values require independent OOXML preflight/scanning for formulas/links/macros. |
| `saxes@6.0.0` | `[OK]` | ISC; bounded known-entry OOXML scan with DTD/entities rejected. |

Rejected: vulnerable `xlsx@0.18.5`, larger/moderate-advisory `exceljs@4.4.0`, the unnecessary Citation.js umbrella and custom PDF/DOCX/XLSX parsers.

The owner must explicitly accept all three `[SUS]` choices as part of approving this exact E06 plan revision. Implementation tasks then require `--ignore-scripts`, exact top-level pins, source/export/license/notice review, current `npm audit --omit=dev`, offline adapter tests, and `specs/verifications/e06-parser-dependencies.md`. Any substitution or material control change invalidates this approval candidate and requires re-audit.

## Conventions Completeness

| Check | Status | Note |
|---|---|---|
| Agent/project guidance | ✅ | `AGENTS.md`, `CLAUDE.md` and `CONVENTIONS.md` exist and require responsibility ownership, FIRST tests and no direct main commits. |
| Planning layout | ✅ | E06 artifacts are under the active epic capsule; shared test/impact/audit artifacts use documented `specs/` ownership. |
| Git mode | ✅ | Solo/local integration; no current branch/commit/build authorization. Conventional Commits required later. |
| Runtime | ✅ | Node.js 24 LTS and npm 11; every task command fails before work if foreground `node` is not major 24. |
| CI | ✅ | No CI configured; applicable local checks are required before integration. |

## Pre-flight Answers

| Item | Value |
|---|---|
| Language/runtime | TypeScript on Node.js 24 LTS |
| Framework/runtime reuse | Pi SDK/TUI; local SQLite plus artifact files |
| Existing codebase | Yes; E01-E04 released locally |
| Test | `npm test` |
| Build | `npm run build` |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Preflight | `npm run preflight` |
| Full local gate | `npm test && npm run lint && npm run typecheck && npm run build` |
| CI platform | Not configured |
| Git workflow | Solo/local; feature branch required before implementation |

## Static Validation Evidence

- `bash scripts/lib/plan-consistency-check.sh specs/epics/e06-source-intake/` → `CRITICAL=0 HIGH=0 MED=0`, PASS.
- Ruby YAML parse → 77 `specs/**/*.yaml` files parsed.
- `ruby specs/verifications/check-blueprint.rb` → PASS: 18 epics, 18 outcomes, AC-01–20, dependency/WSJF order, BCP totals, YAML, capsule/task status.
- Custom E06 ledger check → PASS: 21 BCP, 16 failing Node-24-guarded tasks, 19 task-mapped scenarios.
- Scenario/story check → PASS: 19 unique test scenarios referenced by story specifications.
- `git diff --check` → PASS.

These are planning-structure checks. They do not flip any task to passing and do not replace implementation verification.

## Open Plan Defects

None.

## Owner Decision

**Approved:** exact E06 plan revision `sha256:ac23b8069f2390638f6d26d2c662766590fbed5bf71022cdafcc9510558e9440`, including the three `[SUS]` dependency controls above.

## Verdict

**APPROVED for planned implementation.** The plan has bounded vertical stories, explicit contracts/non-goals, corrected shared-module decisions, risk-scaled test ownership, runnable Node.js 24 task checks and no unresolved CRITICAL/HIGH/MED plan defect. E06 remains unimplemented and not production-ready.

Implementation was not started because approval of the plan was not an implementation-start request. When requested, the delivery workflow must create/use a feature branch and execute e06s01 through e06s04 in order with the task ledgers as the source of truth.
