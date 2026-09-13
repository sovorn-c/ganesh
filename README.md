# Ganesh

Ganesh is a local-first, terminal-first research-supervision assistant. This repository provides a reproducible foundation for private, reviewable research work on your own computer. The project is under active development.

## Local baseline

Use Node.js 24 LTS. The project pins npm `11.19.0` and uses the committed `package-lock.json`.

```bash
npm ci --ignore-scripts
npm run preflight
npm run build
npm test
npm run lint
npm run typecheck
```

`npm run preflight` reports `ready`, `warning`, or `blocked`. A blocked required check exits non-zero. A missing execution mode is reported as `not_configured` and does not select one automatically. Set `GANESH_EXECUTION_MODE` to exactly `ask`, `approve`, or `full-access` when local execution is needed. `full-access` is an explicit local-risk choice, not a sandbox or containment guarantee; use it only when you understand the local risks.

For machine-readable diagnostics:

```bash
npm run preflight -- --json
```

For a disposable clean-install check:

```bash
npm run preflight -- --clean-install
```

The clean-install command copies the project to a temporary folder, runs `npm ci`, preflight, build, test, lint, and typecheck in the foreground, and removes the temporary folder afterward. It does not install tools automatically, use global Pi configuration, or read research material.

## Recovery

| Result | Recovery |
|---|---|
| Unsupported Node runtime | Activate Node.js 24 LTS, then rerun preflight. |
| Missing or mismatched npm | Use the declared npm version `11.19.0`. |
| Missing project dependency or lockfile problem | Remove the disposable install and run `npm ci --ignore-scripts` again. Do not edit the lockfile during setup. |
| Missing required local tool | Install or configure that tool explicitly, then rerun preflight. No automatic installation is performed. |
| Invalid execution mode | Select `ask`, `approve`, or `full-access`; do not use a sandbox-like substitute. |
| Registry or permission failure | Check the configured registry, network, directory permissions, and disk space; retry from a fresh temporary folder. Do not copy credentials into diagnostics. |
| Partial or interrupted setup | Discard the temporary folder and repeat the documented clean-install command. A partial dependency tree is not ready. |

Preflight diagnostics allow-list runtime, package-manager, dependency, tool, configuration, and mode states. Credential-shaped values are redacted; full environment output and private research content are never emitted.

## Project status

Ganesh is being built as a private, local-first tool for researchers who want transparent workflows, durable project state, and human control over important decisions. This early version focuses on a dependable local foundation; broader research workflows and distribution support are still in development.

This project does not yet claim a universal operating-system support matrix, a sandbox, or a packaged release.
