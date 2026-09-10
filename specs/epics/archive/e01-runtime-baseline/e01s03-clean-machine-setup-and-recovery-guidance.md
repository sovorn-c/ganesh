# e01s03 — Clean-Machine Setup and Recovery Guidance

## 1. Identity

- **Story ID:** e01s03
- **Epic:** e01 — Verified development and runtime baseline
- **Type:** feat
- **Risk:** P1
- **Context:** infrastructure and developer operations
- **BCPs:** 3
- **Status:** passing
- **Requirement delta:** ADDED

## 2. User Story

As a Ganesh maintainer, I want a documented clean-machine check and recovery path so that a fresh local folder can reach a known baseline without hidden global state or guesswork.

## 3. Context

E01s01 establishes the project manifest and commands, and e01s02 provides truthful local readiness diagnostics. This story connects them into a repeatable clean-folder procedure and captures failure recovery. It makes the developer contract usable on supported local environments without turning the initial validation host into a product boundary.

## 4. Problem

A lockfile and preflight command are not enough if the documented setup assumes a warm `node_modules`, a global Pi installation, a particular shell profile, or a manually remembered recovery sequence. Interrupted or failed setup must be diagnosable without treating a partial install as a valid baseline.

## 5. Goal

Provide a foreground clean-install verification path and concise developer documentation covering prerequisites, exact commands, expected terminal verdicts, common failures, safe retry, and the boundary between e01 readiness and later product launch/distribution.

## 6. Non-Goals

- Packaging or distributing Ganesh; e18 owns the maintained local release.
- Launching the research workspace; e14 owns the product CLI.
- Implementing SQLite, research state, provider access, analysis execution, or bash-guard enforcement.
- Provisioning Node, npm, Pi, languages, or analysis packages automatically.
- Hosted CI or remote environment management.

## 7. Stakeholders

- Maintainers onboarding to the repository.
- Reviewers reproducing the baseline from a clean folder.
- Future contributors diagnosing failed installs.
- E18 release work consuming a known local setup procedure.

## 8. Dependencies

- Completed e01s01 command and lockfile contract.
- Completed e01s02 preflight result and remediation contract.
- Node.js 24 LTS and npm support matrix chosen by implementation.
- `AGENTS.md`, `CLAUDE.md`, and `CONVENTIONS.md` command conventions.
- `specs/product/SCOPE_LATEST.yaml` R01 and e18 boundary.

## 9. Assumptions

- A clean-machine check can use a temporary local project copy and the configured npm registry; no hosted service is required.
- The supported environment matrix is documented when implementation verifies it; this story does not guess a universal OS list.
- A failed install may leave disposable temporary files, but must not make a partial dependency tree appear ready.
- The current host's Node.js 26 is evidence of an environment mismatch, not evidence that the Node.js 24 target should change.

## 10. Constraints

- The clean-install path must run in the foreground and must not use background jobs, detached processes, or shell-global mutation.
- Documentation must use the exact command names from e01s01 and e01s02.
- Recovery guidance must distinguish lockfile, unsupported runtime, missing tool, permission, registry, and disk/resource failures.
- The procedure must not require a global Pi install or modify global Pi configuration.
- The procedure must preserve the selected execution-mode wording and must not claim sandbox containment for `full-access`.
- No secret, token, private research material, or full environment dump may appear in captured diagnostics.

## 11. Domain Model

- **Clean baseline:** a project copy installed only from the committed manifest/lockfile and passing preflight.
- **Setup attempt:** one disposable install/verification run with an outcome and diagnostic category.
- **Recovery action:** a bounded documented response to one setup failure; it does not silently broaden scope.
- **Support matrix:** the verified local runtime/platform/tool combinations; unsupported combinations are reported honestly.
- **Global state boundary:** shell/Pi configuration outside the project, which must not be a hidden prerequisite.

## 12. Requirements

### ADDED: Repeatable clean-machine verification

The repository MUST provide a foreground procedure that creates or uses a clean local project folder, installs from the committed lockfile, runs preflight and the approved command checks, and returns a terminal-verifiable result. A partial or failed setup MUST NOT be reported as ready.

### ADDED: Actionable developer recovery guidance

The developer guide MUST state prerequisites, exact setup commands, expected success evidence, failure categories, safe retry steps, and the evidence needed to report an unsupported environment. It MUST distinguish e01 baseline readiness from e14 product launch and e18 distribution.

### ADDED: No hidden global configuration

The clean setup MUST work without a global Pi installation or shell-profile mutation. If an optional global tool is detected, the procedure may report it but must not use it as the project authority.

## 13. Non-Functional Requirements

- **Repeatability:** the same manifest/lockfile and supported runtime produce the same command sequence and readiness result.
- **Portability:** the procedure uses portable Node/npm operations and documents verified platform limits rather than assuming macOS-only behavior.
- **Recovery:** failures identify a bounded next action and permit safe rerun from a clean temporary folder.
- **Security:** captured output is redacted and local; no credentials or research data enter setup evidence.
- **Honesty:** unsupported or unverified environments remain visibly unsupported/unverified.

## 14. Contracts

### New contracts

- A documented clean-install command sequence exists and uses `npm ci` rather than a mutable install.
- Clean-install verification returns non-zero if installation, preflight, build, test, lint, or typecheck fails.
- Setup documentation maps each supported failure category to a recovery action and identifies when to stop and report a blocker.
- Temporary clean-install fixtures are disposable and do not change global Pi, shell, or user research state.

### Existing contracts preserved

- e01s01 owns the names and semantics of the approved npm scripts.
- e01s02 owns readiness statuses, mode vocabulary, redaction, and preflight exit behavior.
- E14 and e18 retain ownership of product launch and distribution verification.

## 15. Reason for Depth and Zoom-Out

This story does not modify an existing product module. Its purpose is to make the e01s01/e01s02 public developer contracts reproducible from a clean local folder. The callers are maintainers, release verification, and future epic implementers; their contract is a foreground command sequence with a truthful terminal result and bounded recovery. Keeping setup guidance and the clean check small avoids introducing an installer or environment manager before the supported matrix is known.

## 16. Implementation Steps

1. Add a disposable clean-install verification procedure that runs `npm ci`, preflight, build, test, lint, and typecheck in a temporary project folder → verify: `npm run preflight -- --clean-install`
2. Add failure fixtures for unsupported Node, missing dependency, missing local tool, registry/permission failure, and incomplete installation; ensure each returns a remediation category → verify: `npm run build && node --test --test-name-pattern='clean.*install|recovery|remediation' dist/test/*.test.js`
3. Write the developer setup/recovery guide with exact commands, support-matrix evidence requirements, and e14/e18 ownership boundaries → verify: `npm run lint && npm run typecheck`
4. Run the clean setup path from a disposable folder and capture only redacted terminal evidence → verify: `npm ci --ignore-scripts && npm run preflight -- --clean-install`

## 17. Acceptance Criteria

### Scenario SC-e01s03-P1-01: Clean folder reaches the baseline

```gherkin
Given a clean temporary project folder and the committed package-lock.json
When the maintainer follows the documented setup sequence
Then npm ci, preflight, build, test, lint, and typecheck run in the foreground
And the procedure reports a terminal-verifiable success without global Pi configuration
```

### Scenario SC-e01s03-P1-02: Setup failure has bounded recovery

```gherkin
Given a clean setup with one unsupported or missing prerequisite
When the maintainer runs the clean-install check
Then it exits non-zero, identifies the failure category, and points to the documented recovery action
And it does not treat a partial install or unrelated global tool as ready
```

### Scenario SC-e01s03-P1-03: Product boundaries remain clear

```gherkin
Given the developer setup guide and clean-install report
When a maintainer inspects the successful baseline
Then it distinguishes e01 runtime readiness from e14 product launch and e18 distribution
And it does not claim a supported operating-system matrix or release package that has not been verified
```

## 18. Verification Script (Step-by-Step)

1. Create a disposable temporary folder and copy only the project source, manifest, lockfile, and required configuration.
2. Use the documented Node.js 24 LTS environment and run `npm ci --ignore-scripts`.
3. Run the documented clean-install/preflight command and confirm it runs in the foreground and returns a terminal verdict.
4. Confirm build, test, lint, and typecheck execute from the clean dependency tree.
5. Repeat with a controlled missing-prerequisite fixture and confirm the failure category and recovery action.
6. Confirm no global Pi or shell configuration was read or changed and no sensitive value appears in evidence.

## 19. Risks and Mitigations

- **Warm-tree false positive:** stale `node_modules` could hide a missing lockfile dependency; always verify in a disposable folder with `npm ci`.
- **Environment-specific documentation:** a macOS-only instruction could misstate product support; record only verified matrix entries and label the initial host separately.
- **Partial install reuse:** failed npm operations could leave misleading files; discard the temporary folder on failure and rerun clean.
- **Recovery overreach:** guidance could suggest automatic installation or global mutation; keep actions explicit, local, and mode-aware.
- **Evidence leakage:** setup logs can include paths or environment values; capture allow-listed diagnostics and redact sensitive output.

## 20. Definition of Done and Slopcheck

- Clean-install verification and developer recovery documentation exist and use e01s01/e01s02 contracts.
- Success and failure fixtures produce terminal-verifiable outcomes and never mark partial setup ready.
- The procedure does not depend on global Pi configuration, a specific unverified OS, or automatic installation.
- All tasks in `e01s03-tasks.yaml` start as `failing` and are flipped only after implementation verification.

### Slopcheck

- No new external package is proposed; reuse npm, Node.js, and the e01s01/e01s02 toolchain.
- `[OK]` Node.js/npm standard project operations — sufficient for clean-install verification.
- No `[SUS]` or `[SLOP]` package is proposed.

### Red-Flag Check

The plan does not call a warm dependency tree a clean install, claim broad platform support from the current host, add an installer, mutate global configuration, or conflate baseline readiness with product release.
