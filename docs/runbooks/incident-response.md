# Operational and Security Incident Response Procedure

ID: incident-response

## 1. Overview

This runbook specifies steps for responding to operational anomalies, suspect access patterns, potential data leakage, or capability bypass attempts.

## 2. Containment and Triage

1. Immediately terminate active specialist sessions:
   - Issue cancellation on running tasks to trigger prompt fencing.
   - Quarantined outputs prevent suspicious candidates from committing into research branches.
2. Revoke active worker capabilities:
   - Call lifecycle revocation mechanisms to invalidate compromised delegation tokens.
3. Isolate the project directory:
   - Ensure permissions prevent unauthorized background processes from accessing `.ganesh/`.

## 3. Investigation and Evidence Gathering

1. Inspect operational health and diagnostics:
   - Run `inspectOperationalHealth` to assess system state.
   - Use `inspectDiagnostics` under owner capability to review the chronological event timeline.
2. Export diagnostic bundle for audit:
   - Execute `exportDiagnostics` to create an isolated, verifiable bundle containing manifest and JSONL event log.
   - Confirm bundle manifest checksums match generated files.
   - Confirm that the export payload contains operations-only telemetry and zero raw research source bytes.

## 4. Remediation and Post-Mortem

1. Rotate any exposed API keys following the Credential Rotation runbook.
2. Apply necessary policy overrides or declassification corrections.
3. File an internal incident report documenting correlation IDs and remediation actions taken.
