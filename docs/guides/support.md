# Support Procedures and Operational Runbooks

This guide provides support procedures and indexes the operational incident runbooks provided with Ganesh.

## Getting Support

For local troubleshooting, consult the relevant operational runbook below or run preflight diagnostics:

```bash
npm run preflight
```

## Operational Incident Runbooks

Ganesh includes seven operational runbooks located under `docs/runbooks/`:

1. **Provider Outage (`provider-outage`):** Procedures for responding to upstream AI provider degradations, rate limiting, and outages. See [docs/runbooks/provider-outage.md](file:///home/box/dev/ganesh/docs/runbooks/provider-outage.md).
2. **Credential Rotation (`credential-rotation`):** Procedures for safely updating API keys and credentials without leaking tokens. See [docs/runbooks/credential-rotation.md](file:///home/box/dev/ganesh/docs/runbooks/credential-rotation.md).
3. **Disk Exhaustion (`disk-exhaustion`):** Procedures for handling disk space warnings, cleaning temporary caches, and maintaining database integrity. See [docs/runbooks/disk-exhaustion.md](file:///home/box/dev/ganesh/docs/runbooks/disk-exhaustion.md).
4. **Recovery (`recovery`):** Procedures for crash recovery, WAL replay, and store reconciliation. See [docs/runbooks/recovery.md](file:///home/box/dev/ganesh/docs/runbooks/recovery.md).
5. **Incident Response (`incident-response`):** Step-by-step guidance for isolating and reporting operational anomalies. See [docs/runbooks/incident-response.md](file:///home/box/dev/ganesh/docs/runbooks/incident-response.md).
6. **Vulnerability Reporting (`vulnerability-reporting`):** Secure procedures for reporting identified vulnerabilities and security defects. See [docs/runbooks/vulnerability-reporting.md](file:///home/box/dev/ganesh/docs/runbooks/vulnerability-reporting.md).
7. **Performance Budgets (`performance-budgets`):** Thresholds and monitoring procedures for memory, CPU, and disk usage budgets. See [docs/runbooks/performance-budgets.md](file:///home/box/dev/ganesh/docs/runbooks/performance-budgets.md).
