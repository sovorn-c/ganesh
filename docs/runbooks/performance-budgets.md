# Operational Performance Budgets

ID: performance-budgets

## 1. Overview

This document defines performance budgets and resource constraints for Ganesh operational components. These budgets are validated through automated integration tests on synthetic large-project fixtures.

## 2. Resource Limits

| Resource | Boundary | Behavior on Limit |
|---|---|---|
| Diagnostic Event Store | 10,000 events | `recordDiagnostic` refuses new events with `resource-limit` error |
| Health Warning Threshold | 8,000 events (80%) | `inspectOperationalHealth` emits `warning` status on diagnostic-store check |
| Provider Retries | Maximum 2 retries | Enforced by `maxRetries` bound in admission check |
| Provider Rate Limits | Project minimum interval | Injected interval wait between successive provider attempts |

## 3. Large Fixture Exercise Budget

| Fixture Scale | Target Operations | Latency Budget (Node.js 24) | File Read Constraint |
|---|---|---|---|
| 500 Artifacts, 200 Runs, 5,000 Diagnostic Events | `inspectDiagnostics` + `exportDiagnostics` | <= 10,000 ms (10.0 s) | 0 artifact file bytes read |

## 4. Architectural Rules for Performance

1. No Artifact Content Loading in Diagnostics:
   - Diagnostic operations query the SQLite metadata table (`diagnostic_events`) directly.
   - Neither inspection nor bundle export reads artifact file contents from disk.
2. Chunked Export Processing:
   - JSONL event serialization streams row data without buffering excessive memory.
   - Atomic staging directory and checksum generation execute with file-based streaming.
3. Exercise Oracle vs SLA:
   - These numbers serve as regression oracles in the automated test suite, not published service level agreements.
