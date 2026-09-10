# Test Design: e01-runtime-baseline

## 1. Risk Matrix & Scenarios

The epic is infrastructure-critical: later epics depend on a reproducible runtime and truthful readiness checks. Tests use temporary directories and synthetic configuration only; no research material, credentials, or global Pi configuration is read or modified.

| Scenario ID | Behavior Description | Risk | Test Level | Target File/Module |
|---|---|---|---|---|
| SC-e01s01-P0-01 | A clean checkout installs from the lockfile and runs the complete approved command set | P0 | Integration | `package.json`, lockfile, `scripts/preflight` |
| SC-e01s01-P0-02 | The manifest rejects an unsupported Node major and records the selected dependency/license set | P0 | Unit/integration | runtime metadata and manifest validation |
| SC-e01s01-P1-03 | The minimum project entry point builds and the test runner produces a terminal verdict | P1 | Integration | `src/`, `test/`, build/test scripts |
| SC-e01s02-P1-01 | Preflight reports missing or incompatible local tools with remediation and a non-zero exit | P1 | Integration | preflight command and environment checks |
| SC-e01s02-P1-02 | Preflight accepts `ask`, `approve`, and `full-access` as Pi-compatible mode values and reports absent/invalid configuration without treating full-access as containment | P1 | Unit/integration | execution-mode readiness check |
| SC-e01s03-P1-01 | A clean temporary project copy can install and execute the documented baseline without global Pi configuration | P1 | Integration | clean-install verification script and developer guide |
| SC-e01s03-P1-02 | A failed setup check identifies the failed prerequisite and the documented recovery path without exposing environment secrets | P1 | Integration | remediation output and setup documentation |

## 2. Fixture Architecture & Isolation

- **Data fixtures:** A minimal synthetic project fixture containing only the package manifest, lockfile, source smoke entry point, and test fixture. No participant or private research content.
- **Environment fixtures:** Temporary `PATH`, Node-version probe results, package-manager probe results, and execution-mode configuration values injected at the process boundary. Do not mutate the user's shell profile or global Pi settings.
- **Filesystem isolation:** Use a temporary directory for clean-install and failure-recovery checks. Remove it in test teardown and ensure failed setup leaves no partial project state that the application treats as valid.
- **Network:** Dependency installation may use the configured npm registry during the explicit clean-install check. Routine tests must use the existing installed dependency tree or a local package cache; no provider or model network call is required.
- **Assertions:** Prefer public npm scripts and the preflight command over private helpers. Capture exit code and redacted diagnostic categories, not full environment values.

## 3. NFR Verification

| NFR Type | Requirement | Verification Command |
|---|---|---|
| Reproducibility | `npm ci` from the committed lockfile succeeds in a clean temporary project and does not require global Pi configuration | `npm ci --ignore-scripts && npm run preflight` |
| Fail-closed readiness | Unsupported runtime, missing tool, invalid mode, or missing required dependency produces a non-zero result with remediation | `npm run preflight -- --fixture unsupported-runtime` |
| Secret safety | Preflight diagnostics do not print credential-shaped values or full environment contents | `npm test -- --test-name-pattern=diagnostic-redaction` |
| Maintainability | The full approved command set remains a single foreground preflight command | `npm run preflight` |

No fixed startup or installation-time performance threshold is a product requirement for e01; record duration during verification and avoid treating an unmeasured local host as a universal benchmark.

## 4. Out of Scope

- Ganesh product launch and terminal interaction; those belong to e14.
- Distribution packaging, signing, upgrade, uninstall, and publication; those belong to e18.
- Research-project persistence, permissions, provider calls, analysis execution, and bash-guard enforcement; those belong to their owning epics.
- Strong process or filesystem sandboxing. `full-access` is an explicit local-risk mode, not a containment guarantee.
- Global Pi configuration changes and hosted CI requirements.
