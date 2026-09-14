# Ganesh

Ganesh is a local-first, terminal-first research supervision assistant for individual researchers. It keeps evidence, decisions, permissions, and project history in a durable local project instead of relying on conversation history alone.

Ganesh reuses the [Pi](https://github.com/earendil-works/pi) agent runtime and terminal interface while enforcing research-specific controls around it.

> **Development status:** Ganesh is under active development. The repository supports local development and verified local workflows, but it is not yet a packaged or production-ready release.

## What works today

Ganesh currently provides foundations for:

- durable SQLite-backed projects, immutable artifact versions, branches, recovery, and history;
- data classification, disclosure controls, revocation, reviewed declassification, and capability boundaries;
- local TXT, Markdown, PDF, DOCX, bibliographic, and tabular source intake with versioned provenance;
- bounded specialist work with explicit token, call, time, and spend limits;
- human-owned decisions, alternatives, commitments, readiness checks, and reasoned overrides;
- evidence items, claims, claim matrices, appraisal, literature protocols, screening, and gap records;
- a Pi-based terminal workspace with evidence inspection and explicit confirmation paths;
- project export, backup, restore, integrity checks, controlled deletion, and stale-grant protection; and
- redacted diagnostics, health checks, retention controls, provider retry limits, and operational runbooks.

The broader research lifecycle is still being built. Local analysis execution and its isolation controls are not yet implemented.

Ganesh does not claim to be a sandbox, an ethics-review authority, or a substitute for scholarly judgment.

## Quick start

### Requirements

- Node.js 24 LTS
- npm 11.19.0
- macOS is the current product target; broader platform support has not been verified

Clone the repository, then install exactly from the lockfile:

```bash
npm ci --ignore-scripts
npm run preflight
```

Launch a workspace for the current directory:

```bash
npm run dev -- .
```

Or provide another project folder:

```bash
npm run dev -- /path/to/research-project
```

The first launch creates local Ganesh state under `<project-folder>/.ganesh/`. Later launches reopen that project. Keep this directory private and backed up with the project.

For machine-readable readiness output:

```bash
npm run preflight -- --json
```

For a disposable clean-install verification:

```bash
npm run preflight -- --clean-install
```

See [Setup and recovery](docs/setup-and-recovery.md) for troubleshooting.

## Safety model

Ganesh is local-first, but local does not automatically mean safe. The project therefore keeps authority and policy checks outside model prompts and conversation history.

- Workers receive bounded, least-privilege capabilities.
- Restricted material cannot be disclosed solely because an agent requests it.
- Human decisions and approvals remain distinct from assistant proposals.
- Derived records inherit applicable restrictions.
- Diagnostics and diagnostic exports omit research content and redact credential-shaped values.
- `full-access` is an explicit local-risk choice, not containment or sandboxing.

Never use Ganesh to bypass consent, institutional review, data-use agreements, or other applicable obligations.

## Development

Run the complete local check set under Node.js 24:

```bash
npm test
npm run lint
npm run typecheck
npm run build
```

Or run the composed readiness check:

```bash
npm run preflight
```

A preflight result is `ready`, `warning`, or `blocked`. Missing execution-mode configuration is reported rather than selected automatically. When required, set `GANESH_EXECUTION_MODE` to `ask`, `approve`, or `full-access`.

Useful references:

- [Setup and recovery](docs/setup-and-recovery.md)
- [Recovery runbook](docs/runbooks/recovery.md)
- [Incident response](docs/runbooks/incident-response.md)
- [Credential rotation](docs/runbooks/credential-rotation.md)
- [Vulnerability reporting](docs/runbooks/vulnerability-reporting.md)

## Project boundaries

Ganesh is designed for a local folder, a single researcher, and a terminal workflow. It does not currently claim:

- a maintained binary package or installer;
- remote CI, publishing, deployment, or production readiness;
- universal operating-system or CPU support;
- unrestricted shell execution or a hardened analysis sandbox; or
- independent validation of research quality from schema checks or model agreement.

No open-source license has been declared yet. Until one is added, copyright law reserves reuse rights by default.
