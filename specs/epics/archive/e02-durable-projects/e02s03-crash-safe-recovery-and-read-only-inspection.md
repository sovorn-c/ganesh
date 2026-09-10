# e02s03 — Crash-Safe Recovery, Schema Compatibility, and Read-Only Project Inspection

## 1. Identity

- **Story ID:** e02s03
- **Epic:** e02 — Durable versioned research projects
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 5
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want interrupted local work and schema changes to fail visibly and reopen safely so that session navigation or a storage problem cannot roll my project back or create a half-approved state.

## 3. Context

E02s01 and e02s02 establish durable records and safe branch mutations. This story closes the epic's restart boundary: it records schema compatibility, recovery checkpoints, monotonic history rules, and read-only behavior when the project cannot be written. Full migrations, backup/restore, and controlled deletion remain e15 work, but e02 must leave enough explicit metadata for that work to extend safely.

## 4. Problem

A process can stop between file and database operations, a project can be opened by a newer application, or a user can navigate an old Pi session and accidentally make an old snapshot current. Treating these cases as successful opens or silent rollbacks would destroy trust in durable research state.

## 5. Goal

Make interruption and unsupported storage conditions explicit and recoverable. Restart must preserve the last complete state, schema checks must distinguish supported and future versions, and read-only/offline inspection must not mutate current references or resurrect an old snapshot.

## 6. Non-Goals

- Full e15 migration catalog, export/restore, backup integrity, disk-full drills, or deletion propagation.
- Human approval, permission revocation, provider operations, or analysis execution.
- A general event-sourcing framework or automatic rollback of committed research history.

## 7. Stakeholders

- Researchers reopening a project after a crash or interrupted command.
- e15 implementers extending migrations, backup, restore, and deletion.
- Reviewers checking that old session navigation cannot mutate canonical state.

## 8. Dependencies

- e02s01's project/artifact atomicity and schema marker.
- e02s02's branch expected-version and append-only history contracts.
- Node.js 24 standard filesystem and SQLite transaction APIs.
- The recovery and concurrency obligations in `specs/tech-architecture/tech-stack.md` and AC-17.

## 9. Assumptions

- A transaction either commits a complete logical mutation or remains absent; uncertain external work is not treated as committed by this local store.
- A project opened with a newer unsupported schema can be inspected only in a mode that cannot mutate it.
- Session navigation supplies an old snapshot for inspection, not a privileged state-restoration command.
- Schema markers and recovery records are durable metadata, not a claim that all future migrations are already implemented.

## 10. Constraints

- Recovery must choose the last complete committed state, never a partially written file or unverified database row.
- Current references and history are monotonic within a branch; opening an old snapshot cannot make it current without an explicit versioned mutation and current expected-version check.
- Unsupported schema and write-permission failures must return actionable statuses and preserve read access where safe.
- Temporary files and incomplete registrations must not be mistaken for artifact versions.
- State recovery must not delete or rewrite historical records merely to make the current view convenient.

## 11. Domain Model

- **Schema version:** integer/version identifier governing the database contract and supported migrations.
- **Recovery checkpoint:** durable indication of an operation boundary and its finalized inputs/results.
- **Read-only project handle:** inspection capability that cannot execute canonical mutations.
- **Current-state cursor:** current branch reference resolved from durable state; session navigation is not a mutation.
- **Recovery status:** ready, read-only, blocked, or needs migration with an actionable reason.

## 12. Requirements

### ADDED: Interrupted-operation recovery

After interruption before or after artifact/database registration, reopening MUST yield the prior complete state or the new complete state. It MUST never expose a half-registered reference, incomplete bytes, or an unverified successful operation.

### ADDED: Schema compatibility boundary

The project MUST record its schema version and explicitly handle supported versions, migration-required versions, and unknown future versions. Unknown future versions MUST not be mutated by the current binary.

### ADDED: Monotonic and read-only inspection

Session navigation and old snapshot inspection MUST NOT roll back canonical current references. When storage is not writable, the project MUST remain readable where safe and MUST report that mutations are blocked rather than writing elsewhere or silently discarding changes.

## 13. Non-Functional Requirements

- **Recovery:** failure boundaries are deterministic and restart tests inspect both SQLite and artifact files.
- **Safety:** future schemas and read-only handles cannot enter mutation paths.
- **Portability:** saved records are inspectable offline without an active Pi session or provider.
- **Observability:** status includes the affected path/operation and a bounded remediation message.
- **Forward compatibility:** e15 can add migrations and restore metadata without changing the meaning of existing history.

## 14. Contracts

### New contracts

- `openProject` returns a capability/status that distinguishes writable, read-only, migration-required, and blocked states.
- `recoverProject(projectRoot)` reconciles finalized artifact files and SQLite references without inventing completion.
- `inspectSnapshot(project, snapshotId)` is read-only and cannot alter current branch references.
- `schemaStatus(project)` reports supported, migration-required, or unknown-future schema with the allowed operations.

### Existing contracts preserved

- E02s01's atomic artifact visibility and explicit content statuses.
- E02s02's expected-version mutations, append-only history, and branch isolation.
- The architecture's rule that conversation/session navigation is not research-state rollback.

## 15. Reason for Depth and Zoom-Out

Recovery is a cross-cutting caller boundary for project open, branch mutation, import, export, and later migration commands. A small explicit recovery/status module is justified because every caller must make the same distinction between inspectable state and mutation eligibility; a generic rollback abstraction would hide authority and create a second state machine.

## 16. Implementation Steps

1. Add schema status and recovery checkpoint records with supported, migration-required, unknown-future, and blocked outcomes → verify: `npm run build && node --test --test-name-pattern='e02s03.*schema|migration.*required|future.*schema' dist/test/*.test.js`
2. Implement deterministic recovery for interruption boundaries and cleanup/reconciliation of temporary or incomplete artifact files → verify: `npm run build && node --test --test-name-pattern='e02s03.*recover|interrupted|half.*register|temporary.*artifact' dist/test/*.test.js`
3. Add read-only/offline project handles and prove old snapshot inspection cannot change current references → verify: `npm run build && node --test --test-name-pattern='e02s03.*read-only|offline.*inspect|snapshot.*rollback' dist/test/*.test.js`
4. Document recovery statuses, remediation, and e15 handoff boundaries without claiming full migration or restore support → verify: `npm run lint && npm run typecheck`

## 17. Acceptance Criteria

### Scenario SC-e02s03-P0-01: Interrupted registration recovers to a complete state

```gherkin
Given an artifact/database operation is interrupted before or after its commit boundary
When the project is reopened
Then recovery exposes either the previous complete state or the new complete state
And no half-registered reference or incomplete artifact is treated as current
```

### Scenario SC-e02s03-P1-02: Schema compatibility is explicit

```gherkin
Given a project with a supported, migration-required, or unknown-future schema version
When the current application opens it
Then it reports the schema status and allowed remediation
And an unknown-future schema cannot be mutated by the current binary
```

### Scenario SC-e02s03-P1-03: Inspection cannot roll back canonical state

```gherkin
Given a current branch and an older saved snapshot
When a user navigates to inspect the older snapshot or opens the project read-only/offline
Then the canonical current reference and append-only history remain unchanged
And any blocked mutation reports the reason without silently writing elsewhere
```

## 18. Verification Script (Step-by-Step)

1. Create a project with two complete versions and a current branch reference.
2. Inject interruption at each local registration boundary and reopen the project.
3. Confirm only complete states are visible and temporary/incomplete files are reported or removed safely.
4. Open fixtures for supported, migration-required, and unknown-future schema versions; confirm status and mutation capability.
5. Open an old snapshot in read-only/offline mode and confirm current references and history do not change.
6. Simulate a write restriction and confirm the project remains inspectable with actionable remediation.

## 19. Risks and Mitigations

- **False recovery success:** require a finalized-byte/hash check before accepting a reference.
- **Future-schema corruption:** make unknown versions read-only/blocked and test mutation attempts.
- **Session rollback:** keep snapshot inspection separate from current-reference mutation and require expected versions for any later change.
- **Filesystem variance:** inject write failures in addition to platform permission fixtures.
- **Scope leakage into e15:** document the handoff and leave full migration/export/restore behavior unimplemented here.

## 20. Traceability

- Scope outcome: R02
- Epic acceptance scenarios: AC-08, AC-17
- Test-plan scenarios: SC-e02s03-P0-01, SC-e02s03-P1-02, SC-e02s03-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — recovery, schema, history, and current-reference invariants
- Decisions: D-09, D-15, ADR 0001, ADR 0002
