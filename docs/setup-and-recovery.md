# Setup and recovery

## Supported baseline target

The project target is Node.js 24 LTS with npm `11.19.0`. The target is a project contract, not a claim that every operating system or CPU architecture is supported. Refer to `specs/distribution/support-matrix.json` for verified platform combinations. Record a runtime/platform combination as verified only after smoke checks pass on that combination. macOS is not an inherent product boundary; unverified environments remain unverified.

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

## Durable project recovery

E02 stores the canonical project record in `.ganesh/project.sqlite` and finalized artifact bytes below `.ganesh/artifacts/`. `recoverProject` removes only temporary or incomplete artifact files, verifies recorded hashes, and records a recovery checkpoint. It does not invent a database commit or rewrite history.

Project opens report one of these schema/capability states:

- **supported / ready:** the current schema is supported and local mutations are allowed.
- **read-only:** inspection is allowed, but mutation commands return a blocked result.
- **migration-required:** an older schema needs a future migration; inspect and metadata export remain allowed.
- **unknown-future:** a newer schema is inspectable only by this binary; mutations are blocked until a compatible release is used.

Old snapshots are inspection cursors, not rollback commands. Branch promotion and reference changes remain explicit, append-only, and guarded by the destination's expected revision. Full migration, backup/restore, deletion propagation, and portability remain owned by e15; E02 does not claim those capabilities.

## Upgrade, rollback, and product uninstall

- **Upgrade preserves research data:** installing a newer Ganesh package into an isolated prefix or environment preserves `<project>/.ganesh/project.sqlite` and all artifact files under `.ganesh/artifacts/`. When reopening the project, schema status is verified as supported (schema marker 1) and all artifact hashes are verified intact.
- **Rollback procedure uses E15:** create an E15 backup (`backupProject`) before version upgrades. To roll back, reinstall the previous version or tarball in the prefix and run the standard E15 restore procedure (`restoreProject`). Ganesh refuses any second restore engine. Databases with an unknown-future schema version report `unknown-future` and block all mutations.
- **Product uninstall leaves research data:** uninstalling Ganesh from a prefix (`npm uninstall ganesh --prefix <dir>`) removes the CLI executable and package files while leaving the user's research repository untouched. Product uninstall does not delete `.ganesh/project.sqlite` or artifacts, does not add owner operations, and does not record E15 deletion tombstones.
