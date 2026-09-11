# e05s01 — Authorized Contract Admits One Least-Privilege Specialist Run

## 1. Identity

- **Story ID:** e05s01
- **Epic:** e05 — Bounded autonomous work and specialist coordination
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 8
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a project owner, I want an exact authorized work contract to admit one least-privilege specialist run so that approved work proceeds without another delegation prompt and still cannot mint a human commitment.

## 3. Context

E03 already enforces current policy at lifecycle dispatch, external, resume and acceptance. E04 already records human commitments separately from candidates. This tracer adds work contracts, standing permissions, runs, snapshots and budget reservation so a specialist can execute once under those existing gates.

## 4. Problem

Without a versioned contract and run, specialist work either requires repeated owner prompts or silently inherits conversation-wide access and an unbounded budget. A successful model reply must not become a commitment, and contract-time permission must not replace current policy.

## 5. Goal

Authorize an exact contract version (owner action or matching standing permission), reserve finite token/call/time, dispatch one specialist with a least-privilege snapshot, register a versioned candidate plus diagnostics, and leave E04 commitments untouched.

## 6. Non-Goals

- Five-role coordination, disagreements and reviewer loops; e05s02 owns these.
- Concurrent over-admission, spend caps and unknown-price guarantees; e05s03 owns these.
- Contract-level cancel fences and late-output quarantine policy; e05s04 owns these.
- Provider timeout/retry, destination fallback and session rebind; e05s05 owns these.
- Scholarly competencies, terminal UX, local analysis execution, export/deletion.

## 7. Stakeholders

- Owners authorizing bounded work without repeated continue prompts.
- Specialist workers that must see only assigned input versions.
- E03 policy/lifecycle gates that remain authoritative at every checkpoint.
- E04 commitment consumers that must ignore run success.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E03 `checkLifecyclePolicy`, fences, `acceptCandidate` and owner/worker capabilities.
- E04 `disposePacket` remaining the only human-commitment path.
- E02 artifact registration and additive schema-v1 feature tables.
- `specs/IMPACT_LATEST.md` and `specs/tech-architecture/e05-TEST_PLAN_LATEST.md` SC-e05s01-P0-01 through SC-e05s01-P1-04.
- Existing `@earendil-works/pi-coding-agent@0.85.1`; this story adds no package. Tests inject a SessionPort fake.

## 9. Assumptions

- Roles are session configurations, not always-running processes. This story uses the Ganesh Supervisor role as the tracer specialist.
- Scholarly skill quality is out of scope; the specialist returns structured candidate bytes supplied by the injected port.
- Standing permission authorizes a defined class of work within recorded conditions and remaining limits; each dispatch still uses current policy.
- `PROJECT_SCHEMA_VERSION` stays 1. Missing E05 tables on a read-only v1 project yield `work-schema-unavailable`.

## 10. Constraints

- Owner-only `authorizeContract` and `grantStandingPermission` require a trusted `OwnerCapability`. Forged actor fields and worker capabilities deny.
- `queueRun` / `dispatchRun` require a matching owner capability or a worker capability with `work:queue-run` scoped to the project; workers never receive owner operations.
- Assigned snapshots list exact artifact version IDs. `readAssignedInput` denies any other version, conversation transcript or cross-project path.
- Reserve token/call/time in the same transaction that records the run and lifecycle operation, before the session port starts.
- Unique `commandId` plus payload hash: identical retry resumes; changed payload rejects; pending runs never claim success.
- Register candidates through E02. Do not call `disposePacket`. Diagnostics are bounded codes and counts, never credentials or unassigned bytes.

## 11. Domain Model

- **Work contract:** versioned objective, scope, role, inputs, finite limits, destination/purpose, execution mode and authorization basis.
- **Standing permission:** owner-granted continuing authorization for a defined class of work; not blanket approval and not a cached policy decision.
- **Run:** one execution attempt under one authorized contract version and one input snapshot.
- **Input snapshot:** the exact assigned versions the specialist may read.
- **Budget reservation:** token, call and time amounts held against the contract before dispatch.
- **Candidate output:** a new artifact version plus diagnostics; not a committed research artifact.

## 12. Requirements

### MODIFIED: Ready-project feature schema initialization

**Before:** writable ready-project open idempotently ensured only E04 and E06 feature tables while explicit migration ensured E03/E04/E06 tables; schema marker version 1 remained unchanged.

**After:** new-project creation, explicit migration and writable ready-project open also idempotently ensure additive E05 work tables without changing schema marker version 1. Explicit read-only, migration-required and unknown-future opens never mutate schema, and missing E05 tables return a typed unavailable result.

### ADDED: Exact contract and standing permission

`proposeContract` records a proposed version. `authorizeContract` or a matching active standing permission transitions that exact version to authorized. Scope or limit expansion requires a new proposed version.

### ADDED: Least-privilege specialist dispatch

`queueRun` / `dispatchRun` create one run, one lifecycle operation and one assigned snapshot, then call `checkLifecyclePolicy` at dispatch. Policy denial starts no session and spends no budget beyond a released reservation.

### ADDED: Candidate is not a commitment

`acceptSubmission` registers a versioned candidate and diagnostics after a passing acceptance checkpoint. It MUST NOT create or alter an E04 decision or commitment.

### ADDED: Atomic token/call/time reservation

Dispatch MUST reserve remaining token, call and time limits before the session starts. Identical command retry resumes the reserved run after reopen. A payload conflict is rejected.

## 13. Non-Functional Requirements

- **Integrity:** contract, run, reservation and candidate survive close/reopen.
- **Security:** workers cannot approve, write canonical state, read unassigned inputs or access credentials.
- **Privacy:** unclassified and withdrawn inputs cannot be sent to a provider destination.
- **Compatibility:** E01-E04/E06 public APIs, SQLite rows and tests remain unchanged and passing.
- **Performance:** limits are injected configuration; tests use tiny ceilings.

## 14. Contracts

### New contracts

- `proposeContract(handle, capability, request): ContractResult`
- `authorizeContract(handle, ownerCapability, request): ContractResult`
- `grantStandingPermission(handle, ownerCapability, request): StandingPermission`
- `queueRun(handle, capability, request): RunRecord`
- `dispatchRun(handle, capability, runId, sessionPort): RunRecord`
- `readAssignedInput(handle, workerCapability, runId, versionId): AssignedInput`
- `acceptSubmission(handle, capability, submission): CandidateAcceptance`
- `inspectWork(handle, commandId | runId): WorkInspection`

### Existing contracts preserved

- `checkLifecyclePolicy` and `acceptCandidate` remain the policy/quarantine authority.
- `disposePacket` remains the only human-commitment path.
- `createWorkerCapabilities` stays project/operation/path scoped; E05 adds `work:*` operations without granting owner ops.
- `registerArtifactVersion` remains the immutable byte-registration path.

## 15. Reason for Depth and Zoom-Out

`src/work/work-types.ts` owns records; `work-store.ts` owns additive SQLite mapping; `work-runtime.ts` owns authorization, snapshot, reservation and dispatch; `session-adapter.ts` owns the injected port. Separate files are justified because persistence, authority orchestration and the Pi seam have different callers and failure contracts. No workflow engine or plugin registry is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`. Planned tests: `tests/work/work-contracts.test.ts` and helpers in `tests/support/work-fixtures.ts`.

## 16. Implementation Steps

1. Add work-contract/run/snapshot/budget types, exact v1 additive schema initialization paths and atomic retry/recovery coverage → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s01.*(schema|contract|reopen|migration|atomic|retry|recovery)' dist/tests/*/*.test.js`
2. Authorize exact contracts and standing permissions with owner-only capabilities, then dispatch one Supervisor run through current-policy checkpoints → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s01.*(authorize|standing|dispatch|policy|withdraw)' dist/tests/*/*.test.js`
3. Reserve token/call/time before session start, accept a versioned candidate that is not a commitment, and deny unassigned reads → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s01.*(reserv|candidate|commit|snapshot|assigned)' dist/tests/*/*.test.js`
4. Prove forged/worker authority failures, diagnostic redaction and all released regressions with no new security findings in affected paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e05s01.*(capability|forg|redact|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e05s01-P0-01: Authorized run returns a candidate

```gherkin
Given an exact proposed contract with finite token, call and time limits
When the owner authorizes that version or a matching standing permission applies
And one Supervisor run is dispatched with an assigned input snapshot
Then a versioned candidate and diagnostics are registered
And no E04 decision or commitment is created
```

### Scenario SC-e05s01-P0-02: Current policy gates dispatch

```gherkin
Given unclassified, withdrawn, expired or destination-mismatched assigned inputs
When dispatch is attempted
Then the lifecycle dispatch checkpoint denies the run
And no session starts and no successful candidate is recorded
```

### Scenario SC-e05s01-P0-03: Reservation survives retry and reopen

```gherkin
Given a dispatched run with reserved token, call and time
When the same command is retried after close and reopen
Then the same run and remaining budget are resumed
And a changed payload under that command ID is rejected
```

### Scenario SC-e05s01-P1-04: Snapshot isolation (AC-09)

```gherkin
Given a worker capability and an assigned snapshot
When the worker requests an unassigned version, owner approval, credentials or canonical write
Then the operation is denied
And no commitment, credential value or other-project bytes are returned
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project, owner capability, classified authorized input and a finite Supervisor contract.
2. Authorize the contract; dispatch one fake-port run; inspect the candidate artifact.
3. Confirm no commitment exists; close/reopen and resume the same command.
4. Attempt dispatch with withdrawn permission and with a worker requesting an unassigned version.
5. Run all E01-E04/E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Commitment smuggling:** acceptSubmission only registers artifacts; tests assert `listCommitments` stays empty.
- **Cached grants:** always call `checkLifecyclePolicy` at dispatch rather than storing an allow flag on the contract.
- **Partial runs:** reservation, run row and lifecycle operation commit together before the port starts.
- **Capability forgery:** reuse E03 non-serializable owner/worker secrets; reject actor strings.

## 20. Traceability

- Scope outcome: R05
- Epic acceptance scenarios: AC-09, AC-17
- Test scenarios: SC-e05s01-P0-01, SC-e05s01-P0-02, SC-e05s01-P0-03, SC-e05s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` work/execution transitions and invariants 1, 5 and 8
- Architecture: `specs/tech-architecture/DESIGN_PLAN_LATEST.md` focused commands; ADR 0001; `specs/docs/04-system-architecture.md` §§3-4
