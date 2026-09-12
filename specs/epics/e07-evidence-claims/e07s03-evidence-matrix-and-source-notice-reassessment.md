# e07s03 — Evidence Matrix and Source-Notice Reassessment

## 1. Identity

- **Story ID:** e07s03
- **Epic:** e07 — Located evidence and accountable claims
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want an inspectable evidence matrix that retains disagreements, limitations, corrections and retractions so that affected claims are marked for reassessment without rewriting historical snapshots.

## 3. Context

e07s02 records claims and support/challenge links. E02 already records shared-source correction notices as impact records without mutating branch snapshots. This slice projects those facts into a claim matrix and a claim-level reassessment state.

## 4. Problem

A fluent synthesis that drops contrary links, or a correction that rewrites historical claim rows, would hide disagreement and destroy reconstructability. AC-08 already requires shared-source notices to reach users of a version without rewriting snapshots.

## 5. Goal

Build a matrix of selected claims against supporting, challenging, disagreement and limitation entries; apply E02 shared-source correction or an explicit retraction notice so currently affected claims become `needs-reassessment`; leave historical claim, link and verification rows intact.

## 6. Non-Goals

- Creating evidence items or citation verification rules; e07s01/e07s02 own these.
- Method-appropriate appraisal and qualified synthesis text; e07s04 owns these.
- Branch promotion, snapshot mutation or new E02 impact semantics.
- Deletion, export, literature counter-search or contribution challenge.
- TUI matrix widgets.

## 7. Stakeholders

- Researchers comparing how each claim is supported or challenged.
- Downstream synthesis (e07s04) that must not drop contrary cells.
- E02 recovery/history consumers that require immutable snapshots.

## 8. Dependencies

- e07s01 items and e07s02 claims/links/verifications.
- E02 `recordSharedSourceCorrection` and impact records.
- `specs/tech-architecture/e07-TEST_PLAN_LATEST.md` SC-e07s03-P0-01 through SC-e07s03-P1-04.

## 9. Assumptions

- The matrix is a derived inspectable view plus a durable snapshot only when explicitly stored by a later synthesis command. e07s03 `buildEvidenceMatrix` returns a deterministic structure from current rows; it does not rewrite claims.
- Reassessment is a claim current-support overlay. Historical verification rows stay as recorded.
- Retraction and correction both travel through `recordSharedSourceCorrection` (notice text distinguishes kind) plus `applySourceNotice`, which maps impacted source versions to claims that link evidence items on those versions.
- Unrelated claims and branches that do not currently use the source version are not marked.

## 10. Constraints

- `buildEvidenceMatrix` requires owner identity or worker `claim:inspect` / `evidence:inspect`.
- `applySourceNotice` MUST call `recordSharedSourceCorrection` for the named source version when the caller requests a new notice, or consume an existing impact `commandId` without duplicating a conflicting payload.
- After a notice, each currently linked claim's current support becomes `needs-reassessment` while previous support is stored on the reassessment row.
- Historical claim statement, links and citation-verification rows MUST remain byte-equal for unchanged fields.
- E02 snapshot IDs and branch references MUST NOT change as a side effect of E07 reassessment.

## 11. Domain Model

- **Evidence matrix:** rows are claims; cells are supporting, challenging, disagreement and limitation references with current verification/access codes.
- **Disagreement cell:** presence of both supporting and challenging links, or an E05 disagreement ID optionally attached to the claim, retained as visible conflict.
- **Limitation cell:** access, extraction, integrity or recorded qualification codes.
- **Claim reassessment:** overlay status `needs-reassessment` caused by a source notice, with previous support retained.

## 12. Requirements

### ADDED: Inspectable evidence matrix

`buildEvidenceMatrix` MUST include every selected claim's supporting links, challenging links, disagreements and limitations. Omitting a challenging link to make a row look settled is forbidden.

### ADDED: Source-notice reassessment

`applySourceNotice` MUST mark currently affected claims `needs-reassessment` when the cited source version receives a correction or retraction notice.

### ADDED: Historical reconstructability

Claim, link and verification rows created before the notice MUST remain readable with their original statuses. The overlay is additive.

### ADDED: Isolation of unaffected work

Claims that do not link evidence on the noticed source version MUST keep their current support. E02 snapshots MUST stay unchanged.

## 13. Non-Functional Requirements

- **Integrity:** matrix contents reconstruct from durable rows after reopen.
- **Compatibility:** E02 impact/snapshot tests remain passing; E07 does not reinterpret locators.
- **Isolation:** notices do not leak across unused claims or projects.
- **Honesty:** disagreement and limitation cells survive matrix build.

## 14. Contracts

### New contracts

- `buildEvidenceMatrix(handle, capability, request): EvidenceMatrix`
- `applySourceNotice(handle, capability, request): ReassessmentResult`
- `listClaimReassessments(handle, claimId): readonly ClaimReassessment[]`

### Existing contracts preserved

- `recordSharedSourceCorrection` remains the E02 notice writer and snapshot-safe impact recorder.
- Claim verification rows remain append-only for a given command ID.
- Branch isolation tests in `tests/branches/isolation.test.ts` remain the snapshot oracle.

## 15. Reason for Depth and Zoom-Out

Matrix building lives in `src/evidence/claim-store.ts` (or a focused `matrix.ts` helper in the same folder if the store would exceed the 300-line guideline). Reason for depth of a helper: projection queries plus notice overlay are a different failure mode than claim writes. No graph database.

Shared modules: `branches/dependency-store.ts` `recordSharedSourceCorrection` (called, not copied); claim-store rows; project isolation via capabilities.

Planned tests: `tests/evidence/evidence-matrix.test.ts` plus regression against `tests/branches/isolation.test.ts`.

## 16. Implementation Steps

1. Build a matrix that retains supporting, challenging, disagreement and limitation cells after reopen → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s03.*(matrix|supporting|challenging|disagreement|limitation|reopen)' dist/tests/*/*.test.js`
2. Apply correction and retraction notices so affected claims need reassessment without rewriting snapshots or historical claim rows → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s03.*(correction|retraction|reassessment|snapshot|history)' dist/tests/*/*.test.js`
3. Leave unrelated claims unmarked and keep E02 impact records as the notice authority → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s03.*(unrelated|branch|impact)' dist/tests/*/*.test.js`
4. Prove capability isolation and keep released tests passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e07s03.*(capability|forg|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e07s03-P0-01: Matrix retains disagreement

```gherkin
Given a claim with supporting and challenging evidence plus recorded limitations
When the evidence matrix is built
Then both support and challenge cells are present
And limitations remain visible
```

### Scenario SC-e07s03-P0-02: Correction marks affected claims

```gherkin
Given a claim that links evidence on a source version
When a shared-source correction or retraction notice is applied
Then that claim's current support becomes needs-reassessment
And E02 snapshots for branches using that source are not rewritten
```

### Scenario SC-e07s03-P0-03: History remains reconstructable

```gherkin
Given verification and link rows recorded before a source notice
When reassessment overlay is applied
Then those historical rows still read with their original statuses
And previous support is retained on the reassessment record
```

### Scenario SC-e07s03-P1-04: Unrelated claims stay current

```gherkin
Given a second claim that does not use the noticed source version
When the notice is applied
Then the second claim's current support is unchanged
```

## 18. Verification Script (Step-by-Step)

1. Build a matrix from a claim with support, challenge and limitation links.
2. Apply `recordSharedSourceCorrection` through `applySourceNotice` and inspect claim overlay.
3. Re-read historical verification rows and E02 snapshot IDs.
4. Confirm an unrelated claim is unmarked.
5. Run isolation and full released tests under Node.js 24.

## 19. Risks and Mitigations

- **Silent drop of contrary cells:** matrix builder iterates all links; tests assert challenge presence.
- **Snapshot rewrite:** call existing E02 API; assert snapshot IDs unchanged.
- **Over-marking:** join claims only through evidence items whose `sourceVersionId` matches the notice.

## 20. Traceability

- Scope outcome: R07
- Epic acceptance scenarios: shared-source snapshot isolation (AC-08 notice path); R07 matrix/reassessment outcome
- Test scenarios: SC-e07s03-P0-01, SC-e07s03-P0-02, SC-e07s03-P0-03, SC-e07s03-P1-04
- Domain contracts: artifact/deletion concurrency; AC-08 snapshot isolation; shared-source correction
