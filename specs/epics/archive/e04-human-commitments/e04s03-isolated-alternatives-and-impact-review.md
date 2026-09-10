# e04s03 — Isolated Alternatives and Transitive Impact Review

## 1. Identity

- **Story ID:** e04s03
- **Epic:** e04 — Human commitments and research alternatives
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want to explore and explicitly adopt alternatives in independent research branches so that experimentation does not change my current commitment and adoption shows all affected dependent work.

## 3. Context

E02 already stores branch snapshots, expected revisions, explicit promotion, and transitive dependency impact records. E04 must connect those durable alternatives to decision packets and commitments without turning a Pi conversation branch into research state or mutating unrelated branches.

## 4. Problem

Without a separate commitment-aware adoption path, merely editing an alternative could invalidate the current plan, while a promotion could silently change dependent artifacts without a review notice. Concurrent or repeated adoption can also produce duplicate or stale decisions.

## 5. Goal

Keep alternative branch changes isolated, require a reviewed exact-version adoption action, and record direct/transitive impact and readiness consequences in the destination branch while preserving source and historical snapshots.

## 6. Non-Goals

- Creating the initial decision packet or owner authority; e04s01 owns it.
- General commitment lifecycle and readiness persistence; e04s02 owns it.
- Provider work, analysis execution, automatic merge of contradictory research, or Pi conversation navigation.
- External authorization or scholarly certification.

## 7. Stakeholders

- Researchers comparing questions, theories, designs, or protocols.
- Owners of dependent artifacts that need impact review after adoption.
- E02 branch/promotion and dependency stores; later e09/e12 consumers.

## 8. Dependencies

- e04s01 exact packet and owner disposition contracts.
- e04s02 commitment/readiness and historical transition contracts.
- E02 `branch-store.ts`, `promotion-store.ts`, `dependency-store.ts`, and history.
- `specs/docs/05-decisions-and-acceptance.md` AC-08.
- `specs/tech-architecture/e04-TEST_PLAN_LATEST.md` scenarios SC-e04s03-P0-01 through SC-e04s03-P1-04.

## 9. Assumptions

- A research branch is a durable project branch, not a Pi conversation branch.
- Promotion is an explicit owner action over selected exact logical IDs and a reviewed packet.
- Existing E02 promotion semantics are the low-level branch reference primitive; e04 adds commitment/readiness linkage.
- Shared-source corrections remain visible in all branches without rewriting branch snapshots.

## 10. Constraints

- Candidate exploration cannot mutate another branch's current references or commitments.
- Adoption validates source packet currency, destination expected revision, exact selected versions, and current policy/readiness.
- Direct and transitive dependent versions in the destination branch receive impact notices and readiness review markers.
- Same-payload retries are idempotent; stale concurrent adoption is rejected without partial promotion.

## 11. Domain Model

- **Alternative branch:** independent named snapshot with candidate references and comparison context.
- **Branch adoption:** explicit reviewed selection of source branch versions into a destination branch.
- **Impact review:** durable assessment marker for direct/transitive dependents whose inputs changed.
- **Destination commitment:** the destination branch's exact current commitment remains historical until a new owner decision adopts the promoted candidate.

## 12. Requirements

### ADDED: Branch isolation

A candidate change in one research branch MUST leave other branch snapshots, current commitments, and history unchanged until an explicit reviewed adoption action occurs. Conversation navigation MUST have no state mutation authority.

### ADDED: Explicit adoption and impact

Adoption MUST bind an exact packet, source branch snapshot, destination branch revision, selected versions, and owner command. It MUST record direct and transitive dependent impact in the destination branch and require affected readiness review.

### ADDED: Concurrency and history

Concurrent or repeated adoption MUST use expected-version and unique-command checks. Stale adoption MUST produce no partial branch or commitment change; source and destination snapshots and the adoption decision remain inspectable.

## 13. Non-Functional Requirements

- **Isolation:** branch-local exploration cannot leak into unrelated current references.
- **Integrity:** adoption records exact before/after version IDs, packet, branches, revisions, and impacts.
- **Concurrency:** one coordinating transaction prevents duplicate or stale adoption.
- **Research integrity:** impact review identifies consequences; it does not automatically reject or silently merge alternatives.

## 14. Contracts

### New or extended contracts

- `adoptBranchAlternative(handle, request)` validates a reviewed packet and promotes selected exact versions with commitment/readiness linkage.
- `listAlternativeImpact(handle, branchId?)` returns direct/transitive impact notices and review status.
- `compareBranchReferences(handle, sourceBranchId, destinationBranchId)` returns exact differences without mutation.
- Extend `promoteBranch` integration so e04 adoption retains E02 result semantics and records owner decision/history atomically.

### Existing contracts preserved

- E02 branch snapshots, expected-version promotion, dependency traversal, shared-source correction, and history.
- E04s01 owner action and e04s02 readiness/history contracts.
- E03 current policy across branches; selecting an old snapshot cannot restore a revoked permission.

## 15. Reason for Depth and Zoom-Out

This story modifies `src/promotion-store.ts` and `src/dependency-store.ts`. The promotion store's purpose is explicit branch-reference promotion with expected destination revisions and history; callers are branch tests and future commitment adoption; its contract is atomic selected-reference change with no hidden merge. The dependency store's purpose is deterministic transitive traversal and impact notices; callers include promotion and shared-source correction; its contract is branch-scoped, idempotent impact recording. A narrow adoption adapter is justified to compose existing branch mutation with e04 packet/readiness records without duplicating branch state.

## 16. Implementation Steps

1. Add alternative comparison/adoption types and impact/readiness linkage fields with additive migration → verify: `npm run build && node --test --test-name-pattern='e04s03.*(schema|type|compare|impact)' dist/test/*.test.js`
2. Prove branch-local exploration and exact candidate comparison without mutating unrelated snapshots or commitments → verify: `npm run build && node --test --test-name-pattern='e04s03.*(branch|isolat|explor|snapshot)' dist/test/*.test.js`
3. Implement reviewed adoption over existing promotion semantics with expected revisions, exact packet binding, transitive impact, and idempotency → verify: `npm run build && node --test --test-name-pattern='e04s03.*(adopt|promot|transitiv|stale|duplicate)' dist/test/*.test.js`
4. Add concurrent/shared-source regression fixtures and preserve all E02/E03 behavior → verify: `npm run build && npm test && node --test --test-name-pattern='e04s03.*(concurr|shared|regression|policy)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e04s03-P0-01: Alternatives remain isolated

```gherkin
Given a committed destination branch and two candidate alternatives
When one alternative branch is edited without adoption
Then its snapshot changes independently
And the destination commitment and the other branch remain unchanged
```

### Scenario SC-e04s03-P0-02: Adoption records transitive impact

```gherkin
Given a reviewed packet selecting an exact alternative version with direct and transitive dependents
When the owner adopts it into a destination branch
Then the destination records the exact promotion and impact notices
And affected dependents require readiness/impact review before new use
```

### Scenario SC-e04s03-P0-03: Repeated or concurrent adoption is safe

```gherkin
Given two adoption actions based on the same destination revision
When both or a duplicate retry is submitted
Then only one valid adoption can change the destination
And stale/changed-payload actions create no partial state
```

### Scenario SC-e04s03-P1-04: Exploration does not invalidate readiness

```gherkin
Given a current commitment whose own dependencies and policy remain current
When an unrelated alternative is explored but not adopted
Then the current commitment remains ready
And no impact notice is created for the exploration alone
```

## 18. Verification Script (Step-by-Step)

1. Create a main branch, two alternatives, exact candidate versions, and a dependent chain.
2. Edit each alternative and inspect all branch snapshots and current commitment references.
3. Compare branches, adopt one reviewed selection, and inspect destination history, changed references, and transitive impacts.
4. Repeat with stale and duplicate commands and record the no-partial-state result.
5. Issue a shared-source correction and confirm notices reach each branch using the source.
6. Run all inherited E02/E03 tests.

## 19. Risks and Mitigations

- **Exploration mutates main:** use snapshot/reference assertions before and after candidate edits.
- **Promotion bypasses packet/readiness:** require exact packet and current checks inside the adoption transaction.
- **Impact only marks direct dependents:** test a dependency chain and reuse E02 traversal.
- **Old branch restores permission:** invoke E03 policy after promotion and assert current revocation still denies.

## 20. Traceability

- Scope outcome: R04
- Epic acceptance scenarios: AC-08
- Test-plan scenarios: SC-e04s03-P0-01, SC-e04s03-P0-02, SC-e04s03-P0-03, SC-e04s03-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` — branch isolation, impact, readiness, and concurrency
- Decisions: D-06, D-09, D-15, D-17
