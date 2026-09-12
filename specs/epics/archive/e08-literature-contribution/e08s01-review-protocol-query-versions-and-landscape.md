# e08s01 — Review Protocol, Query Versions and Landscape Map

## 1. Identity

- **Story ID:** e08s01
- **Epic:** e08 — Literature discovery and contribution challenge
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want to record a versioned review protocol, query versions and a landscape map bound to those versions, so that later retrieval and screening can be replayed against exact search-scope records rather than an unversioned chat summary.

## 3. Context

E02 already stores immutable artifact versions. E03 already classifies material and authorizes destinations. E05 already returns Discovery-role candidates. This first vertical slice adds literature-protocol semantics without retrieving remotely, screening papers, or claiming a complete corpus.

## 4. Problem

A topic sentence in chat is not a review protocol. Recording a fluent landscape without query versions, mutating eligibility in place, or treating a specialist candidate as a committed search design would make AC-16 replay and later gap challenge impossible.

## 5. Goal

Record capability-scoped review protocols and query versions as artifact-backed records, persist a landscape map that names those exact versions, allow owner-recorded corpus identities against the protocol, and reconstruct the records after reopen.

## 6. Non-Goals

- Authorized retrieval, corpus snapshots, citation exploration and live/rerun search events; e08s02 owns these.
- Screening, eligibility amendments and uncertainty queues; e08s03 owns these.
- Gap and contribution challenge; e08s04 owns these.
- Method design, RQ alternatives and method profiles; E09 owns those.
- Human commitments, scholarly-finding rows or reasoned overrides; E04 owns those.
- TUI corpus boards, native viewers, OCR, or a bibliographic HTTP package.
- Treating specialist-candidate registration as a completed search or novelty claim.

## 7. Stakeholders

- Researchers designing a defensible search before retrieval.
- E05 Discovery-role consumers that later ingest structured candidates.
- E08 later stories that retrieve, screen and challenge gaps against these versions.
- E03 policy and capability boundaries that must remain deny-by-default.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E02 `registerArtifactVersion`, reopen and additive schema behavior.
- E03 owner/worker capabilities and local-only disclosure defaults.
- E05 `work_candidates` as an optional origin, not a required writer.
- `specs/IMPACT_LATEST.md` shared-module blast-radius assessment.
- `specs/tech-architecture/e08-TEST_PLAN_LATEST.md` scenarios SC-e08s01-P0-01 through SC-e08s01-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- Protocol identity is a new durable ID. Each protocol version registers an E02 artifact version whose bytes are the canonical protocol JSON (eligibility criteria, scope notes, query-language note). Content edits create a new protocol version; committed bytes are not rewritten.
- Query identity is a new durable ID. Each query version registers an E02 artifact version whose bytes are the canonical query JSON (expression, destination, purpose, parent query version). Revised queries are new versions with `supersedesQueryVersionId`.
- Landscape maps name `protocolVersionId` plus one or more `queryVersionIds`. They do not embed live hit lists.
- Owner-recorded corpus identities may bind a bibliographic identity and optional E06 `sourceVersionId` to a protocol version without calling a retrieval adapter. They are not search events.
- Origin is `owner-recorded` or `specialist-proposed`. Specialist ingest reads an accepted E05 Discovery-role candidate payload and still cannot become a committed protocol.
- The owner capability must match the project owner. A worker capability must match the project ID and allow `literature:protocol` for writes and `literature:inspect` for reads.
- `PROJECT_SCHEMA_VERSION` stays 1. E08 tables are additive feature tables.

## 10. Constraints

- `recordReviewProtocol`, `recordQueryVersion`, `recordLandscapeMap` and `recordCorpusIdentity` MUST persist a unique literature operation before completion using caller `commandId` and payload hash. Same-command retries resume; a changed payload is rejected. Pending state remains visible and never claims a complete record.
- A landscape map MUST reject missing protocol versions, empty `queryVersionIds`, and query IDs that do not belong to that protocol.
- Diagnostics and errors contain bounded codes and safe identifiers, never query text from restricted artifacts, credentials or unrestricted paths.
- `src/workspace/evidence.ts` MUST NOT change.
- Keep `PROJECT_SCHEMA_VERSION` at 1. `createE08Schema` is idempotent and runs from new-project `createSchema`, explicit `migrateSchema`, and writable ready-project `openProject`. Explicit read-only, migration-required and unknown-future opens never mutate schema. A read-only v1 project lacking E08 tables reports `literature-schema-unavailable` for E08 reads.

## 11. Domain Model

- **Review protocol:** versioned eligibility and search-scope artifact used by later screening.
- **Query version:** dated expression bound to one protocol version, destination and purpose.
- **Landscape map:** dated description of domains/clusters considered, bound to exact protocol and query versions.
- **Corpus record:** bibliographic identity linked to discovery or screening history and optional acquired source versions. This story only creates owner-recorded identities.
- **Literature operation:** idempotency/recovery record containing command ID, payload hash and `pending | complete | failed` status.

## 12. Requirements

### MODIFIED: Ready-project feature schema initialization

**Before:** writable ready-project open idempotently ensured E04, E06, E05 and E07 additive tables while schema marker version 1 remained unchanged.

**After:** new-project creation, explicit migration and writable ready-project open also idempotently ensure additive E08 literature tables without changing schema marker version 1. Explicit read-only, migration-required and unknown-future opens never mutate schema, and missing E08 tables return a typed unavailable result.

### ADDED: Capability-scoped literature recording

`recordReviewProtocol`, `recordQueryVersion`, `recordLandscapeMap` and `recordCorpusIdentity` MUST verify owner/project identity or worker project/operation scope.

### ADDED: Artifact-backed protocol and query versions

A successful protocol or query record MUST register an E02 artifact version for the canonical JSON bytes and persist the literature row with that `artifactVersionId`, version label, destination/purpose where applicable, and command identity.

### ADDED: Landscape map names exact versions

A successful landscape map MUST store the protocol version ID and the named query version IDs. It MUST NOT store a claim of complete coverage.

### ADDED: Specialist origin is proposed

Ingesting an E05 Discovery-role candidate MUST set origin `specialist-proposed`, copy only schema-valid protocol/query fields, and MUST reject payloads that omit eligibility or query expression. Candidate acceptance is not a human commitment.

## 13. Non-Functional Requirements

- **Integrity:** protocol, query, landscape and owner-recorded corpus identity reconstruct after reopen.
- **Security:** forged, wrong-project and missing-operation callers cannot write or read another project's literature records.
- **Privacy:** unclassified query text is not copied into diagnostics or remote fallback.
- **Compatibility:** E01–E07 and E14 public APIs, SQLite rows and tests remain unchanged and passing.
- **Honesty:** a landscape map is not a completed search and not a novelty certificate.

## 14. Contracts

### New contracts

- `recordReviewProtocol(handle, capability, request): ReviewProtocol` records one protocol version under explicit `commandId`.
- `recordQueryVersion(handle, capability, request): QueryVersion` records one query version bound to a protocol version.
- `recordLandscapeMap(handle, capability, request): LandscapeMap` records a landscape bound to exact protocol and query versions.
- `recordCorpusIdentity(handle, capability, request): CorpusRecord` records an owner-supplied bibliographic identity against a protocol version.
- `ingestDiscoveryCandidate(handle, capability, request): ReviewProtocol | QueryVersion` validates an E05 Discovery candidate and records origin `specialist-proposed`.
- `getReviewProtocol` / `listReviewProtocols` / `getQueryVersion` / `listQueryVersions` / `getLandscapeMap` / `listCorpusRecords` return stored records without rereading denied source bytes.
- `inspectLiteratureOperation(handle, commandId): LiteratureOperation` exposes pending/complete/failed recovery state.

### Existing contracts preserved

- `registerArtifactVersion` remains the byte-identity writer; E08 does not write artifact files directly.
- `recordOwnerDecision` and `listCommitments` remain unused by literature recording.
- `src/workspace/evidence.ts` `presentInspection` / viewer launch remain source inspection only.

## 15. Reason for Depth and Zoom-Out

`src/literature/literature-types.ts` owns E08 types; `src/literature/literature-store.ts` owns additive SQLite mapping and protocol/query/landscape recording. Separate files are justified because type contracts and persistence/side effects have different callers; no interface/factory hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`:

- `src/persistence/schema.ts` serves existing stores; E08 adds idempotent tables without rewriting E01–E07 data.
- `src/project/project-store.ts` owns create/reopen status; E08 adds latest additive schema creation without changing status semantics.
- `src/artifacts/artifact-store.ts` owns immutable bytes; E08 registers protocol/query JSON through it.
- `src/index.ts` serves CLI/tests; E08 adds explicit typed exports only.

Planned tests: `tests/literature/review-protocol.test.ts`, `tests/integration/literature-authority.test.ts`, and shared helpers in `tests/support/literature-fixtures.ts`.

## 16. Implementation Steps

1. Add literature protocol/query/landscape/operation types, exact v1 additive schema initialization paths and atomic retry/recovery coverage → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s01.*(schema|review protocol|query version|reopen|migration|atomic|retry|recovery)' dist/tests/*/*.test.js`
2. Harden capability-scoped recording against forged, wrong-project and missing-operation callers → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s01.*(capability|project|forg|denied|authority)' dist/tests/*/*.test.js`
3. Bind landscape maps to exact protocol and query versions and reject unbound maps → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s01.*(landscape|protocol version|query version|unbound)' dist/tests/*/*.test.js`
4. Ingest specialist candidates as proposed origin, record owner corpus identities, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e08s01.*(specialist|corpus identity|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e08s01-P0-01: Protocol, query and landscape survive reopen

```gherkin
Given a project capability
When a review protocol, a query version and a landscape map naming those versions are recorded
Then the protocol, query expression, artifact version IDs and landscape bindings match after close and reopen
And an identical command retry returns the same records while a payload conflict is rejected
```

### Scenario SC-e08s01-P0-02: Capability attacks fail before literature success

```gherkin
Given a forged capability, wrong-project worker or missing literature:protocol operation
When recording or listing is attempted
Then access is denied
And no successful protocol, query, landscape or corpus identity is produced
```

### Scenario SC-e08s01-P0-03: Landscape maps require exact versions

```gherkin
Given a recorded protocol version and query version
When a landscape map omits query versions or names a query from another protocol
Then the command is rejected with a bounded code
And no landscape row is stored
```

### Scenario SC-e08s01-P1-04: Specialist origin and corpus identity stay honest

```gherkin
Given a schema-valid Discovery-role candidate and an owner-recorded bibliographic identity
When ingest and corpus-identity recording complete
Then the ingested protocol or query origin is specialist-proposed rather than committed
And the corpus identity remains distinct from any E06 source version unless an optional sourceVersionId was supplied
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project and record one protocol version with eligibility JSON.
2. Record one query version bound to that protocol, destination `local`, purpose `literature-search`.
3. Record a landscape map naming those versions.
4. Close/reopen and resolve each record against the same IDs and artifact hashes.
5. Attempt forged, wrong-project and missing-operation writes.
6. Attempt a landscape with empty query version IDs.
7. Ingest a synthetic Discovery candidate payload and confirm origin `specialist-proposed`.
8. Record one owner-supplied corpus identity.
9. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Unversioned eligibility drift:** protocol edits always create a new artifact-backed version.
- **Landscape without queries:** reject unbound maps at the command boundary.
- **Partial registration:** a durable command/payload operation brackets completion; pending never masquerades as complete.
- **Authority bypass:** workers need `literature:protocol`; owners remain identity-matched.
- **TUI drift:** do not edit `src/workspace/evidence.ts` in this story.

## 20. Traceability

- Scope outcome: R08
- Epic acceptance scenarios: AC-16 (query versions and replay prerequisites)
- Test scenarios: SC-e08s01-P0-01, SC-e08s01-P0-02, SC-e08s01-P0-03, SC-e08s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` corpus snapshot and gap-assessment relationships; D-11
- Language: Corpus record, Corpus snapshot, Review protocol as research artifact
