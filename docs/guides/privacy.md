# Privacy and Data Governance Guide

Ganesh operates under a strict local-first paradigm to protect sensitive research data, participant privacy, and intellectual property.

## Local Data Containment

- **No Remote Telemetry:** Ganesh transmits zero diagnostic telemetry, analytics, or research content to remote endpoints without explicit, authenticated owner authorization.
- **Project Boundary:** All project data remains strictly within `<project-folder>/.ganesh/`.
- **Granular Permissions:** Data classification and disclosure policies control the flow of text excerpts between research tools and specialist sessions.
- **Declassification Controls:** Sensitive research data must undergo explicit declassification before any permitted external transfer.
- **Redaction in Diagnostics:** Diagnostic logs and health metrics strictly redact sensitive research excerpts, file contents, and credential variables.
