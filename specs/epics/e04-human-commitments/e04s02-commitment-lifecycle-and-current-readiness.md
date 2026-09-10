# e04s02 — Commitment Lifecycle and Current Readiness

## 1. Identity

- **Story ID:** e04s02
- **Epic:** e04 — Human commitments and research alternatives
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want decisions and commitments to retain their full lifecycle and current readiness so that an old approval remains honest history without silently authorizing work after a material change.

## 3. Context

E04s01 records exact owner dispositions. This story makes the history useful over time: revised packets, reopened questions, archived and superseded versions, dependency changes, and current readiness must remain distinct and inspectable.

## 4. Problem

A single mutable approval flag erases why a decision was made and can make a historical commitment look executable after its inputs change. Readiness must be recalculated for the intended action, while history remains reconstructable.

## 5. Goal

Implement append-only commitment lifecycle records and a readiness assessment that marks affected work for review when dependencies, availability, policy, or other current conditions change. Preserve prior dispositions and never silently rewrite them.

## 6. Non-Goals

- Initial packet/owner disposition authority; e04s01 owns it.
- Branch promotion and alternative comparison; e04s03 owns it.
- Scholarly override recording and external authorization source management; e04s04/e10 own them.
- Backup/restore, deletion propagation, terminal presentation, or study execution.

## 7. Stakeholders

- Owners reviewing current project readiness.
- Later analysis, ethics, writing, and bounded-work callers that must stop on stale commitments.
- E02 dependency/impact history and E03 current policy enforcement.

## 8. Dependencies

- e04s01 packet and decision contracts.
- E02 `dependency-store.ts`, `artifact-store.ts`, `branch-store.ts`, and history records.
- E03 policy/disclosure/lifecycle checks for current permission status.
- `specs/docs/05-decisions-and-acceptance.md` AC-07 and `specs/tech-architecture/tech-stack.md` readiness transitions.
- `specs/tech-architecture/e04-TEST_PLAN_LATEST.md` scenarios SC-e04s02-P0-01 through SC-e04s02-P1-03.

## 9. Assumptions

- Historical decision records are append-only through ordinary application operations; lawful deletion/retention remains a later concern.
- A revision creates a new packet rather than editing a packet already shown or decided.
- Readiness is assessed for a specified action and branch, not as one universal project stage.
- Existing dependency edges and E03 policy decisions are authoritative inputs to readiness.

## 10. Constraints

- Legal transitions are open → approved/rejected/deferred/stale, deferred → open, and open → superseded by a new packet when revision is prepared.
- Approved and rejected records remain historical even when current readiness becomes `needs-review` or `blocked`.
- Archival changes visibility only; it cannot erase evidence, change policy, or rewrite approval history.
- A readiness change must identify the cause, affected versions, branch, and next valid action.

## 11. Domain Model

- **Commitment lifecycle:** exact adopted version plus immutable decision history and status transitions.
- **Readiness assessment:** current action eligibility under dependencies, availability, policy, evidence, and external conditions.
- **Supersession:** a new packet/version replaces a prior decision question or candidate without deleting its history.
- **Impact notice:** a durable pointer from changed input to affected committed/current dependent work.

## 12. Requirements

### ADDED: Historical lifecycle

Approval, rejection, deferral, revision, reopening, archival, and supersession MUST preserve attributable historical records. A new revision MUST use a new packet/version and MUST NOT mutate the prior decision basis.

### ADDED: Current readiness is separate

A commitment MUST retain its historical disposition while readiness is reassessed against current exact dependencies, artifact availability, E03 permissions, and recorded blocking conditions. A stale or blocked commitment MUST NOT authorize new dependent work until revalidated.

### ADDED: Explicit lifecycle actions

Reopen, archive, supersede, and readiness actions MUST validate current object/version state, be idempotent where command IDs apply, and report a concrete status and reason without silently removing an existing commitment.

## 13. Non-Functional Requirements

- **Integrity:** lifecycle transitions and readiness causes are append-only and version-linked.
- **Concurrency:** actions use expected versions and unique command IDs so concurrent updates cannot lose history.
- **Safety:** current policy and missing evidence can block readiness even when a historical approval exists.
- **Operability:** inspection distinguishes current, stale, blocked, archived, and superseded records.

## 14. Contracts

### New contracts

- `reviseDecisionPacket(handle, input)` creates a new packet/version linked to the prior packet and rationale.
- `reopenDecision(handle, request)` reopens a deferred/currently eligible question only when referenced versions remain current.
- `archiveDecision(handle, request)` archives a packet or candidate without deleting history.
- `supersedeDecision(handle, request)` records replacement linkage and preserves the prior record.
- `assessReadiness(handle, request)` evaluates specified branch/action conditions and records `ready`, `needs-review`, or `blocked` with causes.
- `listCommitmentHistory(handle, filters?)` and `listReadiness(handle, filters?)` expose safe historical records.

### Existing contracts preserved

- E02 exact dependency traversal, impact records, artifact availability, branch snapshots, and history.
- E03 current permission/revocation semantics; a historical owner approval cannot restore withdrawn permission.
- E04s01 packet and explicit owner disposition contracts.

## 15. Reason for Depth and Zoom-Out

This story modifies existing `dependency-store.ts` and adds readiness persistence. The dependency store's purpose is direct/transitive dependency traversal and durable impact notices; callers include branch promotion, shared-source correction, and future readiness assessment; its contract is complete deterministic traversal without mutating snapshots. `artifact-store.ts` owns immutable bytes/metadata and is called by inspection and recovery; its contract is explicit availability/corruption and no content rewrite. Reusing these contracts avoids a second dependency graph or mutable approval flag. No new abstraction is added beyond a small readiness record because readiness has distinct lifecycle and audit semantics.

## 16. Implementation Steps

1. Add commitment lifecycle/readiness types and additive history tables with migration compatibility → verify: `npm run build && node --test --test-name-pattern='e04s02.*(schema|lifecycle|readiness)' dist/test/*.test.js`
2. Implement revision, reopen, archive, and supersession transitions with immutable linkage and command idempotency → verify: `npm run build && node --test --test-name-pattern='e04s02.*(revis|reopen|archiv|supersed)' dist/test/*.test.js`
3. Assess current readiness from exact dependencies, availability, impact notices, and E03 policy status without changing historical commitments → verify: `npm run build && node --test --test-name-pattern='e04s02.*(ready|stale|blocked|dependency|policy|history)' dist/test/*.test.js`
4. Add restart, concurrent-action, inspection, and E01–E03 regression fixtures → verify: `npm run build && npm test && node --test --test-name-pattern='e04s02.*(restart|concurr|inspect|regression)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e04s02-P0-01: Lifecycle history remains complete

```gherkin
Given an approved, rejected, or deferred decision
When it is revised, reopened, archived, or superseded
Then every disposition and transition remains attributable and readable
And the replacement uses a new exact packet/version rather than mutating history
```

### Scenario SC-e04s02-P0-02: Changed dependencies require impact review

```gherkin
Given a committed option with direct and transitive dependencies
When an adopted dependency, availability state, or current policy changes
Then affected readiness becomes needs-review or blocked with a reason
And the historical approval remains reconstructable but cannot authorize stale work
```

### Scenario SC-e04s02-P1-03: Archived and superseded records remain inspectable

```gherkin
Given an archived or superseded packet/version
When the owner inspects project history or attempts new use
Then the old record remains readable with its disposition
And only a current validated candidate can become the active commitment
```

## 18. Verification Script (Step-by-Step)

1. Approve a synthetic exact candidate, then revise it and inspect both packet versions.
2. Exercise deferral/reopen, archive, and supersession transitions; retry commands.
3. Change a dependency and revoke a synthetic permission; assess readiness for affected and unaffected actions.
4. Close/reopen the project and confirm history and readiness causes persist.
5. Run all inherited E01–E03 tests.

## 19. Risks and Mitigations

- **History rewritten by status updates:** use append-only transition rows and immutable packet links.
- **Readiness confused with approval:** return separate fields and test an approved-but-blocked record.
- **Incomplete dependency impact:** reuse E02 transitive traversal and assert direct plus transitive cases.
- **Concurrent lost update:** require branch/record expected versions and duplicate-command tests.

## 20. Traceability

- Scope outcome: R04
- Epic acceptance scenarios: AC-07, AC-08
- Test-plan scenarios: SC-e04s02-P0-01, SC-e04s02-P0-02, SC-e04s02-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — readiness transitions, artifact lifecycle, and impact rules
- Decisions: D-06, D-09, D-15, D-17
