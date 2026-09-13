# e15s02 — Backup, Restore, Migrations and Restore Drills

## 1. Identity

- **Story ID:** e15s02
- **Epic:** e15 — Recovery portability and controlled deletion
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want backups, integrity-checked restore into an empty folder, and restore drills that do not replace live current state, so that I can move and rehearse recovery without losing commitments or mixing branches.

## 3. Context

e15s01 defines the directory packet and manifest. e15s03 serializes writable opens. This slice adds local backups, restore into an empty root, restore drills, and an owner-facing `migrateWithBackup` wrapper around the existing `migrateSchema` function.

## 4. Problem

Copying a live `.ganesh` folder while writes continue, or swapping a backup over the current project as a drill, would either restore a torn snapshot or silently change current branch references. Existing `migrateSchema` must keep migrating a v0 marker for released tests.

## 5. Goal

Write a consistent backup of database plus referenced artifacts, restore only after hash and schema checks pass, keep drills off the live current cursor, and record a backup before owner-requested migration without breaking `migrateSchema(root)`.

## 6. Non-Goals

- Packet export layout; e15s01 already owns it. This story consumes it.
- Crash/lock primitives; e15s03 already owns them.
- Deletion of backups as a retention command; e15s04 owns unlinking app-managed backups during deletion.
- Stale-restore versus withdrawn grants; e15s05 owns monotonic revocation on restore-replace.
- Overwriting a non-empty live project as the default restore path; restore-replace is e15s05.
- Cloud backup vendors, zip packages and TUI commands.

## 7. Stakeholders

- Owners rehearsing recovery and moving a project to a new empty folder.
- e15s05 restore-replace, which reuses restore validation then applies revocation rules.
- Released `tests/policy/permissions.test.ts`, which calls `migrateSchema(fixture.root)`.

## 8. Dependencies

- e15s01 packet/manifest types and `createE15Schema`.
- e15s03 write lock (restore materialize is a writable open of the destination).
- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` scenarios SC-e15s02-P0-01 through SC-e15s02-P1-04.
- Node.js 24 standard library only.

## 9. Assumptions

- `backupProject` writes under `.ganesh/backups/<backupId>/` inside the source project, using the same manifest shape as a packet with kind `backup`.
- `restoreProject(..., { mode: "materialize" })` requires an empty destination root (no `.ganesh`). It creates a new project from the packet or backup.
- `restoreProject(..., { mode: "drill" })` restores into a disposable directory, verifies hashes, reports success/failure, and does not change the source project's current snapshot or commitments.
- `migrateWithBackup(handle, capability, commandId)` calls `backupProject` then existing `migrateSchema`. Bare `migrateSchema` remains for additive DDL and the v0→v1 released test.
- Restore holds the destination write lock; it does not steal the source lock except when source and destination are the same root, which materialize forbids.

## 10. Constraints

- Restore MUST verify every included hash before marking the destination `ready`. Mismatch MUST leave the destination absent or not-ready and MUST NOT copy a torn database into place as current.
- Restore drills MUST snapshot live `currentSnapshotId` and commitment ids and leave them unchanged.
- Command/payload idempotency applies to backup and restore commands.
- Owner identity and `protectCanonicalWrite` are required.
- `src/workspace/**` MUST NOT change.

## 11. Domain Model

- **Backup snapshot:** application-controlled consistent copy of database plus referenced artifacts with hashes and schema version.
- **Restore drill:** verification of a snapshot that is not a live current-state replacement.
- **Materialize restore:** creation of a new project root from a packet or backup.

## 12. Requirements

### ADDED: Consistent local backup

`backupProject` MUST copy `project.sqlite` and referenced artifact files that still exist, write a kind-`backup` manifest with hashes and schema version, and record a backup row.

### ADDED: Integrity-gated materialize restore

`restoreProject` in materialize mode MUST validate hashes and schema, then produce a ready project at an empty destination whose permitted history and resolvable permitted evidence match the snapshot.

### ADDED: Non-replacing restore drill

Drill mode MUST not mutate the live project's current branch references, history append-only cursor, or commitment rows.

### ADDED: Owner migration records a backup first

`migrateWithBackup` MUST persist a backup snapshot before calling `migrateSchema`. Existing `migrateSchema(root)` without the wrapper MUST still migrate a v0 marker to version 1.

## 13. Non-Functional Requirements

- **Integrity:** hash mismatch rejects restore.
- **Isolation:** drills do not move the live cursor (AC-08).
- **Compatibility:** permissions migration test keeps passing.
- **Durability:** backup and restore use the e15s03 write lock on writable roots.
- **Honesty:** a successful drill is not a claim that off-site media is durable.

## 14. Contracts

### New contracts

- `backupProject(handle, capability, request): BackupSnapshot`
- `restoreProject(capability, request): RestoreResult` with `mode: "drill" | "materialize"`
- `migrateWithBackup(handle, capability, commandId): { backupId, fromVersion, toVersion }`

### Existing contracts preserved

- `migrateSchema(target)` signature and v0→v1 behavior.
- e15s01 `inspectProjectPacket` may inspect backup directories that share the manifest shape.
- Branch expected-version mutations remain append-only after restore.

## 15. Reason for Depth and Zoom-Out

`src/portability/backup-store.ts` and `restore-store.ts` split write-of-snapshot from read-into-destination because they have different roots and lock holders. No backup-service interface is introduced.

Planned tests: `tests/portability/backup-restore.test.ts`.

## 16. Implementation Steps

1. Add backup snapshots with hashes and schema version, and materialize restore that rejects mismatch → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s02.*(backup|hash|integrity|mismatch|materialize)' dist/tests/*/*.test.js`
2. Add restore drills that leave live current snapshots and commitments unchanged → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s02.*(drill|live current|commitment)' dist/tests/*/*.test.js`
3. Add migrateWithBackup that records a backup first while bare migrateSchema still migrates v0 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s02.*(migrateWithBackup|migrateSchema|v0)' dist/tests/*/*.test.js`
4. Prove restored branches stay isolated and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node scripts/require-test-match.mjs 'e15s02.*(branch|isolat|AC-08|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e15s02-P0-01: Materialize restore checks integrity first

```gherkin
Given a valid backup or project packet
When restoreProject materializes into an empty destination
Then hashes and schema are verified before the destination is ready
And permitted commitments and evidence locators resolve
And a flipped hash rejects restore and leaves the destination not ready
```

### Scenario SC-e15s02-P0-02: Drill does not replace live current

```gherkin
Given a live project with a known currentSnapshotId and commitment id
When restoreProject runs in drill mode
Then the live currentSnapshotId and commitment id are unchanged
And the drill report still includes the integrity result
```

### Scenario SC-e15s02-P0-03: migrateWithBackup records a backup first

```gherkin
Given a ready project and a v0-marker fixture
When migrateWithBackup runs on the ready project
Then a backup snapshot exists before migrateSchema returns
And migrateSchema(root) on the v0 fixture still reports fromVersion 0 toVersion 1
```

### Scenario SC-e15s02-P1-04: Restored branches stay isolated

```gherkin
Given a packet with two research branches
When it is materialized
Then modifying or inspecting one branch does not change the other branch's current references
```

## 18. Verification Script (Step-by-Step)

1. Export or backup a project that has two branches and one commitment.
2. Materialize into a new temp root; reopen and list commitments.
3. Flip one artifact byte in a copy of the packet and confirm restore reject.
4. Run a drill against the live project and compare currentSnapshotId.
5. Run migrateWithBackup; confirm a backup row.
6. Replay the v0 migrateSchema fixture from permissions tests.
7. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Drill that writes live:** compare currentSnapshotId in the same test.
- **Breaking v0 migrate:** keep `migrateSchema` untouched in signature; wrapper only.
- **Torn copy:** write backup to a temp directory then rename into `.ganesh/backups/<id>`.

## 20. Traceability

- Scope outcome: R15
- Epic acceptance scenarios: AC-08, AC-20 (restore and backup)
- Test scenarios: SC-e15s02-P0-01, SC-e15s02-P0-02, SC-e15s02-P0-03, SC-e15s02-P1-04
- Domain contracts: tech-stack backup snapshot concurrency row; D-15
- Language: Project snapshot, Human commitment
