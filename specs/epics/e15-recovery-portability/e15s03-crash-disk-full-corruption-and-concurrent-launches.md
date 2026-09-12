# e15s03 — Crash, Disk-Full, Corruption and Concurrent-Launch Hardening

## 1. Identity

- **Story ID:** e15s03
- **Epic:** e15 — Recovery portability and controlled deletion
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 7
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want crash, disk-full, corruption and a second Ganesh process to fail visibly, so that restart never invents a half-approved state or silently changes canonical current references.

## 3. Context

E02 already recovers temporary artifact files and distinguishes schema status. E03/E05 already keep lifecycle operations and refuse to complete cancelled work. This slice hardens the remaining local-write and multi-process gaps that e02s03 explicitly left to e15, without owning backup/restore or deletion.

## 4. Problem

Two writable processes, an ENOSPC during finalize, or a bit-flipped artifact can look like success if recovery only deletes `*.incomplete` files. Completing a pending remote lifecycle row during local recover would invent a finished search or run.

## 5. Goal

Inject crash and disk-full at known write boundaries, report corruption without rewriting history, admit same-process handles, deny a second live process, and leave pending lifecycle operations pending until current-policy resume.

## 6. Non-Goals

- Project packet export; e15s01 owns that and may already be implemented first.
- Backup, restore and restore drills; e15s02 owns those and depends on this lock.
- Deletion and tombstones; e15s04 owns those.
- Filling the physical disk, cloud lock managers, or `flock` packages.
- TUI commands; E14 stays unmodified.
- Changing `ownerAction` or completing provider calls inside `recoverProject`.

## 7. Stakeholders

- Owners who reopen after a crash or launch a second terminal.
- e15s02 restore and e15s04 deletion, which must serialize against the write lock.
- Reviewers checking AC-17 and the tech-stack concurrent-process row.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E02 `recoverProject`, `failAt` hooks, `ContentStatus`, recovery checkpoints.
- E03/E05 `lifecycle_operations` pending/running rows and resume fences.
- `specs/IMPACT_LATEST.md` shared-module blast-radius assessment.
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` scenarios SC-e15s03-P0-01 through SC-e15s03-P1-04.
- Node.js 24 `node:fs` only for the lockfile; this story adds no package.

## 9. Assumptions

- Inter-process exclusion is a pid-reentrant exclusive create of `.ganesh/write.lock` containing the holder pid. Same `process.pid` may open additional writable handles. A different live pid is blocked. A dead pid may be stolen after a kill(0)-style liveness check.
- Read-only opens do not take the write lock.
- `close()` releases the lock when this process holds it and no other same-process writable handle remains.
- Disk-full is injected with `failAt: "disk-full"` raising an error whose code is `ENOSPC`. Tests must not fill the host volume.
- `recoverProject` may open the project while another same-process handle exists; the lock must allow that reentry.

## 10. Constraints

- Writable `createProject` and `openProject` MUST acquire the lock before returning a writable handle.
- A foreign live pid MUST fail writable open with a bounded `project-locked` (or equivalent) code and MUST NOT mutate the database.
- `recoverProject` MUST NOT mark `lifecycle_operations` complete, succeeded, or failed-as-success. Pending stays pending.
- Corruption MUST surface as `contentStatus: "corrupt"` from `inspectArtifactVersion` without rewriting the stored hash.
- Diagnostics contain bounded codes and paths inside the project root, never file contents.

## 11. Domain Model

- **Write lock:** exclusive, pid-reentrant filesystem lease for canonical mutation of one project.
- **Failed checkpoint:** recovery_checkpoints row with status `failed` for disk-full or interrupted writes.
- **Uncertain external operation:** a lifecycle row that is queued/running/waiting and must be resumed under current policy, not completed by local recover.

## 12. Requirements

### MODIFIED: Artifact write-failure injection and writable project open

**Before:** `ArtifactVersionInput.failAt` accepted `before-finalize`, `after-finalize-before-register`, `after-commit` and `after-register`. `openProject` allowed multiple processes to open the same writable project. `recoverProject` removed temporary files and retained the last complete database state.

**After:** `failAt` also accepts `disk-full`, which aborts with `ENOSPC` and leaves no new current reference. Writable open and create acquire a pid-reentrant exclusive lockfile; a foreign live pid is blocked. `recoverProject` still removes temporaries, reports corrupt/missing artifacts without rewriting history, and does not complete pending lifecycle operations.

### ADDED: Crash injection stays complete-or-absent

Interrupted registration and decision transactions MUST reopen to the previous complete state or the new complete state. Half-registered files MUST not become current.

### ADDED: Concurrent-launch exclusion

A second live process MUST not obtain a writable handle. Same-process reentry and read-only inspection MUST continue to work, including `recoverProject(root)` while a test fixture handle is open.

### ADDED: Uncertain external operations stay pending

`recoverProject` MUST list pending lifecycle operations in its result detail or an additive field and MUST leave their status unchanged.

## 13. Non-Functional Requirements

- **Recovery:** crash and disk-full tests inspect both SQLite and artifact files.
- **Safety:** foreign processes cannot mutate; dead pid steal is explicit.
- **Honesty:** corruption is reported, not repaired by inventing bytes.
- **Compatibility:** released recovery tests that keep a handle open during `recoverProject` still pass.
- **Observability:** lock and ENOSPC errors name the project path and remediation, not secrets.

## 14. Contracts

### New contracts

- `acquireProjectWriteLock(projectRoot): ProjectLock` / release on last same-process writable close.
- `failAt: "disk-full"` on `registerArtifactVersion`.
- Additive `uncertainOperationIds` (or equivalent) on `RecoveryResult` listing pending lifecycle ids.

### Existing contracts preserved

- Temporary-file cleanup, schema status, read-only snapshot inspection.
- Lifecycle resume still rechecks current policy in E03/E05.
- `PROJECT_SCHEMA_VERSION` stays 1.

## 15. Reason for Depth and Zoom-Out

`src/project/project-lock.ts` owns lockfile liveness. `recoverProject` stays in `src/branches/recovery.ts` because callers already import it. A lock module is justified so `project-store` does not grow a second process-table; no lock manager hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`. Planned tests: `tests/portability/crash-concurrency.test.ts`.

## 16. Implementation Steps

1. Inject crash boundaries and prove reopen exposes only complete states → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s03.*(crash|half|complete|AC-17)' dist/tests/*/*.test.js`
2. Add `failAt: disk-full` ENOSPC abort without a new current reference → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s03.*(disk-full|ENOSPC)' dist/tests/*/*.test.js`
3. Add pid-reentrant write lock, foreign-pid deny, dead-pid steal and same-process reentry, and prove no new security findings in affected lock paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s03.*(lock|pid|concurrent|reentry)' dist/tests/*/*.test.js`
4. Report corrupt artifacts, keep pending lifecycle operations pending, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e15s03.*(corrupt|pending|lifecycle|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e15s03-P0-01: Crash recovers to a complete state

```gherkin
Given an artifact or decision write interrupted before or after its commit boundary
When the project is reopened and recoverProject runs
Then the visible current state is the previous complete state or the new complete state
And no half-registered reference is treated as current
```

### Scenario SC-e15s03-P0-02: Disk-full does not commit a new current

```gherkin
Given registerArtifactVersion is called with failAt disk-full
When the write aborts with ENOSPC
Then no new artifact version is current
And a failed recovery checkpoint is inspectable
```

### Scenario SC-e15s03-P0-03: Foreign live pid is blocked

```gherkin
Given a writable handle held by this process
When a lockfile for a different live pid is present or a child process holds the lock
Then a second-process writable open is denied
And a same-process second openProject still succeeds
```

### Scenario SC-e15s03-P1-04: Corruption and pending ops stay honest

```gherkin
Given a registered artifact whose bytes were flipped and a pending lifecycle operation
When recoverProject runs
Then inspectArtifactVersion reports corrupt
And the lifecycle row remains pending
```

## 18. Verification Script (Step-by-Step)

1. Reuse E02 failAt hooks for before/after registration and reopen.
2. Call `failAt: disk-full` and inspect checkpoints plus artifact lists.
3. Spawn a child that holds a lockfile pid, attempt writable open, then kill the child.
4. Open two handles in one process and run `recoverProject(root)`.
5. Flip one artifact byte, recover, inspect `corrupt`.
6. Insert a pending lifecycle row, recover, confirm it is still pending.
7. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Lock breaks fixtures:** require same-pid reentry; add a regression named with `reentry`.
- **False ENOSPC tests:** inject via failAt, never fill the volume.
- **Silent repair:** never rewrite hashes to match flipped bytes.
- **Invented completion:** recover is local filesystem/SQL only.

## 20. Traceability

- Scope outcome: R15
- Epic acceptance scenarios: AC-17; concurrency row in tech-stack.md
- Test scenarios: SC-e15s03-P0-01, SC-e15s03-P0-02, SC-e15s03-P0-03, SC-e15s03-P1-04
- Domain contracts: `recoverProject`, `ContentStatus`, lifecycle pending
- Language: Recovery checkpoint, Readiness as distinct from recovery
