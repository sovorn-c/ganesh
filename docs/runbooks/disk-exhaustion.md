# Disk Exhaustion Handling Procedure

ID: disk-exhaustion

## 1. Overview

This runbook provides guidance for handling low disk space, storage quota limits, and unexpected ENOSPC conditions in the Ganesh workspace.

## 2. Storage Boundaries and Cap Behavior

1. Diagnostic event cap:
   - Ganesh caps operational diagnostic events at 10,000 entries.
   - Health checks warn at 80% capacity (8,000 events) and block new event recordings at 10,000 events with `resource-limit`.
2. E15 Crash and ENOSPC behavior:
   - Under ENOSPC (e.g. disk-full), SQLite atomic transactions roll back cleanly to prevent database corruption.
   - The workspace write lock protects against half-written states.

## 3. Immediate Remediations

1. Purge older diagnostic events:
   - Project owners can execute `purgeDiagnosticEvents` with a date filter (`olderThan`) or correlation ID.
   - Purge removes event rows from the local database to restore recording capacity.
   - Note on honesty: Purge deletes local diagnostic rows only; it does not claim OS-level physical secure erase, nor does it recall bundles already exported off the machine.
2. Controlled deletion of derived content:
   - Use E15 controlled deletion to prune cached documents and intermediate artifacts.
   - Raw research source files, decision commitments, and tombstone records are strictly preserved.
3. Move or compress diagnostic export bundles:
   - Archive or relocate exported diagnostic bundles from local staging paths to external storage.

## 4. Verification

1. Run `inspectOperationalHealth` to verify that `diagnostic-store` returns ready status and store size is acceptable.
2. Verify that raw research artifacts and historical commitments remain accessible and uncorrupted.
