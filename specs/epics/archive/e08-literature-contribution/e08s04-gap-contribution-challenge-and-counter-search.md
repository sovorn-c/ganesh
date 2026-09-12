# e08s04 — Gap and Contribution Challenge with Counter-Search

## 1. Identity

- **Story ID:** e08s04
- **Epic:** e08 — Literature discovery and contribution challenge
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 4
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want gap and contribution proposals to be search-scoped, dated and challenged by counter-search, so that a seeded contrary paper revises or rejects the gap instead of being suppressed, and no result claims universal novelty or exhaustive absence.

## 3. Context

e08s01–e08s03 provide protocol versions, snapshots and inspectable screening. E07 already stores claims and challenging evidence links. D-11 says gap assessments are search-scoped, dated and challenged. AC-04 requires contrary evidence to be retained.

## 4. Problem

Declaring a gap "novel" because the last search returned few hits, or dropping a seeded contrary paper to preserve a contribution sentence, would convert search limits into false scholarly certainty.

## 5. Goal

Record gap assessments bound to a corpus snapshot, query versions and search date; run counter-search that retains contrary corpus records and E07 challenging links; revise, reject or narrow the gap; reject statuses that claim universal novelty or exhaustive absence; leave E04 commitments untouched.

## 6. Non-Goals

- RQ framing, theory choice and method design; E09 owns those.
- Expert grading of whether a gap is "real"; E17 owns that qualification.
- Changing E07 citation-verification rules; bibliographic hits still are not substantive support.
- Human commitments, reasoned overrides, TUI contribution boards, export or packaging.
- Live HTTP beyond the e08s02 injected adapter.

## 7. Stakeholders

- Researchers testing a contribution sentence against the actual searched corpus.
- E07 claim/matrix consumers that must see challenging evidence.
- E09/E17 later consumers of qualified gap records.

## 8. Dependencies

- e08s01 protocol and query versions.
- e08s02 search events, snapshots and authorized retrieval.
- e08s03 screening/exclusions so counter-search can see what was parked or excluded.
- E07 `recordClaim`, `linkClaimEvidence` with role `challenging`, and `verifyCitation`.
- `specs/docs/05-decisions-and-acceptance.md` AC-04.
- `specs/tech-architecture/e08-TEST_PLAN_LATEST.md` SC-e08s04-P0-01 through SC-e08s04-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- A gap assessment MUST include `snapshotId`, `queryVersionIds`, `searchedAt` copied from the named search event, a scoped proposition, and status `proposed | revised | rejected | narrowed`.
- Statuses `universally-novel`, `exhaustive-absence`, `proven-gap` and `no-contrary-evidence-exists` are rejected.
- Counter-search calls `runAuthorizedRetrieval` (or records an injected contrary hit) under a query version derived from the gap, then MUST retain every contrary corpus record supplied in the request or adapter report.
- For each retained contrary record that can be represented as an E07 evidence item or bibliographic identity, counter-search MUST create or reuse a claim for the gap proposition and `linkClaimEvidence` with role `challenging`. It MUST NOT delete the contrary corpus record, hide it from `inspectGap`, or set claim support `substantively-supported` from identity alone.
- An empty contrary set yields qualifications such as `no-contrary-hits-in-scoped-search`; it MUST NOT flip the gap to universal novelty.
- Contribution proposals reference a gap ID, store qualifications, and inherit the gap's search scope. They are candidates, not commitments.
- Workers need `literature:assess-gap` to write. Origin may be `owner-recorded` or `specialist-proposed`.

## 10. Constraints

- `recordGapAssessment` MUST reject missing snapshot, missing query versions, or missing search date.
- Counter-search MUST NOT suppress a seeded contrary paper to preserve the original recommendation.
- Gap and contribution APIs MUST NOT call `recordOwnerDecision` or insert `scholarly_findings`.
- Quotations still come only from E07 `readLocatedExcerpt` when an excerpt is stored on a linked evidence item.
- Diagnostics use bounded codes; they do not claim scholarly validity.

## 11. Domain Model

- **Gap assessment:** dated, search-scoped evaluation of a proposed absence or unresolved need.
- **Contribution proposal:** candidate statement that depends on a gap assessment and stated qualifications.
- **Counter-search:** a search event run to challenge a gap, with retained contrary records.
- **Contrary evidence:** E07 challenging links plus retained corpus records.
- **Novelty:** not a field this story is allowed to set as universal.

## 12. Requirements

### ADDED: Search-scoped dated gap assessments

A gap assessment MUST cite a corpus snapshot, query versions and search date. Statuses that claim universal novelty or exhaustive absence MUST be rejected.

### ADDED: AC-04 contrary evidence is retained

Given a seeded paper that challenges the candidate gap, targeted counter-search MUST retain and assess it. The result MUST revise, reject or narrow the gap, or explain a narrower remaining scope. It MUST NOT suppress the source to preserve the original recommendation.

### ADDED: Contribution proposals stay qualified

A contribution proposal MUST keep qualifications after counter-search. An empty contrary set MUST NOT become a universal novelty claim.

### ADDED: Authority separation

Gap, contribution and counter-search records MUST NOT create human commitments or E04 scholarly findings. Specialist ingest stays `specialist-proposed`.

## 13. Non-Functional Requirements

- **Integrity:** gap, contribution and counter-search rows reconstruct after reopen.
- **Security:** forged callers cannot assess another project's gaps; no new security findings in claim-link paths.
- **Honesty:** missing contrary hits are scoped-search limits, not proof of absence.
- **Compatibility:** E07 challenging links and citation verification remain authoritative.

## 14. Contracts

### New contracts

- `recordGapAssessment(handle, capability, request): GapAssessment`
- `recordContributionProposal(handle, capability, request): ContributionProposal`
- `runCounterSearch(handle, capability, request): CounterSearchResult` creates a search event, retains contrary records, and updates gap status to `revised | rejected | narrowed` or records a scoped explanation without universal novelty.
- `inspectGap(handle, capability, gapId): GapInspection` includes contrary corpus records, E07 challenging links, snapshot ID and qualifications.
- `ingestGapCandidate(handle, capability, request)` records origin `specialist-proposed`.

### Existing contracts preserved

- `linkClaimEvidence` remains the challenging-link writer. E08 does not add a parallel contrary table that hides E07 links.
- `verifyCitation` still distinguishes identity from support.
- `listCommitments` remains empty unless an E04 owner confirmation occurred.

## 15. Reason for Depth and Zoom-Out

`src/literature/gap-store.ts` owns gap, contribution and counter-search mapping. It calls retrieval-store and E07 claim APIs instead of duplicating them. No novelty-scoring engine is introduced.

Planned tests: `tests/literature/gap-challenge.test.ts` and authority/non-write cases in `tests/integration/literature-authority.test.ts`.

## 16. Implementation Steps

1. Record search-scoped dated gap assessments and reject universal novelty or exhaustive-absence statuses → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s04.*(gap assessment|search-scoped|universal|exhaustive)' dist/tests/*/*.test.js`
2. Run AC-04 counter-search that retains a seeded contrary paper, links E07 challenging evidence, and revises, rejects or narrows the gap → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s04.*(contrary|counter-search|challenging|revised|rejected|narrowed)' dist/tests/*/*.test.js`
3. Keep contribution proposals qualified after counter-search and refuse universal novelty from an empty contrary set → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s04.*(contribution|qualified|empty contrary|novelty)' dist/tests/*/*.test.js`
4. Prove gap APIs do not create commitments or E04 findings, ingest specialist origin as proposed, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e08s04.*(commitment|scholarly finding|specialist|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e08s04-P0-01: Gaps are search-scoped and dated

```gherkin
Given a corpus snapshot, query versions and a search date
When a gap assessment is recorded
Then inspectGap exposes those scope fields
And statuses universally-novel and exhaustive-absence are rejected
```

### Scenario SC-e08s04-P0-02: AC-04 contrary paper is retained

```gherkin
Given a proposed gap and a seeded paper that challenges it
When targeted counter-search runs
Then the contrary corpus record remains inspectable
And an E07 challenging link exists
And the gap is revised, rejected or narrowed rather than preserved by hiding the source
```

### Scenario SC-e08s04-P0-03: Contributions stay qualified

```gherkin
Given a contribution proposal attached to a gap
When counter-search returns no additional contrary hits inside the scoped queries
Then the proposal keeps qualifications naming the scoped search
And the result does not claim universal novelty
```

### Scenario SC-e08s04-P1-04: No commitment or finding write

```gherkin
Given gap, contribution and counter-search records, including a specialist candidate
When those commands complete
Then listCommitments remains empty
And no scholarly_findings row is inserted
And specialist origin remains specialist-proposed
```

## 18. Verification Script (Step-by-Step)

1. Build a protocol, query, retrieval snapshot and screening set from prior story contracts.
2. Record a proposed gap bound to that snapshot.
3. Attempt `universally-novel`; expect rejection.
4. Seed a contrary bibliographic identity and run counter-search.
5. Inspect the gap: contrary record present, E07 challenging link present, status revised/rejected/narrowed.
6. Record a contribution proposal and a scoped empty-contrary follow-up; confirm qualifications remain.
7. Assert `listCommitments` is empty.
8. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Novelty laundering:** reject forbidden statuses at the command boundary.
- **Suppressed counterevidence:** inspectGap must list contrary record IDs; tests fail if they are absent.
- **Identity as support:** E07 verification rules still apply to linked claims.
- **Authority bleed:** no E04 writes from literature APIs.

## 20. Traceability

- Scope outcome: R08
- Epic acceptance scenarios: AC-04
- Test scenarios: SC-e08s04-P0-01, SC-e08s04-P0-02, SC-e08s04-P0-03, SC-e08s04-P1-04
- Domain contracts: D-11, global invariants 2 and 7
- Language: Gap assessment, Counterevidence, Corpus snapshot
