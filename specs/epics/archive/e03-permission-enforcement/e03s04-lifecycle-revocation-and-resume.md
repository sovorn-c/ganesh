# e03s04 — Lifecycle Revocation and Resume Enforcement

## 1. Identity

- **Story ID:** e03s04
- **Epic:** e03 — Enforced data-use and capability controls
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want current permissions checked at every work boundary so that revoking a permission stops future dispatch, disclosure, resume, and result acceptance even when an older branch or run still exists.

## 3. Context

E03s01 records policy, e03s02 gates disclosures, and e03s03 protects capabilities. This story connects those contracts to the work lifecycle: dispatch, external operation, resume, cancellation, and acceptance. Historical records remain inspectable, while current policy controls new effects.

## 4. Problem

Checking authorization only when work starts permits stale or revoked operations to disclose data later. A process restart, in-flight provider response, or old branch snapshot must not restore a withdrawn permission or let a late result become current.

## 5. Goal

Implement lifecycle gates that re-evaluate current policy before each protected effect, fence revoked in-flight work, quarantine late outputs, and require fresh evaluation on resume and acceptance.

## 6. Non-Goals

- Classification and permission record schema; e03s01 owns it.
- Representation-specific disclosure inheritance; e03s02 owns it.
- Capability construction and Pi resource loading; e03s03 owns it.
- Human commitment semantics and packet adoption; e04 owns them.
- Provider retry/budget accounting and full cancellation implementation; e05 owns them.
- Backup/restore and deletion propagation; e15 owns them.

## 7. Stakeholders

- Project owners revoking or changing data-use permissions.
- Coordinators dispatching work and accepting candidate outputs.
- Provider adapters and local tools performing external operations.
- Recovery/resume paths and historical branch inspectors.

## 8. Dependencies

- e03s01 policy evaluator, e03s02 disclosure gateway, and e03s03 capability boundary.
- E02 branch/history/recovery stores and transaction/expected-version contracts.
- `specs/tech-architecture/tech-stack.md` readiness and work transition rules.
- `specs/docs/05-decisions-and-acceptance.md` AC-10, AC-15, and AC-17.
- `specs/tech-architecture/e03-TEST_PLAN_LATEST.md`, scenarios SC-e03s04-P0-01 through SC-e03s04-P1-03.

## 9. Assumptions

- Each lifecycle action has a durable operation identity and exact input snapshot.
- Current policy is queried at the point of effect, not copied permanently into a queued run.
- A revoked operation can prevent future local and external effects; an already transmitted external disclosure is reported as not recallable.
- Late outputs can be retained as non-current candidates without becoming canonical state.

## 10. Constraints

- Policy checks must occur in order with dispatch, each disclosure/external operation, resume, and acceptance.
- Revocation applies across historical branches and cannot be undone by selecting an old snapshot.
- A denied or fenced operation has an explicit status and remediation; it does not silently retry elsewhere.
- Acceptance must validate current input versions, policy, capability, and operation identity before any canonical write.
- Durable history distinguishes queued, running, blocked, cancelled, quarantined, accepted, and rejected outcomes.

## 11. Domain Model

- **Lifecycle operation:** a versioned dispatch, external effect, resume, or acceptance attempt with an input snapshot.
- **Policy checkpoint:** a current evaluation attached to an operation boundary.
- **Revocation fence:** durable state preventing new effects and current-result acceptance for a revoked operation.
- **Quarantined output:** a late or cancelled result retained outside current canonical references.

## 12. Requirements

### ADDED: Current policy is checked at every protected boundary

The controller MUST evaluate current policy at dispatch, each external operation, resume, and result acceptance. An operation MUST be blocked when required permission, classification, capability, input, or execution protection is unavailable.

### ADDED: Revocation fences in-flight and late effects

A permission withdrawal MUST prevent further active operations and current-result acceptance across all branches. Outputs that arrive after cancellation, revocation, or supersession MUST remain non-current and be explicitly quarantined or discarded according to retention policy.

### ADDED: Resume cannot restore stale authority

A resumed operation MUST recheck current policy, input currency, capability, and remaining authorization. Selecting an older branch or restarting a process MUST not restore withdrawn permission.

## 13. Non-Functional Requirements

- **Security:** no lifecycle transition can bypass current policy by replay, branch selection, or provider timing.
- **Consistency:** policy checkpoint and protected effect have an explicit transaction/order contract.
- **Recovery:** blocked and quarantined states survive restart and remain inspectable.
- **Auditability:** every checkpoint records operation identity, policy version/status, and redacted reason.

## 14. Contracts

### New contracts

- `checkLifecyclePolicy(project, operation, phase)` returns a current checkpoint for `dispatch`, `external`, `resume`, or `acceptance`.
- `fenceRevokedOperation(project, operation, reason)` records a durable revocation fence.
- `acceptCandidate(project, operation, candidate)` rejects stale, revoked, cancelled, or unauthorized results.
- `resumeOperation(project, operation)` rechecks all current prerequisites before queueing new effects.

### Existing contracts preserved

- E02 branch/history/recovery records and no-rollback behavior.
- e03s01/e03s02/e03s03 policy, disclosure, and capability contracts.
- E05's future provider/budget/cancellation boundary receives explicit lifecycle results rather than being granted authority here.

## 15. Reason for Depth and Zoom-Out

This story modifies the existing recovery, branch/history, and project-write boundaries. Callers are dispatch, provider/local effect, resume, cancellation, and candidate acceptance flows. Their contracts require current-policy ordering, durable fences, and no stale canonical writes. One lifecycle gate is necessary because separate checks would create time-of-check/time-of-use gaps.

## 16. Implementation Steps

1. Define durable lifecycle operation, policy checkpoint, revocation fence, and quarantined-output records → verify: `npm run build && node --test --test-name-pattern='e03s04.*(operation|checkpoint|fence|quarantine)' dist/test/*.test.js`
2. Gate dispatch and every external effect with current policy, capability, input, and execution-protection checks → verify: `npm run build && node --test --test-name-pattern='e03s04.*(dispatch|external|effect|current.policy)' dist/test/*.test.js`
3. Implement revocation/cancellation fencing and non-current late-result handling across branches → verify: `npm run build && node --test --test-name-pattern='e03s04.*(revoke|cancel|late|branch|accept)' dist/test/*.test.js`
4. Recheck policy on resume and candidate acceptance, preserving durable redacted checkpoints through restart → verify: `npm run build && node --test --test-name-pattern='e03s04.*(resume|stale|restart|acceptance|checkpoint)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e03s04-P0-01: Every protected boundary checks current policy

```gherkin
Given a queued operation has a current input snapshot and permission
When policy is withdrawn before dispatch, an external effect, resume, or acceptance
Then the affected boundary is denied with a durable reason
And no new protected effect or canonical result is written
```

### Scenario SC-e03s04-P0-02: In-flight revocation fences late output

```gherkin
Given an operation is running when its source permission is withdrawn
When a provider or local worker returns a result
Then further effects are fenced and the result is quarantined or discarded as non-current
And historical operation and branch records remain inspectable
```

### Scenario SC-e03s04-P1-03: Resume requires fresh authority

```gherkin
Given a blocked or interrupted operation is resumed from an old branch snapshot
When the controller evaluates the resume request
Then current policy, input currency, capability, and authorization are rechecked
And selecting the old snapshot cannot restore withdrawn permission
```

## 18. Verification Script (Step-by-Step)

1. Start a synthetic operation with a permitted source and record its operation snapshot.
2. Exercise dispatch and one external-effect checkpoint, then withdraw permission.
3. Attempt another effect, resume, and candidate acceptance; confirm all are blocked.
4. Return a late worker result and inspect its quarantine status.
5. Reopen the project and confirm fences, checkpoints, and historical branch data remain intact.

## 19. Risks and Mitigations

- **Time-of-check/time-of-use gap:** order checkpoint and effect under the same operation/fence contract and test revocation barriers.
- **Late result promotion:** require acceptance to query current policy and operation state again.
- **Branch rollback:** use current policy independent of historical snapshots and retain E02 no-rollback behavior.
- **Recovery loss:** persist fences and redacted checkpoints before reporting blocked status.
- **Scope creep into E05:** keep budgets/provider retry/remote cancellation mechanics as explicit integration contracts for e05.

## 20. Traceability

- Scope outcome: R03
- Epic acceptance scenarios: AC-09, AC-10, AC-15, AC-17
- Test-plan scenarios: SC-e03s04-P0-01, SC-e03s04-P0-02, SC-e03s04-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — readiness/work transitions and global invariants 3–6
- Decisions: D-05, D-07, D-09, D-16, D-18
