# Ganesh

Ganesh is a local-first, terminal-first research-supervision assistant. This repository currently provides the reproducible runtime and local-readiness baseline; research workflows belong to later epics.

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

`npm run preflight` reports `ready`, `warning`, or `blocked`. A blocked required check exits non-zero. A missing execution mode is reported as `not_configured` and does not select one automatically. Set `GANESH_EXECUTION_MODE` to exactly `ask`, `approve`, or `full-access` when local execution is needed. `full-access` is an explicit local-risk choice, not a sandbox or containment guarantee; enforcement belongs to e11.

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

## Scope boundaries

- e01 owns runtime, command, preflight, and clean-install readiness.
- e11 owns local analysis execution, execution-mode enforcement, and bash-guard behavior.
- e14 owns the product launcher and terminal workspace.
- e18 owns the maintained local release and distribution behavior.

This baseline does not claim a universal operating-system support matrix, a research workflow, a sandbox, or a packaged release. Record support evidence before expanding the matrix.
