# e01s01 — Reproducible TypeScript Runtime and Locked Command Baseline

## 1. Identity

- **Story ID:** e01s01
- **Epic:** e01 — Verified development and runtime baseline
- **Type:** feat
- **Risk:** P0
- **Context:** infrastructure and developer runtime
- **BCPs:** 6
- **Status:** passing
- **Requirement delta:** ADDED

## 2. User Story

As a Ganesh maintainer, I want a pinned TypeScript/Node.js project with one repeatable command contract so that development does not depend on global Pi configuration or an undocumented local setup.

## 3. Context

The repository is a greenfield Git repository with no package manifest, lockfile, source, test runner, or executable command. The approved target is Node.js 24 LTS with the Pi runtime and terminal UI reused through a curated Ganesh application. Prior Pi SDK/TUI compatibility work is accepted as settled; this story records the project-level dependency binding and makes the approved commands executable.

The current local Pi distribution inspected during planning is `@earendil-works/pi-coding-agent` 0.85.1, MIT licensed, with an engine requirement of `>=22.19.0` (`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json`, fields `name`, `version`, `license`, `engines`). The implementation must pin the compatible package version actually selected, rather than rely on a global installation.

## 4. Problem

A developer cannot reproduce or verify Ganesh because the repository contains only planning artifacts. A later feature could accidentally use an implicit global Pi install, an unpinned dependency tree, or a command that is documented but never exercised.

## 5. Goal

Create the smallest working TypeScript project that installs from a committed npm lockfile and exposes repeatable `dev`, `test`, `build`, `lint`, `typecheck`, and `preflight` commands. Record dependency origins and licenses, keep the application entry point minimal, and leave product behavior to the owning epics.

## 6. Non-Goals

- Research-project persistence, evidence, permissions, provider access, or analysis execution.
- The Ganesh product launcher and terminal workflows; those belong to e14.
- Distribution packaging, signing, upgrades, uninstall, or publication; those belong to e18.
- A second web application, hosted CI, bundled model, or global Pi configuration change.
- Strong sandbox containment. Local command policy and bash-guard enforcement belong to e11.

## 7. Stakeholders

- Maintainers who install and test the repository.
- Later epic implementers who depend on stable TypeScript and command conventions.
- Reviewers who need a truthful, terminal-verdict baseline.

## 8. Dependencies

- `specs/product/SCOPE_LATEST.yaml` R01 and `specs/release-plan.yaml` e01.
- `specs/planning-context.yaml` and `specs/tech-architecture/tech-stack.md`.
- Node.js 24 LTS and npm compatible with the selected package manager metadata.
- `[OK] @earendil-works/pi-coding-agent` — current local Pi distribution inspected at version 0.85.1, MIT licensed; pin the chosen compatible version in the project manifest.
- `[OK] typescript` — established TypeScript compiler; use a pinned dev dependency.
- `[OK] eslint` and its TypeScript parser/configuration — established static analysis tooling; use only the minimum pinned packages needed to lint project source.
- Node's built-in `node:test` module for the baseline test runner; no additional test framework is required.

## 9. Assumptions

- Node.js 24 LTS is the approved target even when the planning host currently runs Node.js 26; preflight must report a mismatch rather than silently bless it.
- The project will use npm and a committed `package-lock.json`; another package manager requires an explicit later decision.
- The Pi package selected for the manifest remains compatible with the previously verified adapter boundary; exact API binding is implemented and tested by the consuming epics.
- The minimal entry point is a health/version-level developer baseline, not the finished Ganesh CLI.

## 10. Constraints

- `package.json` must declare the Node.js 24 target and a package-manager version; dependency versions must be lockfile-resolved.
- The approved scripts must exit non-zero on failure and must be runnable in the foreground.
- `npm ci` must be the clean-install path; mutable install behavior must not be the documented baseline.
- No command may read, write, or require a user's global Pi configuration to pass.
- Dependency/license records must identify direct runtime and development packages and their licenses or documented verification status.
- Source files remain TypeScript, use strict checking, and follow the repository's focused-module conventions.

## 11. Domain Model

- **Runtime baseline:** the declared Node.js/npm/Pi package compatibility contract.
- **Dependency lock:** the exact resolved package graph used by a clean installation.
- **Command contract:** an npm script with a stable name, foreground behavior, and non-zero failure semantics.
- **License inventory:** direct dependency origin and license evidence, distinct from scholarly or research evidence.
- **Global configuration:** Pi or shell state outside the project; it is not an authority for Ganesh behavior.

## 12. Requirements

### ADDED: Pinned runtime and dependency baseline

The repository MUST declare Node.js 24 LTS as its target, pin the package manager and direct dependency choices, commit a reproducible npm lockfile, and record dependency/license evidence. It MUST treat Pi SDK/TUI compatibility as prior verification rather than reopen that decision, while still binding the selected package version locally.

### ADDED: Executable developer command contract

The repository MUST provide foreground `dev`, `test`, `build`, `lint`, `typecheck`, and `preflight` commands. The commands MUST return non-zero on failure and MUST NOT depend on global Pi configuration. The minimal baseline MUST build and produce a real terminal test verdict.

### ADDED: Strict TypeScript baseline

The project MUST compile with strict TypeScript settings and keep the minimum source/test entry point sufficient to prove the command contract. It MUST not claim that later Ganesh product flows are implemented by this baseline.

## 13. Non-Functional Requirements

- **Reproducibility:** `npm ci` uses the committed lockfile and does not silently update it.
- **Portability:** scripts use Node/npm and repository-local dependencies rather than host-specific global paths.
- **Security:** diagnostics and package metadata do not print credentials or copy global configuration into the project.
- **Maintainability:** commands are named in `AGENTS.md`/`CLAUDE.md` conventions and have one documented owner each.
- **Observability:** a failed command identifies the command and affected prerequisite without hiding the original non-zero result.

## 14. Contracts

### New contracts

- `package.json` declares `engines.node` for Node.js 24 LTS, package-manager metadata, direct dependencies, and the six approved scripts.
- `package-lock.json` is the installation authority for npm and is changed only by an intentional dependency update.
- `tsconfig.json` enables strict compilation for project source and tests.
- `npm run build` produces the compiled baseline; `npm test` runs the built/testable baseline and returns a terminal verdict.
- `npm run preflight` composes the baseline checks and reports environment readiness without granting execution or research authority.
- The dependency/license inventory records package name, version, origin, license, and verification date/status.

### Existing contracts preserved

- `CONVENTIONS.md` requires strict TypeScript, foreground verification, and no global Pi configuration changes.
- `specs/tech-architecture/tech-stack.md` keeps SQLite, local artifacts, Pi reuse, and language-agnostic local execution as later target architecture rather than implementing them here.

## 15. Reason for Depth and Zoom-Out

This is a greenfield repository, so there are no existing modules, callers, or behavioral contracts to preserve. The story intentionally creates only the project boundary that later callers will consume: npm scripts call the compiler, linter, test runner, and preflight; later epics call the compiled application and Pi adapter through the project manifest. The dependency lock and command names are the contracts that make those future callers reproducible. No new domain abstraction is justified before a product flow exists.

## 16. Implementation Steps

1. Add `package.json`, npm package-manager metadata, Node.js 24 engine constraints, selected direct dependencies, and a committed lockfile; record the direct dependency/license inventory → verify: `node -e "const p=require('./package.json'); if(p.engines?.node !== '>=24.0.0 <25') process.exit(1); if(!p.packageManager || !p.dependencies || !p.devDependencies) process.exit(1); require('fs').accessSync('package-lock.json'); console.log('runtime manifest ok')"`
2. Add strict TypeScript configuration, the minimal compiled entry point, and a built-in test that exercises the public baseline entry point → verify: `npm run build && npm test`
3. Define foreground `dev`, `test`, `build`, `lint`, `typecheck`, and `preflight` scripts with local dependency resolution and non-zero failure behavior → verify: `npm run typecheck && npm run lint && npm run build && npm test`
4. Document the dependency/license inventory and the rule that Ganesh does not rely on global Pi configuration → verify: `npm run preflight`
5. Prove a clean lockfile install and complete command contract from the project tree → verify: `npm ci --ignore-scripts && npm run preflight`

## 17. Acceptance Criteria

### Scenario SC-e01s01-P0-01: Clean locked installation and approved commands

```gherkin
Given a clean project checkout with the committed package-lock.json
When a maintainer runs npm ci followed by npm run preflight
Then installation uses the lockfile and the baseline dev, test, build, lint, typecheck, and preflight commands return zero
And no global Pi configuration is required
```

### Scenario SC-e01s01-P0-02: Node target and dependency evidence are explicit

```gherkin
Given the project manifest and dependency/license inventory
When a maintainer inspects the runtime metadata
Then the Node.js 24 LTS target, package-manager version, direct dependency versions, origins, and license evidence are explicit
And an unsupported runtime is reported as a readiness failure rather than silently accepted
```

### Scenario SC-e01s01-P1-03: Minimal baseline has a real terminal verdict

```gherkin
Given the greenfield project baseline
When a maintainer runs npm run build and npm test
Then TypeScript compiles and the test runner executes at least one public-behavior test
And a failing build or test returns a non-zero process status
```

## 18. Verification Script (Step-by-Step)

1. Use Node.js 24 LTS and a clean checkout or temporary copy of the repository.
2. Run `npm ci --ignore-scripts` and confirm the lockfile is used without dependency updates.
3. Run `npm run preflight` and confirm the output identifies the runtime and all approved command checks.
4. Run `npm run build`, `npm test`, `npm run lint`, and `npm run typecheck` individually; confirm each has a terminal exit status.
5. Temporarily make the minimal test fail and confirm `npm test` exits non-zero, then restore the test.
6. Inspect the dependency/license inventory and confirm no global Pi path or secret value is required.

## 19. Risks and Mitigations

- **Node target drift:** the host may be Node 26 while the product target is Node 24; enforce the declared range in preflight and report the exact mismatch.
- **Global Pi coupling:** a local developer's global package can mask missing project dependencies; use local imports and test after `npm ci`.
- **Lockfile churn:** package-manager version differences can rewrite the lock; pin npm metadata and verify a clean install does not modify the lock.
- **Toolchain overgrowth:** adding a second test framework or broad build framework would increase maintenance without baseline value; use Node's test runner and the smallest established lint/compiler set.
- **License uncertainty:** package registry metadata alone may be incomplete; record source and license evidence and block unverified direct dependencies from the inventory.

## 20. Definition of Done and Slopcheck

- Manifest, lockfile, strict TypeScript configuration, minimal source/test baseline, command scripts, and dependency/license inventory exist.
- All tasks in `e01s01-tasks.yaml` start as `failing`; implementation flips them only after their verify command exits zero.
- `npm ci` followed by the full command contract succeeds on the supported Node.js 24 baseline.
- No product behavior owned by another epic is claimed.

### Slopcheck

- `[OK] @earendil-works/pi-coding-agent` — current local Pi distribution is MIT licensed and already used by the host; pin only the compatible version selected by implementation.
- `[OK] typescript` — established compiler required by the approved stack.
- `[OK] eslint` plus the minimum TypeScript parser/configuration packages — established linting boundary for strict TypeScript; do not add a larger framework.
- `[OK] Node.js built-in node:test` — standard-library test runner; avoids an unnecessary test dependency.
- No `[SUS]` or `[SLOP]` package is proposed.

### Red-Flag Check

The plan does not treat the current global Pi installation as a project dependency, claim Node.js 26 satisfies the Node.js 24 target, introduce a browser application, or claim the baseline implements the research supervisor.
