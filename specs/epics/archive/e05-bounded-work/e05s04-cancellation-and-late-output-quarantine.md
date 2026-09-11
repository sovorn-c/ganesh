# e05s04 — Cancellation Fences Dispatch and Quarantines Late Outputs

## 1. Identity

- **Story ID:** e05s04
- **Epic:** e05 — Bounded autonomous work and specialist coordination
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want cancel to stop new dispatch and current acceptance immediately so that a late specialist result cannot become live work after I have stopped it.

## 3. Context

E03 already quarantines candidates when an acceptance checkpoint fails and blocks acceptance of a cancelled lifecycle operation. This slice adds owner contract/run cancel that fences queued sibling dispatch, keeps late successful port results non-current, and records best-effort remote stop.

## 4. Problem

Remote sessions continue after local cancel. If a late payload is accepted because the lifecycle row is still `running`, cancelled work becomes current. If only the active run is cancelled, queued runs on the same contract still dispatch.

## 5. Goal

Owner cancel fences new dispatch under the contract and current acceptance for affected runs immediately, quarantines late outputs through restart, and records remote-stop success or failure without lifting the local fence.

## 6. Non-Goals

- Budget arithmetic and spend caps; e05s03 owns these.
- Provider retry/backoff and destination fallback; e05s05 owns these.
- Deletion, backup and export of quarantined bytes; E15 owns retention mechanics beyond inspectable quarantine.
- Terminal cancel chrome; E14 owns presentation.

## 7. Stakeholders

- Owners stopping in-flight work.
- Recovery reviewers proving AC-17: no silent current late result.
- E03 lifecycle gates that remain the checkpoint/quarantine store.

## 8. Dependencies

- e05s01 run/lifecycle mapping and e05s03 reservations that must remain spent after cancel.
- E03 `updateLifecycleOperationStatus`, `fenceRevokedOperation`, `acceptCandidate` and `listQuarantinedOutputs`.
- `specs/docs/05-decisions-and-acceptance.md` AC-17.
- `specs/tech-architecture/e05-TEST_PLAN_LATEST.md` SC-e05s04-P0-01 through SC-e05s04-P1-03.

## 9. Assumptions

- Cancel is an owner command (`cancelRun` or `cancelContract`) using `OwnerCapability`.
- Local fence is the safety property. Remote session abort is best-effort and can fail.
- Quarantine retains the late payload as non-current. E15 later decides deletion/export; E05 MUST NOT auto-delete quarantined artifacts.
- Spent budget is not refunded by cancel. Reserved unused remainder for a cancelled in-flight run is released only after reconcile, never by treating unknown usage as zero.

## 10. Constraints

- After cancel, `dispatchRun` / `queueRun` for that contract version MUST deny before a session starts.
- `acceptSubmission` for a cancelled or fenced run MUST quarantine and MUST NOT mark the candidate current.
- Close/reopen MUST still present the fence and quarantined late output as non-current.
- Remote cancel failure is stored as a diagnostic on the run. It MUST NOT reopen dispatch or acceptance.
- Pause is distinct from cancel: `pauseRun` moves a run to waiting-for-human without fencing the whole contract; this story still implements cancel as the hard stop.

## 11. Domain Model

- **Cancel fence:** durable contract- or run-level block on dispatch and acceptance.
- **Late output:** a session or provider result that arrives after cancel or after the run is no longer current.
- **Quarantine:** non-current retained candidate pending current-policy review; not a commitment and not silent deletion.
- **Best-effort remote stop:** recorded attempt to abort the SessionPort; local policy does not wait on its success.

## 12. Requirements

### ADDED: Immediate dispatch and acceptance fence

`cancelContract` / `cancelRun` MUST mark affected queued and running work cancelled or fenced in the same transaction that records the owner command. Subsequent dispatch and current-result acceptance MUST deny.

### ADDED: Late outputs stay quarantined (AC-17)

A submission that arrives after cancel, or after crash/reopen of a cancelled run, MUST be quarantined. Restart MUST NOT promote it to a current candidate.

### ADDED: Remote stop is best-effort

The runtime MUST ask the SessionPort to cancel. A failed or unimplemented remote stop MUST be recorded while the local fence remains in force.

## 13. Non-Functional Requirements

- **Safety:** cancel is effective even if the port hangs.
- **Durability:** fences and quarantine survive reopen.
- **Honesty:** remote-stop failure is visible.
- **Compatibility:** E03 quarantine table and released tests remain passing.

## 14. Contracts

### New contracts

- `cancelRun(handle, ownerCapability, request): CancelResult`
- `cancelContract(handle, ownerCapability, request): CancelResult`
- `pauseRun(handle, ownerCapability, request): RunRecord`
- `inspectQuarantine(handle, runId): readonly QuarantinedOutput[]`

### Existing contracts preserved

- E03 `acceptCandidate` already quarantines on failed acceptance checkpoints; E05 MUST route late submissions through that path after setting cancelled/fenced.
- Budget inspect from e05s03 still reports spent amounts after cancel.

## 15. Reason for Depth and Zoom-Out

Cancel orchestration lives in `work-runtime.ts` because it must update work rows, lifecycle status and the session port together. It calls existing lifecycle fence/quarantine APIs rather than inventing a second quarantine store. A message-queue outbox is rejected; a durable run row plus port call is enough.

## 16. Implementation Steps

1. Owner cancel fences queued dispatch and in-flight acceptance on the contract or run → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s04.*(cancel|fence|dispatch|acceptance)' dist/tests/*/*.test.js`
2. Late submissions after cancel and after reopen stay quarantined and non-current → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s04.*(late|quarantine|reopen|current)' dist/tests/*/*.test.js`
3. Record best-effort remote stop success and failure without lifting the local fence → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s04.*(remote|best-effort|session stop)' dist/tests/*/*.test.js`
4. Prove spent budget is not reset, pause is distinct from cancel, and released regressions pass with no new security findings in affected paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e05s04.*(budget|pause|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e05s04-P0-01: Cancel fences dispatch and acceptance

```gherkin
Given queued and running runs under an authorized contract
When the owner cancels the contract
Then new dispatch is denied
And in-flight acceptance is denied
```

### Scenario SC-e05s04-P0-02: Late output cannot become current (AC-17)

```gherkin
Given a cancelled run whose session later returns a candidate
When the project is reopened and acceptance is attempted
Then the output is quarantined
And it is not the current candidate
```

### Scenario SC-e05s04-P1-03: Remote stop failure stays fenced

```gherkin
Given a SessionPort whose cancel fails
When the owner cancels the run
Then the failure is recorded
And local dispatch and acceptance remain fenced
```

## 18. Verification Script (Step-by-Step)

1. Queue two runs; start one fake session; cancel the contract; attempt another dispatch.
2. Deliver a late candidate from the fake port; inspect quarantine and current-candidate absence.
3. Close/reopen; retry acceptance; confirm still quarantined.
4. Use a port whose cancel throws; confirm diagnostic plus fence.
5. Run the inherited suite under Node.js 24.

## 19. Risks and Mitigations

- **TOCTOU accept after cancel:** acceptance re-reads cancelled/fenced status inside the same transaction as candidate registration.
- **Sibling queued runs:** cancelContract iterates remaining non-terminal runs, not only the active session.
- **Budget refund confusion:** tests assert spent remains; unused reservation release requires reconcile, not cancel.

## 20. Traceability

- Scope outcome: R05
- Epic acceptance scenarios: AC-17
- Test scenarios: SC-e05s04-P0-01, SC-e05s04-P0-02, SC-e05s04-P1-03
- Domain contracts: tech-stack cancellation row; DESIGN_PLAN cancellation fences
