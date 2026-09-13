# Test Design: e15-recovery-portability

## 1. Risk Matrix and Scenarios

| Scenario ID | Behavior description | Risk | Test level | Target file/module |
|---|---|---:|---|---|
| SC-e15s01-P0-01 | Owner export writes a directory packet with schema version, per-file hashes and reconstructable permitted commitments/evidence locators after the source project is closed. Identical command retry resumes; payload conflict rejects. | P0 | Integration | `tests/portability/project-export.test.ts`, `src/portability/export-store.ts` |
| SC-e15s01-P0-02 | Forged, wrong-owner, worker and missing-capability callers cannot export a project packet. | P0 | Adversarial integration | `tests/portability/project-export.test.ts`, `src/portability/export-store.ts` |
| SC-e15s01-P0-03 | Restricted or local-only bytes are omitted from a non-local destination packet with an explicit omission notice; hashes cover included files only; omitted paths are not present on disk. | P0 | Adversarial integration | `tests/portability/project-export.test.ts`, `src/policy/disclosure-gateway.ts` |
| SC-e15s01-P1-04 | Export evaluates current disclosure policy at command time; a withdrawn grant cannot be exported as permitted remote content even if an older snapshot still names the artifact. | P1 | Integration | `tests/portability/project-export.test.ts`, `src/policy/policy-store.ts` |
| SC-e15s03-P0-01 | Injected crash before/after artifact or decision registration reopens to a complete prior or complete new state with no half-approved current reference (AC-17). | P0 | Recovery integration | `tests/portability/crash-concurrency.test.ts`, `src/branches/recovery.ts` |
| SC-e15s03-P0-02 | Injected disk-full (`ENOSPC` via `failAt: disk-full`) leaves no new current reference, no complete artifact version, and an inspectable failed checkpoint. | P0 | Recovery integration | `tests/portability/crash-concurrency.test.ts`, `src/artifacts/artifact-store.ts` |
| SC-e15s03-P0-03 | A second live process cannot open the same project writable; same-process reentry and read-only opens still succeed; lock steal is allowed only when the recorded pid is dead. | P0 | Integration | `tests/portability/crash-concurrency.test.ts`, `src/project/project-lock.ts` |
| SC-e15s03-P1-04 | Bit-flipped artifact bytes report `corrupt`; pending lifecycle operations remain pending and are not marked complete by `recoverProject`. | P1 | Recovery integration | `tests/portability/crash-concurrency.test.ts`, `src/lifecycle/lifecycle-gate.ts` |
| SC-e15s02-P0-01 | Restore into an empty destination validates hashes and schema, then reconstructs permitted history and resolvable permitted evidence. Hash mismatch rejects and leaves the destination not ready. | P0 | Integration | `tests/portability/backup-restore.test.ts`, `src/portability/restore-store.ts` |
| SC-e15s02-P0-02 | A restore drill verifies a backup or packet without changing the live project's current branch references or commitments (AC-08). | P0 | Integration | `tests/portability/backup-restore.test.ts`, `src/portability/restore-store.ts` |
| SC-e15s02-P0-03 | `migrateWithBackup` records a backup snapshot before `migrateSchema`; existing `migrateSchema(root)` without that wrapper still migrates a v0 marker for released tests. | P0 | Integration | `tests/portability/backup-restore.test.ts`, `src/persistence/schema.ts` |
| SC-e15s02-P1-04 | Restored branch snapshots stay isolated; promoting or inspecting one restored branch does not mutate the other (AC-08). | P1 | Contract | `tests/portability/backup-restore.test.ts`, `src/branches/branch-store.ts` |
| SC-e15s04-P0-01 | Authorized deletion unlinks application-controlled original, derived, cache and app-backup bytes, writes an evidence tombstone, and keeps inspectable metadata without the prohibited content. | P0 | Integration | `tests/portability/controlled-deletion.test.ts`, `src/portability/deletion-store.ts` |
| SC-e15s04-P0-02 | After deletion, materially dependent claims require revalidation for new committed use, readiness is blocked, and a work run that needs the removed input cannot dispatch. | P0 | Integration | `tests/portability/controlled-deletion.test.ts`, `src/decisions/readiness-store.ts` |
| SC-e15s04-P0-03 | Deletion reports application-controlled coverage and an explicit not-recalled notice for prior external disclosures; it does not claim provider recall. | P0 | Contract | `tests/portability/controlled-deletion.test.ts`, `src/portability/deletion-store.ts` |
| SC-e15s04-P1-04 | Workers and forged owners cannot delete; permitted non-sensitive decision history rows remain after deletion. | P1 | Adversarial integration | `tests/portability/project-export.test.ts`, `src/decisions/commitment-store.ts` |
| SC-e15s05-P0-01 | Restore-replace of a packet taken while a grant was active cannot set a live withdrawn or expired grant back to active. | P0 | Adversarial integration | `tests/portability/stale-restore-grants.test.ts`, `src/policy/policy-store.ts` |
| SC-e15s05-P0-02 | After that restore, `requestDisclosure` for the withdrawn use still denies; a new remote export is not permitted from the restored bytes. | P0 | Adversarial integration | `tests/portability/stale-restore-grants.test.ts`, `src/policy/disclosure-gateway.ts` |
| SC-e15s05-P0-03 | Withdrawal remains effective across restored research branches; inspecting an old snapshot cannot resurrect the grant (AC-08). | P0 | Integration | `tests/portability/stale-restore-grants.test.ts`, `src/branches/branch-store.ts` |
| SC-e15s05-P1-04 | Prior external disclosure rows survive restore/deletion as not-recalled notices rather than successful recall. | P1 | Contract | `tests/portability/stale-restore-grants.test.ts`, `src/portability/deletion-store.ts` |

## 2. Test-Level Strategy

- Use contract tests for omission notices, not-recalled disclosures, monotonic revocation and restore-drill non-mutation.
- Use real temporary SQLite projects with existing `projectFixture`, E03 classify/grant/withdraw helpers, E04 commitment fixtures where needed, and E05 lifecycle pending rows.
- Use adversarial integration tests for capability/project isolation, local-only omission, and withdrawn-grant restore.
- Inject crash/disk-full through `failAt`; inject corruption by flipping bytes on disk after a successful register. Do not fill the host disk. Do not spawn a second Ganesh CLI binary; simulate a foreign pid with a lockfile whose pid is alive (`process.pid` of a short-lived child) or dead.
- Do not add end-to-end terminal tests. E14 stays frozen.
- Deterministic tests prove software honesty for synthetic fixtures; they do not prove backup media durability, cloud-vendor deletion, or production readiness.

## 3. Fixture Architecture and Isolation

- Add behavior-owned helpers to `tests/support/portability-fixtures.ts`; keep reusable names free of epic IDs.
- Packet and backup directories live under the test temp root, never under the user's home or `~/.pi`.
- Foreign-pid lock tests spawn `process.argv[0] -e "setInterval(()=>{}, 1000)"` or write a lockfile with that child's pid, then kill it in `finally`.
- Same-process reentry uses two `openProject` handles from one Node process.
- Restore-drill tests snapshot live `currentSnapshotId` and commitment ids before the drill and compare after.
- Close and remove every temporary project in `finally`. Tests do not read global Pi state, call `InteractiveMode`, open viewers, or contact the network.

## 4. Dependency and Supply-Chain Verification

No new production package is proposed.

| Purpose | Package | Tag | Required adoption evidence |
|---|---|---|---|
| Runtime, SQLite, tests | Existing Node.js 24, `node:sqlite`, `node:fs`, `node:crypto`, `node:test`, E01–E08/E14 stack | [OK] | Reuse current lockfile; `npm audit --omit=dev` during implementation review |
| zip / tar / archiver | none | [OK] | Reject archive packages; a project packet is a directory with `ganesh-project-packet.json` |
| Cloud backup SDK | none | [OK] | Application-controlled backups are local directories under the project store |
| File-lock package | none | [OK] | Pid-reentrant exclusive create of `.ganesh/write.lock` with dead-pid steal; no `proper-lockfile` |

## 5. Non-Functional Verification

| NFR | Requirement | Verification command |
|---|---|---|
| Integrity | Packet/backup hashes match included files; mismatch rejects restore. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15.*(hash|integrity|mismatch)' dist/tests/*/*.test.js` |
| Authority | Forged, wrong-owner and worker callers cannot export, restore, backup or delete. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15.*(capability|forged|worker|wrong-owner|denied)' dist/tests/*/*.test.js` |
| Privacy | Restricted bytes are omitted with a notice; local-only material does not land in a remote-destination packet. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s01.*(omission|restricted|local-only|remote)' dist/tests/*/*.test.js` |
| Durability | Crash, disk-full and corruption leave no partial approval; pending lifecycle ops stay pending. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s03.*(crash|disk-full|corrupt|pending)' dist/tests/*/*.test.js` |
| Concurrency | Foreign live pid is blocked; same-process reentry works; dead pid can be stolen. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s03.*(lock|pid|concurrent|reentry)' dist/tests/*/*.test.js` |
| Revocation honesty | Stale restore cannot reactivate withdrawn grants; external disclosures are not recalled. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s05.*(withdrawn|expired|recall|disclosure)' dist/tests/*/*.test.js` |
| Compatibility | Released E01–E08 and E14 behavior remains passing. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && npm run preflight` |

All commands run in the foreground with Node.js 24. Tests use Node's built-in `node:test`; no new test framework is proposed.

## 6. Out of Scope

- Built-in OCR, writing-format exporters, supervisor review packets and TUI commands.
- Cloud backup vendors, zip/tar packages and a second database.
- Filling the physical disk; `failAt: disk-full` is the oracle.
- Expert-human evaluation, remote CI, publishing, deployment and production-readiness claims.
- E16 diagnostic exports and E18 uninstall.

## 7. Release Evidence

E15 implementation review requires all 20 scenarios, all inherited E01–E08 and E14 tests, explicit AC-08/AC-17/AC-20 coverage, and inspection of omission, lock, monotonic revocation and not-recalled disclosure behavior. Deterministic tests establish software behavior for synthetic fixtures; they do not prove media durability, provider-side deletion or production readiness of the complete Ganesh release.
