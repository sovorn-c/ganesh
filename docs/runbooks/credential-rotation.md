# Credential Rotation Procedure

ID: credential-rotation

## 1. Overview

This runbook documents the required steps to rotate provider API keys, tokens, or other authentication credentials without leaking secrets or disrupting project integrity.

## 2. Pre-Rotation Checklist

1. Identify all active sessions and work runs relying on the current credential.
2. Confirm that previous keys are not hardcoded in project sources, artifacts, or commit history.
3. Ensure operational diagnostics continue redaction: Ganesh strips tokens, passwords, and authorization headers before persistence.

## 3. Rotation Steps

1. Provision the new credential in the upstream provider management portal.
2. Update the environment variable or configuration file using placeholders:
   - Old key: `[OLD_API_KEY]`
   - New key: `[NEW_API_KEY]`
3. Terminate running specialist sessions that held the previous token to ensure clean session re-admission.
4. Revoke the old credential (`[OLD_API_KEY]`) in the provider portal.

## 4. Post-Rotation Verification

1. Run environment preflight (`preflight`) to confirm configuration syntax and permissions.
2. Execute a test specialist run to verify that the new key authenticates successfully.
3. Inspect diagnostic logs to confirm that no unredacted credential material appeared during rotation.
