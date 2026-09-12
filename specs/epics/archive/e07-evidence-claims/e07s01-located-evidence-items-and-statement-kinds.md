# e07s01 — Located Evidence Items and Statement Kinds

## 1. Identity

- **Story ID:** e07s01
- **Epic:** e07 — Located evidence and accountable claims
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want to record a located evidence item from an exact source version and locator, classified as an author claim, measured finding, inference or human interpretation, so that later claims cite inspectable observations rather than paper summaries.

## 3. Context

E06 already stores immutable source versions, locators, access level and extraction diagnostics. E14 already presents those source inspections and launches native viewers. This first vertical slice adds evidence-item semantics without duplicating source storage, inventing quotations, or opening a second TUI authority path.

## 4. Problem

A source version or bibliographic identity is not an evidence item. Recording a fluent summary without a location ref, copying an excerpt that `readLocatedExcerpt` did not return, treating `source_locators.id` as `inspectSource.locatorId`, or collapsing author claims with agent inference would make later verification and AC-05 impossible.

## 5. Goal

Record capability-scoped evidence items against one exact source version and one tagged location ref, persist statement kind and origin, store an excerpt only when it is the exact located text returned by `readLocatedExcerpt`, and reconstruct the item after reopen.

## 6. Non-Goals

- Claim records, citation verification and bibliographic-versus-substantive support; e07s02 owns these.
- Evidence matrices, correction/retraction reassessment; e07s03 owns these.
- Method-appropriate appraisal and synthesis; e07s04 owns these.
- Source import, locator algorithms, OCR, provider retrieval, native viewers or TUI changes.
- Human commitments, scholarly-finding rows or reasoned overrides; E04 owns those.
- Treating specialist-candidate registration as verification or scholarly validity.

## 7. Stakeholders

- Researchers extracting located observations from acquired sources.
- E05 Evidence-role consumers that later ingest structured candidates.
- E07 later stories that link claims to these items.
- E03 policy and capability boundaries that must remain deny-by-default.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E02 artifact versions, reopen and additive schema behavior.
- E03 owner/worker capabilities and local-only disclosure defaults.
- E06 `inspectSource`, `listSourceLocators`, `listSourceSegments`, access and extraction status.
- E05 `work_candidates` as an optional origin, not a required writer.
- `specs/IMPACT_LATEST.md` shared-module blast-radius assessment.
- `specs/tech-architecture/e07-TEST_PLAN_LATEST.md` scenarios SC-e07s01-P0-01 through SC-e07s01-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- Evidence-item identity is a new durable ID. It references an existing source version ID and a tagged location ref; it does not create locators or segments.
- Location refs are a discriminated union: `{ kind: "source-locator", id }` must equal `listSourceLocators` `SourceLocator.id` (text/Markdown intake, e.g. `locator-{version}-{line}`); `{ kind: "source-segment", id }` must equal `listSourceSegments` `LocatedSourceSegment.id` (PDF/DOCX extraction, e.g. `segment-{derived}-{n}`). Nested `segment.locator.id` values such as `segment-locator-{derived}-{n}` are not inspectSource keys and are not source_locators rows.
- Statement kinds are exactly `author-claim`, `measured-finding`, `inference` and `human-interpretation`.
- Origin is `owner-recorded` or `specialist-proposed`. Specialist ingest reads an accepted E05 candidate payload and still cannot become substantively supported in e07s02.
- Valid excerpts come only from E07 `readLocatedExcerpt`, which uses shipped `inspectSource` content paths and never passes a `source_locators.id` as `inspectSource.locatorId`. Byte spans are zero-based, start-inclusive and end-exclusive UTF-8 offsets.
- The owner capability must match the project owner. A worker capability must match the project ID and allow `evidence:record` plus current `source:inspect`.
- `PROJECT_SCHEMA_VERSION` stays 1. E07 tables are additive feature tables.

## 10. Constraints

- `recordEvidenceItem` MUST call `readLocatedExcerpt` before storing an excerpt. Denied inspection, missing location refs, metadata-only, abstract-only, unavailable access, incomplete/failed/unsupported extraction, or failed integrity MUST reject an excerpt-bearing item and MUST NOT invent quotation text or page numbers.
- `readLocatedExcerpt` MUST first call `inspectSource({ sourceVersionId, includeContent: false })` as the access/extraction/integrity gate. It MUST then resolve text as follows and MUST NOT change `inspectSource`:
  - `source-segment`: call `inspectSource({ locatorId: segment.id, includeContent: true })` and take that returned content (or a UTF-8 subspan of it). This is the only path that sets `inspectSource.locatorId`.
  - `source-locator` on text or Markdown: call `inspectSource({ includeContent: true })` with no `locatorId` (shipped full-file path) and slice `[startByte, endByte)` from that UTF-8 original. Passing `source_locators.id` as `locatorId` is forbidden because shipped inspection looks up `source_segments.id` only and would return `requested locator is unavailable`.
  - Any other combination (locator id on PDF/DOCX, segment id on text/Markdown, bibliographic metadata locators, missing rows) MUST reject the excerpt.
- An item without excerpt may still record a statement kind and location ref when the source and location exist, but its limitations MUST include the access/extraction/integrity codes from inspection.
- Keep `PROJECT_SCHEMA_VERSION` at 1. `createE07Schema` is idempotent and runs from new-project `createSchema`, explicit `migrateSchema`, and writable ready-project `openProject`. Explicit read-only, migration-required and unknown-future opens never mutate schema. A read-only v1 project lacking E07 tables reports `evidence-schema-unavailable` for E07 reads.
- Persist a unique evidence operation before item completion using caller `commandId` and payload hash. Same-command retries resume; a changed payload is rejected. Pending state remains visible and never claims a complete item.
- Diagnostics and errors contain bounded codes and safe identifiers, never source excerpts, credentials or unrestricted paths, except the stored excerpt field which exists only after located-text verification.
- `src/workspace/evidence.ts` MUST NOT change. Source inspection presentation stays E14.

## 11. Domain Model

- **Evidence item:** a located observation tied to one exact source version and one tagged location ref, with a statement kind and origin.
- **Location ref:** `source-locator` (E06 `source_locators.id`) or `source-segment` (E06 `source_segments.id`). These ID spaces are not interchangeable.
- **Statement kind:** `author-claim` (what the source asserts), `measured-finding` (reported result/measurement), `inference` (agent or derived inference), `human-interpretation` (owner-attributed interpretation).
- **Located excerpt:** optional exact text copied from `readLocatedExcerpt`; never generated text.
- **Evidence operation:** idempotency/recovery record containing command ID, payload hash and `pending | complete | failed` status.

## 12. Requirements

### MODIFIED: Ready-project feature schema initialization

**Before:** writable ready-project open idempotently ensured E04, E06 and E05 additive tables while schema marker version 1 remained unchanged.

**After:** new-project creation, explicit migration and writable ready-project open also idempotently ensure additive E07 evidence tables without changing schema marker version 1. Explicit read-only, migration-required and unknown-future opens never mutate schema, and missing E07 tables return a typed unavailable result.

### ADDED: Capability-scoped evidence recording

`recordEvidenceItem` MUST verify owner/project identity or worker project/operation scope, and MUST require current source inspection authorization for the named source version.

### ADDED: Located evidence item

A successful record MUST persist statement kind, origin, exact source version ID, tagged location kind and location ID, a snapshot of the resolved locator coordinates, limitations from inspection, and optional excerpt only when that excerpt equals `readLocatedExcerpt` text. Source bytes remain in E06/E02 storage.

### ADDED: Statement kinds remain distinct

The four statement kinds MUST be stored as recorded. Recording MUST NOT coerce an author claim into a measured finding, or an inference into a human interpretation.

### ADDED: Specialist origin is proposed

Ingesting an E05 Evidence-role candidate MUST set origin `specialist-proposed`, copy only schema-valid tagged location refs, and MUST reject payloads that include excerpts `readLocatedExcerpt` would not return. Candidate acceptance is not verification.

## 13. Non-Functional Requirements

- **Integrity:** item, locator reference and optional excerpt hash remain reconstructable after reopen.
- **Security:** forged, wrong-project and missing-operation callers cannot write or read another project's items.
- **Privacy:** unclassified source content is not copied into diagnostics or remote fallback.
- **Compatibility:** E01-E06 and E14 public APIs, SQLite rows and tests remain unchanged and passing.
- **Honesty:** metadata-only and inaccessible sources cannot yield a quotation-bearing item.

## 14. Contracts

### New contracts

- `readLocatedExcerpt(handle, capability, request): LocatedExcerptResult` returns exact located text or a bounded denial. It is the only E07 quotation oracle.
- `recordEvidenceItem(handle, capability, request): EvidenceItemResult` records one evidence item under explicit `commandId` and payload identity.
- `ingestEvidenceCandidate(handle, capability, request): EvidenceItemResult` validates an E05 candidate payload and records origin `specialist-proposed`.
- `getEvidenceItem(handle, capability, evidenceItemId): EvidenceItem` returns the item without rereading denied source bytes.
- `listEvidenceItems(handle, capability, filter?): readonly EvidenceItem[]` lists items for a source version or the project.
- `inspectEvidenceOperation(handle, commandId): EvidenceOperation` exposes pending/complete/failed recovery state.

### Existing contracts preserved

- `inspectSource` remains the access/integrity gate and the two shipped content paths (full text/Markdown file; segment text via `locatorId` = `source_segments.id`). E07 MUST NOT add `source_locators.id` resolution to it.
- `listSourceLocators` and `listSourceSegments` remain the location authorities; E07 does not create, merge or reinterpret those rows.
- `recordOwnerDecision` and `listCommitments` remain unused by evidence recording.
- `src/workspace/evidence.ts` `presentInspection` / viewer launch remain source inspection only.

## 15. Reason for Depth and Zoom-Out

`src/evidence/evidence-types.ts` owns E07 types; `src/evidence/evidence-store.ts` owns additive SQLite mapping and recording. Separate files are justified because type contracts and persistence/side effects have different callers; no interface/factory hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`:

- `src/persistence/schema.ts` serves existing stores; E07 adds idempotent tables without rewriting E01-E06 data.
- `src/project/project-store.ts` owns create/reopen status; E07 adds latest additive schema creation without changing status semantics.
- `src/sources/source-access.ts` owns inspection gates and the two shipped content paths; E07 `readLocatedExcerpt` binds tagged location refs onto those paths and does not modify `inspectSource`.
- `src/sources/source-store.ts` owns `listSourceLocators` and `listSourceSegments`; E07 reads both ID spaces.
- `src/index.ts` serves CLI/tests; E07 adds explicit typed exports only.

Planned tests: `tests/evidence/evidence-items.test.ts`, `tests/integration/evidence-authority.test.ts`, and shared helpers in `tests/support/evidence-fixtures.ts`.

## 16. Implementation Steps

1. Add evidence-item/operation types, exact v1 additive schema initialization paths and atomic retry/recovery coverage → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s01.*(schema|evidence item|reopen|migration|atomic|retry|recovery)' dist/tests/*/*.test.js`
2. Harden capability-scoped recording against forged, wrong-project, missing-operation and denied source-inspect callers → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s01.*(capability|project|forg|denied|authority)' dist/tests/*/*.test.js`
3. Record the four statement kinds with tagged source-locator and source-segment refs and excerpts only from `readLocatedExcerpt` → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s01.*(statement|locator|segment|excerpt|author-claim|measured-finding|inference|interpretation)' dist/tests/*/*.test.js`
4. Reject inaccessible quotations, ingest specialist candidates as proposed origin, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e07s01.*(metadata.only|abstract.only|unavailable|quotation|specialist|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e07s01-P0-01: Located items survive reopen

```gherkin
Given a project capability and either an imported full-text text/Markdown source with a source_locators row or a text-based PDF/DOCX source with a source_segments row
When an evidence item is recorded with a statement kind, that source version and the matching tagged location ref
Then the item, kind, location kind/id and optional exact excerpt match after close and reopen
And passing a source_locators.id as inspectSource.locatorId is never required for the text/Markdown path
And an identical command retry returns the same item while a payload conflict is rejected
```

### Scenario SC-e07s01-P0-02: Inaccessible sources cannot yield quotations

```gherkin
Given a metadata-only, abstract-only, unavailable or incomplete-extraction source
When recording is attempted with a quotation or page-located excerpt
Then the command is rejected with a bounded access or extraction code
And no excerpt, invented quotation or invented page locator is stored
```

### Scenario SC-e07s01-P0-03: Capability attacks fail before item success

```gherkin
Given a forged capability, wrong-project worker, missing evidence:record operation or denied source:inspect
When recording or listing is attempted
Then access is denied
And no successful evidence item is produced
```

### Scenario SC-e07s01-P1-04: Statement kinds and specialist origin stay honest

```gherkin
Given owner-recorded items of each statement kind and a schema-valid Evidence-role candidate
When the items and candidate ingest complete
Then the four kinds remain distinct in storage
And the ingested item origin is specialist-proposed rather than verified or committed
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project, import a tiny text/Markdown fixture, and record one item per statement kind against `source-locator` IDs from `listSourceLocators`.
2. Import a tiny text-based PDF or DOCX fixture and record one item against a `source-segment` ID from `listSourceSegments`.
3. Close/reopen and resolve each item against the same tagged location ref.
4. Assert that using a `source_locators.id` as `inspectSource.locatorId` is not the E07 excerpt path.
5. Attempt excerpt recording against metadata-only, abstract-only, unavailable and incomplete extraction sources.
6. Attempt forged, wrong-project and missing-operation writes.
7. Ingest a synthetic E05 candidate payload and confirm origin `specialist-proposed`.
8. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Locator-identity mix-up:** never pass `source_locators.id` as `inspectSource.locatorId`; bind text/Markdown slices and PDF/DOCX segments through `readLocatedExcerpt`.
- **Quotation fabrication:** require `readLocatedExcerpt` text equality before storing excerpt.
- **Partial registration:** a durable command/payload operation brackets completion; pending never masquerades as complete.
- **Authority bypass:** workers need both `evidence:record` and current `source:inspect`; owners remain identity-matched.
- **TUI drift:** do not edit `src/workspace/evidence.ts` in this story.

## 20. Traceability

- Scope outcome: R07
- Epic acceptance scenarios: AC-05
- Test scenarios: SC-e07s01-P0-01, SC-e07s01-P0-02, SC-e07s01-P0-03, SC-e07s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` global invariants 2 and 7; evidence-item relationship
- Language: Evidence item, Source locator, Source version
