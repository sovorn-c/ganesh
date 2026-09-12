# e08s02 — Authorized Retrieval, Citation Exploration and Honest Coverage

## 1. Identity

- **Story ID:** e08s02
- **Epic:** e08 — Literature discovery and contribution challenge
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want authorized retrieval and citation exploration to record search dates, query versions, access rights, failures and coverage limits, so that I can replay the assessed corpus and distinguish a saved snapshot from a later live rerun.

## 3. Context

e08s01 stores protocol and query versions as artifact-backed records. E03 `requestDisclosure` already denies local-only material to remote destinations and currently lists eleven operation kinds. AC-16 requires that provider caps, failed pages, inaccessible sources and revised queries are all retained, and that snapshot replay is not a silent live search.

## 4. Problem

A live provider call without a snapshot, a failed page dropped from the report, or a second-destination retry after a paywall would fake coverage. Treating bibliographic identity as full-text acquisition, or adding an HTTP SDK, would also violate the local-first disclosure model.

## 5. Goal

Run authorized retrieval through an injected adapter, persist search events and corpus snapshots, replay snapshots without calling the adapter, record live reruns as new events, walk E06 bibliographic identities as relational citation edges, and deny remote disclosure of local-only query artifacts.

## 6. Non-Goals

- Screening, eligibility amendments and uncertainty queues; e08s03 owns these.
- Gap and contribution challenge; e08s04 owns these.
- Adding Crossref, OpenAlex, Semantic Scholar or other bibliographic HTTP packages.
- Paywall evasion, publisher HTML scraping, unbounded crawl, or OCR.
- Re-parsing PDF/DOCX inside literature code; full-text acquisition stays `importLocalSource`.
- TUI search consoles or native viewers.
- Human commitments.

## 7. Stakeholders

- Researchers who must reconstruct what was actually searched.
- E03 disclosure audits that must see retrieval as a first-class operation.
- E06 bibliographic records used as citation-exploration inputs.
- Later e08s04 counter-search, which creates additional search events under this contract.

## 8. Dependencies

- e08s01 protocol, query, landscape, corpus-identity and literature-operation contracts.
- E03 `requestDisclosure`, `DisclosureOperationKind`, local-only destination policy.
- E06 `listBibliographicRecords` and `importLocalSource`.
- `specs/docs/05-decisions-and-acceptance.md` AC-16.
- `specs/tech-architecture/e08-TEST_PLAN_LATEST.md` SC-e08s02-P0-01 through SC-e08s02-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- `LiteratureRetrievalAdapter.retrieve` returns an in-process report of hits, failures and coverage limits. Tests inject `FakeRetrievalAdapter`. Production default is `LocalRecordingAdapter`, which accepts an injected report or returns `adapter-network-disabled`. Neither implementation may import `fetch`, `node:http`, `node:net` or `node:dns`.
- `runAuthorizedRetrieval` MUST call `requestDisclosure` with `operation: "retrieval"`, `destination` and `purpose` from the query version, and `sourceVersions: [query.artifactVersionId]` plus any attached source version IDs. Empty source version lists remain denied by the existing gateway.
- Destination `local` is the recording/fake adapter. A remote destination string is allowed only when disclosure allows it; this epic still does not ship a live HTTP adapter.
- A corpus snapshot is the dated set of corpus record IDs produced by one search event. `replayCorpusSnapshot` returns those records without calling the adapter.
- `liveRerunOfSearchEventId` creates a new search event. Adapter output may differ. The prior snapshot rows stay unchanged.
- Citation exploration reads E06 bibliographic records and writes relational `cites` / `cited-by` edges. Default `maxHops` is 1 and `maxRecords` is finite. Exhaustive citation coverage is not a stored claim.
- Full-text bytes arriving through an adapter report MUST go through `importLocalSource`; literature storage keeps the resulting `sourceVersionId` only.

## 10. Constraints

- `src/literature/**` MUST NOT import `node:http`, `node:net`, `node:dns`, or call global `fetch`.
- After a paywalled or rights-denied adapter result, the command MUST record `inaccessible` / `access-denied-by-rights` on that event and MUST NOT automatically retry a different destination.
- Failed remote adapter outcomes MUST NOT be stored as completed searches. They are `failed-page` or `adapter-failed` coverage rows on the search event.
- Diagnostics MUST NOT include restricted query text, credentials, or raw adapter payloads beyond bounded codes and safe identifiers.
- Existing disclosure kinds keep current semantics. Adding `retrieval` is additive.

## 11. Domain Model

- **Search event:** one dated retrieval attempt against one query version, with access rights, failures and coverage limits.
- **Corpus snapshot:** the dated record set actually considered for that event.
- **Coverage limit:** provider cap, failed page, inaccessible source, rights denial, or adapter-network-disabled.
- **Citation edge:** relational `from_record_id` / `to_record_id` / `relation` row, not a graph database.
- **Live rerun:** a new search event that may differ from its parent snapshot.

## 12. Requirements

### MODIFIED: Disclosure operation kinds

**Before:** `DisclosureOperationKind` and `DISCLOSURE_OPERATIONS` listed prompt, attachment, summary, compaction, snippet, embedding, telemetry, export, diagnostic, analysis and inspection.

**After:** the same list also includes `retrieval`. `runAuthorizedRetrieval` must call `requestDisclosure` with operation `retrieval` against the query artifact version before any adapter destination other than denied-by-default remote use. Existing kinds keep current semantics. Empty `sourceVersions` still deny.

### ADDED: Authorized retrieval with honest coverage

Given provider caps, a failed page, inaccessible sources and revised queries, the search report MUST record all four. Each exclusion MUST carry a criterion or query version and a reason.

### ADDED: Snapshot replay versus live rerun

Replaying a saved snapshot MUST reconstruct the assessed corpus without calling the adapter. Rerunning a live query MUST be recorded as a new event that may differ.

### ADDED: Citation exploration stays bounded and local-first

Citation exploration MUST create relational edges from acquired bibliographic identities, MUST NOT open sockets, and MUST NOT store a claim of exhaustive citation coverage.

### ADDED: Paywall and local-only honesty

Local-only query artifacts MUST NOT be disclosed to a remote retrieval destination. Inaccessible adapter results stay recorded as coverage limits.

## 13. Non-Functional Requirements

- **Integrity:** search events, snapshots and citation edges reconstruct after reopen.
- **Security:** remote retrieval of local-only artifacts is denied; no new security findings in disclosure paths.
- **Privacy:** restricted query bytes are not sent to remote destinations or copied into diagnostics.
- **Compatibility:** existing disclosure kinds and E06 bibliographic APIs remain passing.
- **Honesty:** failed pages are not completed searches; snapshots are not live queries.

## 14. Contracts

### New contracts

- `runAuthorizedRetrieval(handle, capability, request): SearchEvent` runs one adapter-backed search under `commandId`, records coverage, and builds a snapshot.
- `replayCorpusSnapshot(handle, capability, snapshotId): CorpusSnapshot` returns the stored record set without adapter invocation.
- `exploreCitations(handle, capability, request): CitationExplorationResult` writes bounded relational edges from E06 bibliographic identities.
- `getSearchEvent` / `listSearchEvents` / `getCorpusSnapshot` / `listCitationEdges`.
- `LiteratureRetrievalAdapter` with `LocalRecordingAdapter` default.

### Existing contracts preserved

- `requestDisclosure` remains the destination/purpose oracle. E08 adds one enum value and does not weaken local-only denial.
- `listBibliographicRecords` remains the citation-identity oracle for already imported bibliographies.
- `importLocalSource` remains the full-text intake path.
- `recordOwnerDecision` remains unused.

## 15. Reason for Depth and Zoom-Out

`src/literature/retrieval-adapter.ts` owns the injected adapter boundary; `src/literature/retrieval-store.ts` owns search events, snapshots and citation edges. The split exists so socket-free adapter policy can be reviewed without the SQLite mapping. No provider client hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`. Planned tests: `tests/literature/retrieval-coverage.test.ts` and `tests/integration/literature-authority.test.ts`.

## 16. Implementation Steps

1. Add retrieval adapter, search-event, snapshot and coverage types plus AC-16 recording of provider caps, failed pages, inaccessible sources and revised queries → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s02.*(provider cap|failed page|inaccessible|revised query|search event)' dist/tests/*/*.test.js`
2. Replay saved snapshots without the adapter and record live reruns as new events that do not overwrite prior snapshots → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s02.*(snapshot|live rerun|replay)' dist/tests/*/*.test.js`
3. Deny local-only remote retrieval, record paywalled results as coverage limits without a second-destination bypass, and prove no new security findings in affected disclosure paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s02.*(local-only|remote|paywall|inaccessible|disclosure)' dist/tests/*/*.test.js`
4. Explore citations from E06 bibliographic records as relational edges without sockets, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e08s02.*(citation|bibliographic|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e08s02-P0-01: Search reproducibility records all four AC-16 losses

```gherkin
Given a protocol, query v1 and an injected adapter that reports a provider cap, a failed page and an inaccessible source
When authorized retrieval runs and a revised query v2 is then recorded and run
Then the search report retains all four conditions
And each exclusion has a criterion or query version and a reason
```

### Scenario SC-e08s02-P0-02: Snapshot replay is not a live search

```gherkin
Given a completed search event with a corpus snapshot
When the snapshot is replayed and then a live rerun is requested
Then replay reconstructs the assessed corpus without calling the adapter
And the live rerun is a new event that may differ
And the original snapshot rows are unchanged
```

### Scenario SC-e08s02-P0-03: Local-only and paywall paths stay honest

```gherkin
Given a local-only classified query artifact and a remote retrieval destination
When authorized retrieval is requested
Then disclosure denies the call
And no adapter remote destination is used
And a paywalled adapter result on an allowed local recording is stored as inaccessible rather than retried elsewhere
```

### Scenario SC-e08s02-P1-04: Citation exploration is bounded

```gherkin
Given imported bibliographic records
When citation exploration runs with default hop and record limits
Then relational citation edges are stored
And no socket API is used
And the result does not claim exhaustive citation coverage
```

## 18. Verification Script (Step-by-Step)

1. Record protocol and query v1 from e08s01 contracts.
2. Inject an adapter report with provider-cap, failed-page and inaccessible rows plus some hits.
3. Run authorized retrieval and inspect the search event and snapshot.
4. Record query v2 as a revision and run it as a new event.
5. Replay the first snapshot and assert the adapter was not called.
6. Live-rerun query v1 with a different adapter report; assert a new event and unchanged first snapshot.
7. Classify a query artifact local-only and attempt destination `remote-provider`; expect deny.
8. Explore citations from a tiny BibTeX import.
9. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Silent live search:** replay never calls the adapter; live rerun always allocates a new event ID.
- **Paywall bypass:** no automatic destination retry; rights denials stay on the originating event.
- **Disclosure drift:** additive `retrieval` kind with regression of existing kinds.
- **Socket leak:** adapter module is the only retrieval boundary; `src/literature` forbids network imports.
- **Parser duplication:** full-text still enters through E06.

## 20. Traceability

- Scope outcome: R08
- Epic acceptance scenarios: AC-16
- Test scenarios: SC-e08s02-P0-01, SC-e08s02-P0-02, SC-e08s02-P0-03, SC-e08s02-P1-04
- Domain contracts: D-11, D-17, global invariants 3, 4 and 7
- Language: Corpus record, Corpus snapshot
