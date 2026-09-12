# e08s03 — Screening, Eligibility Amendments and Uncertainty Queue

## 1. Identity

- **Story ID:** e08s03
- **Epic:** e08 — Literature discovery and contribution challenge
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want screening decisions, eligibility amendments and an uncertainty queue to stay inspectable against the criterion version actually used, so that I can change eligibility without rewriting history or inventing a universal paper-count stop rule.

## 3. Context

e08s01 stores protocol versions and owner-recorded corpus identities. e08s02 may also contribute snapshot-backed corpus records, but this slice is independently demonstrable against owner-recorded identities. D-12 rejects universal saturation rules. AC-16 requires every exclusion to carry a criterion version and reason.

## 4. Problem

Editing eligibility in place, deleting uncertain items, or auto-stopping because "n papers were found" would hide the assessed corpus and fake methodological completeness.

## 5. Goal

Record include, exclude and uncertain decisions against a protocol version; park uncertain records in an inspectable queue; amend eligibility by creating a new protocol version; reject universal saturation and paper-count stop rules while still allowing descriptive snapshot counts.

## 6. Non-Goals

- Gap and contribution challenge; e08s04 owns these.
- Changing retrieval adapter behavior; e08s02 already owns coverage limits.
- Method profiles that later justify saturation as a qualitative stopping rule; E09 owns study design. This story still forbids a universal product-level threshold.
- Human commitments or TUI screening boards.
- Automatic full-text download on include.

## 7. Stakeholders

- Researchers documenting PRISMA-style decisions without treating counts as proof.
- Later e08s04 gap assessments that must see who was excluded and why.
- Reviewers inspecting criterion versions after an amendment.

## 8. Dependencies

- e08s01 protocol versions, corpus identities and literature operations.
- Optional consumption of e08s02 corpus records when present; not required to demonstrate this slice.
- `specs/tech-architecture/e08-TEST_PLAN_LATEST.md` SC-e08s03-P0-01 through SC-e08s03-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- Screening decisions are `include`, `exclude` or `uncertain`. Each row stores `protocolVersionId`, `criterionId`, `reason` and `corpusRecordId`.
- Eligibility amendments call `recordReviewProtocol` semantics for a new version and write an amendment record `{ fromVersion, toVersion, rationale }`. Historical screening rows keep their original `protocolVersionId`.
- Uncertainty-queue entries reference one corpus record and remain `open` until an explicit resolve writes a later screening decision. Resolving one entry does not rewrite unrelated exclusions.
- Descriptive counts (included/excluded/uncertain at a snapshot or protocol version) are allowed. Fields or flags named `saturated`, `universal-saturation`, or a stop rule of the form `paperCount >= N` without a method-specific E09 protocol are rejected as `unjustified-threshold`.
- Workers need `literature:screen` to write and `literature:inspect` to read. Owners remain identity-matched.

## 10. Constraints

- Historical screening rows MUST NOT be updated in place except to attach a later `supersededByDecisionId` pointer when the same corpus record is re-screened under a new protocol version. Original criterion, reason and decision stay readable.
- `recordScreeningDecision` MUST reject unknown corpus records and protocol versions.
- Diagnostics contain bounded codes and identifiers, never full abstracts copied from restricted sources.
- This story MUST NOT call `recordOwnerDecision`.

## 11. Domain Model

- **Screening decision:** dated include/exclude/uncertain judgment bound to one criterion version.
- **Eligibility amendment:** explicit protocol version change with rationale.
- **Uncertainty queue:** inspectable set of open uncertain records.
- **Descriptive count:** a computed inspection total, not a stop rule.
- **Unjustified threshold:** a rejected attempt to treat paper count or universal saturation as completeness.

## 12. Requirements

### ADDED: Inspectable screening decisions

Include, exclude and uncertain decisions MUST persist and remain readable after reopen against the criterion version used.

### ADDED: Eligibility amendments do not rewrite history

An amendment MUST create a new protocol version. Historical screening rows MUST keep their original criterion version and reasons.

### ADDED: No universal paper-count or saturation threshold

Commands that set universal saturation or a paper-count stop rule MUST be rejected with `unjustified-threshold`. Descriptive snapshot counts remain allowed.

### ADDED: Uncertainty queue stays inspectable

Uncertain records MUST appear in the queue until resolved. Resolving one entry MUST NOT rewrite unrelated exclusions.

## 13. Non-Functional Requirements

- **Integrity:** screening, amendments and queue entries reconstruct after reopen.
- **Security:** forged and wrong-project callers cannot screen another project.
- **Honesty:** counts are descriptive; they are not saturation.
- **Compatibility:** e08s01 protocol rows remain append-only through this story's amendment path.

## 14. Contracts

### New contracts

- `recordScreeningDecision(handle, capability, request): ScreeningDecision`
- `amendEligibility(handle, capability, request): EligibilityAmendment`
- `listScreeningDecisions(handle, capability, filter?): readonly ScreeningDecision[]`
- `listUncertaintyQueue(handle, capability, filter?): readonly UncertaintyQueueEntry[]`
- `resolveUncertainty(handle, capability, request): ScreeningDecision`
- `inspectScreeningCounts(handle, capability, filter?): ScreeningCounts` returns descriptive totals only.

### Existing contracts preserved

- Protocol versions remain artifact-backed E08/E02 records. Amendments do not rewrite protocol artifact bytes.
- Corpus records remain E08 identities; screening does not invent bibliographic fields.

## 15. Reason for Depth and Zoom-Out

`src/literature/screening-store.ts` owns screening, amendments and the uncertainty queue. It stays separate from protocol recording and retrieval because eligibility history is a distinct caller set. No workflow engine is introduced.

Planned tests: `tests/literature/screening-eligibility.test.ts` plus authority cases in `tests/integration/literature-authority.test.ts`.

## 16. Implementation Steps

1. Record include, exclude and uncertain decisions that survive reopen against the criterion version used → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s03.*(screening|include|exclude|uncertain|reopen)' dist/tests/*/*.test.js`
2. Amend eligibility by creating a new protocol version without rewriting historical screening rows → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s03.*(amendment|protocol version|historical|criterion)' dist/tests/*/*.test.js`
3. Reject universal saturation and paper-count stop rules while allowing descriptive counts → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e08s03.*(unjustified-threshold|saturation|paper-count|descriptive)' dist/tests/*/*.test.js`
4. Keep the uncertainty queue inspectable, isolate unrelated exclusions on resolve, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e08s03.*(uncertainty|queue|unrelated|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e08s03-P0-01: Screening decisions survive reopen

```gherkin
Given a protocol version and three corpus identities
When include, exclude and uncertain decisions are recorded with criterion IDs and reasons
Then each decision matches after close and reopen against the same protocol version
```

### Scenario SC-e08s03-P0-02: Amendments keep historical rows

```gherkin
Given screening rows recorded under protocol v1
When eligibility is amended to protocol v2
Then v1 rows still expose their original criterion version and reasons
And the amendment record names fromVersion v1 and toVersion v2
```

### Scenario SC-e08s03-P0-03: Universal thresholds are rejected

```gherkin
Given any protocol version
When a command sets saturated true from paperCount or a universal saturation flag
Then the command is rejected with unjustified-threshold
And descriptive included/excluded/uncertain counts can still be inspected
```

### Scenario SC-e08s03-P1-04: Uncertainty queue isolation

```gherkin
Given two uncertain records and one exclusion
When one uncertain record is resolved to include
Then the remaining queue entry stays open
And the unrelated exclusion is unchanged
```

## 18. Verification Script (Step-by-Step)

1. Record a protocol and three owner-recorded corpus identities.
2. Screen them include/exclude/uncertain.
3. Close/reopen and list decisions.
4. Amend eligibility and confirm historical rows.
5. Attempt a paper-count saturation flag; expect `unjustified-threshold`.
6. Inspect descriptive counts.
7. Resolve one uncertainty-queue entry and check isolation.
8. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **In-place eligibility edits:** amendments always allocate a new protocol version.
- **Hidden uncertainty:** queue listing is a first-class inspect API.
- **Count-as-proof:** reject saturation flags at the command boundary.
- **Silent rescreen:** re-screening under a new version points `supersededByDecisionId` without deleting the old row.

## 20. Traceability

- Scope outcome: R08
- Epic acceptance scenarios: AC-16 (exclusion criterion/version and reason)
- Test scenarios: SC-e08s03-P0-01, SC-e08s03-P0-02, SC-e08s03-P0-03, SC-e08s03-P1-04
- Domain contracts: D-11, D-12
- Language: Corpus record, Protocol, Amendment
