# Disaster Recovery and Crash Recovery Procedure

ID: recovery

## 1. Overview

This runbook covers procedures for recovering a Ganesh workspace after an abrupt crash, power loss, kernel panic, or filesystem corruption.

## 2. Crash Recovery Diagnostics

1. Check for stale write locks:
   - Check `.ganesh/write.lock`. If held by a dead process PID, opening the project in writable mode cleans the stale lock safely.
   - `inspectOperationalHealth` checks write lock status and reports whether it is free, active, or stale.
2. Check SQLite database integrity:
   - Run `PRAGMA integrity_check` on `.ganesh/project.sqlite`.
   - Verify schema version is at `PROJECT_SCHEMA_VERSION` (version 1).

## 3. Restore from Backup

1. In the event of unrecoverable database corruption:
   - Locate the most recent valid backup directory or export bundle created via E15 backup commands.
   - Run `restoreProject` with the backup source path and target project destination.
2. Verify restore integrity:
   - Check file sha256 checksums recorded in the backup manifest.
   - Verify that restored capabilities and withdrawn grants conform to current security policy (stale restore cannot reinstate withdrawn permissions).

## 4. Post-Recovery Validation

1. Re-open project with `openProject` and verify current branch and commit history.
2. Confirm that operational diagnostics record normally and all research artifacts match their expected hashes.
