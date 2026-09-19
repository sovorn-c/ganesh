# Local Execution Guide

Ganesh executes bounded analysis tools and data extraction routines locally on the researcher's host environment.

## Execution Modes

Ganesh supports three distinct execution modes configured by the researcher:

1. **`ask` Mode:** Prompt for interactive human confirmation before executing any tool command or script.
2. **`approve` Mode:** Require human review and cryptographic capability approval before running operations that modify workspace state.
3. **`full-access` Mode:** Execute permitted research commands without prompting for individual commands.

## Important Security Notice: Full-Access is Not a Sandbox

The `full-access` execution mode is an explicit local risk choice configured by the project owner. It provides operational convenience for automated tasks, but **full-access is not a sandbox** or containment guarantee. Unrestricted shell access is never exposed as a substitute for safe analysis execution. Host-level isolation and container boundaries remain the responsibility of the system environment.
