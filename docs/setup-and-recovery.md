# Setup and recovery

## Supported baseline target

The project target is Node.js 24 LTS with npm `11.19.0`. The target is a project contract, not a claim that every operating system or CPU architecture is supported. Record a runtime/platform combination as verified only after the clean-install procedure passes on that combination.

The development host used during this baseline check reports Node.js 26.7.0. Preflight correctly marks that host unsupported. A Node.js 24.20.0 runtime was used for the positive readiness check.

## Clean setup

From a clean project folder, run these commands in the foreground:

```bash
npm ci --ignore-scripts
npm run preflight
npm run build
npm test
npm run lint
npm run typecheck
```

The disposable end-to-end check is:

```bash
npm run preflight -- --clean-install
```

It creates a temporary copy, installs only from `package-lock.json`, runs all six checks, and deletes the temporary copy. It does not modify the shell profile, global Pi configuration, or research files.

## Recovery categories

- **Unsupported runtime:** activate Node.js 24 LTS and rerun preflight.
- **Lockfile/dependency:** discard the partial install and rerun `npm ci --ignore-scripts`; do not use a mutable install as the baseline.
- **Missing local tool:** install or configure the named tool explicitly. Preflight never installs it.
- **Invalid mode:** use `ask`, `approve`, or `full-access`. Missing mode is visible as `not_configured`; no mode is selected automatically.
- **Registry/permission/disk:** fix the local prerequisite, discard the temporary copy, and retry. Keep tokens out of captured output.
- **Incomplete setup:** a partial `node_modules` tree is not ready; start again in a disposable folder.

`full-access` is an explicit local-risk choice and is not a sandbox or containment guarantee. e11 owns execution and bash-guard enforcement. e14 owns the product launcher. e18 owns distribution and maintained local release behavior.
