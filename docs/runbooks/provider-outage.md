# Provider Outage Procedure

ID: provider-outage

## 1. Overview

This runbook describes operational procedures when an external specialist provider (e.g. LLM or retrieval API) experiences an outage, degraded response rates, or connection timeouts.

## 2. Detection and Diagnosis

1. Run operational health inspection to determine current service status:
   - Check diagnostic timelines with `inspectDiagnostics` filtering by `kind = 'provider'`.
   - Inspect preflight and health indicators via `inspectOperationalHealth`.
2. Inspect recent failure codes:
   - Look for `provider-unavailable`, `provider-timeout`, or rate limiting errors.
   - Note correlation IDs associated with failed work runs.

## 3. Immediate Mitigation

1. Verify retry limits and backoff:
   - Ganesh bounds provider retries automatically to `maxRetries` (maximum 2 retries).
   - Injected minimum intervals prevent rate hammering against degraded endpoints.
2. Cancel stalled runs:
   - If a provider run hangs or exceeds time budgets, issue a cancellation.
   - Cancellation fences the run immediately; late candidate output is quarantined.
3. Fallback policy:
   - Never fall back from local-only material to an unapproved remote provider.
   - Ensure local isolation rules and destination policies are respected.

## 4. Recovery and Verification

1. Once the provider reports recovery, test endpoint connectivity with placeholder test credentials:
   - `export PROVIDER_API_KEY="[PROVIDER_API_KEY]"`
   - `export PROVIDER_ENDPOINT="[PROVIDER_ENDPOINT]"`
2. Re-admit specialist tasks using standard contract limits.
3. Verify that failed remote queries are not recorded as completed literature searches.
