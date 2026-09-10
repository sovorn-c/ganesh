# e01s02 — Actionable Local Environment and Execution-Mode Preflight

## 1. Identity

- **Story ID:** e01s02
- **Epic:** e01 — Verified development and runtime baseline
- **Type:** feat
- **Risk:** P1
- **Context:** infrastructure and local readiness
- **BCPs:** 4
- **Status:** passing
- **Requirement delta:** ADDED

## 2. User Story

As a Ganesh maintainer or researcher, I want a local preflight to explain whether the project environment and selected execution mode are ready so that missing tools and unsafe assumptions are visible before work starts.

## 3. Context

The command baseline from e01s01 supplies the entry point for preflight, but it does not yet define a truthful environment report. Ganesh must support researchers using different local languages and tools, and it must expose Pi-compatible `ask`, `approve`, and `full-access` choices without presenting `full-access` as a sandbox. E11 owns actual analysis execution and bash-guard enforcement; this story only reports readiness and configuration shape.

## 4. Problem

A generic command failure leaves maintainers guessing whether Node, npm, project dependencies, a required local tool, or execution-mode configuration is missing. Conversely, an optimistic “ready” result could hide a Node target mismatch or imply that a permission mode provides containment it does not provide.

## 5. Goal

Implement a deterministic, redacted preflight report with stable exit semantics. It must identify the runtime, package/dependency readiness, configured or missing execution mode, and required local tools, then provide a concrete remediation category for each failure.

## 6. Non-Goals

- Running user analysis, tests, shell commands, or provider calls on the user's behalf.
- Enforcing the bash guard or implementing `ask`, `approve`, or `full-access` execution semantics; those belong to e11 and the Pi integration boundary.
- Choosing a research language, installing packages automatically, or changing shell/Pi configuration.
- Research permissions, human commitments, project persistence, or product terminal UX.

## 7. Stakeholders

- Maintainers diagnosing a new checkout.
- Researchers checking whether their local analysis environment is usable.
- E11 implementers consuming the execution-mode readiness contract.
- E14 implementers presenting readiness in the terminal workspace.

## 8. Dependencies

- Completed e01s01 manifest, lockfile, scripts, and compiled baseline.
- `specs/planning-context.yaml` language-agnostic execution constraint.
- `specs/product/SCOPE_LATEST.yaml` R01 and R11 success criteria.
- `specs/tech-architecture/tech-stack.md` global invariant 9 and execution-state contracts.
- Node.js 24 LTS/npm and project-local dependencies.

## 9. Assumptions

- The preflight command can inspect process-visible runtime and project files without reading private research artifacts.
- An execution mode may be absent during initial setup; absence is a reported configuration state, not an automatic selection.
- A project may declare required local tools by name and version/range; preflight reports missing tools but does not install them.
- A bash guard configuration is owned by e11; preflight can report whether its configuration is present/valid when the project exposes that contract, but cannot claim enforcement.

## 10. Constraints

- The accepted mode values are exactly `ask`, `approve`, and `full-access`; invalid values fail readiness with remediation.
- `full-access` MUST be described as an explicit local-risk choice and MUST NOT be described as sandboxing or containment.
- Diagnostics MUST redact secrets and must not dump the environment, command-line credentials, tokens, or research content.
- Preflight MUST distinguish pass, warning, and blocking failure; a missing optional tool cannot look like a successful required prerequisite.
- The command must be deterministic for injected fixtures and must not require network access merely to report local readiness.
- Installation suggestions must follow the selected mode policy; preflight itself does not install.

## 11. Domain Model

- **Preflight check:** one named local prerequisite with status, evidence, and remediation.
- **Readiness report:** ordered collection of checks and an aggregate exit code.
- **Execution mode:** user-selected Pi-compatible authority level: `ask`, `approve`, or `full-access`.
- **Tool requirement:** a declared local executable/runtime and acceptable version range.
- **Bash guard status:** configuration visibility only in this story; enforcement is a separate e11 contract.

## 12. Requirements

### ADDED: Truthful local readiness report

The project MUST provide a preflight report that checks Node.js target, npm/package-manager metadata, installed project dependencies, declared local tools, and execution-mode configuration. Each failed required check MUST have a stable name, non-secret evidence, remediation category, and non-zero aggregate result.

### ADDED: Explicit Pi-compatible execution modes

The readiness contract MUST recognize only `ask`, `approve`, and `full-access`, report the selected or missing mode, and state that `full-access` is an explicit local-risk choice rather than a sandbox guarantee. It MUST not grant research authority or implement command filtering.

### ADDED: Redacted and scriptable diagnostics

The report MUST support a machine-readable form with stable statuses and exit codes while keeping secrets, full environment values, and research content out of output. Human-readable output may add remediation text but must preserve the same result.

## 13. Non-Functional Requirements

- **Fail closed:** a required missing tool, unsupported Node target, invalid mode, or invalid project dependency state exits non-zero.
- **Portability:** checks use process-visible local information and do not assume macOS-specific tools or paths.
- **Security:** output is redacted by construction; execution-mode reporting does not imply sandbox containment.
- **Determinism:** fixture-driven checks produce stable ordering, status names, and exit codes.
- **Usability:** each blocking result tells the user what to install, configure, select, or rerun; no automatic installation occurs.

## 14. Contracts

### New contracts

- `npm run preflight` returns zero only when required local readiness checks pass.
- `npm run preflight -- --json` returns a stable JSON object containing check identifiers, statuses, redacted evidence, remediation categories, selected mode state, and aggregate status.
- The accepted execution-mode vocabulary is `ask | approve | full-access`; a missing value is explicit `not_configured`.
- `full-access` output includes a non-sandbox/local-risk notice.
- Required-tool declarations are data-driven and report `missing`, `unsupported`, `not_configured`, or `ready` without installing tools.

### Existing contracts preserved

- e01s01 owns the npm command names and strict TypeScript baseline.
- E11 owns execution enforcement, bash-guard behavior, approved-input policy, and analysis provenance.
- Ganesh research authority remains outside conversation history and outside shell mode selection.

## 15. Reason for Depth and Zoom-Out

The only caller introduced here is the e01s01 `preflight` npm script; later e14 terminal presentation and e11 execution-policy code consume its stable report contract. The preflight module's purpose is local prerequisite diagnosis, not policy enforcement. Its contracts are the accepted mode vocabulary, fail-closed required-check result, redaction, and remediation shape. Keeping the report separate from execution prevents a readiness check from becoming a bypass around research permissions or the bash guard. No additional abstraction is justified beyond a small check-result structure because the checks share status, evidence, and remediation behavior.

## 16. Implementation Steps

1. Define the public preflight check/result schema, stable statuses, aggregate exit rules, and JSON/text renderers → verify: `npm run build && node --test --test-name-pattern='preflight.*result|preflight.*exit|preflight.*json' dist/test/*.test.js`
2. Implement Node/npm, dependency, required-tool, and project-configuration checks with deterministic fixture injection and actionable remediation → verify: `npm run build && node --test --test-name-pattern='preflight.*tool|preflight.*runtime|preflight.*dependency' dist/test/*.test.js`
3. Validate `ask`, `approve`, and `full-access`, including missing/invalid values and the explicit non-sandbox notice; keep enforcement and installation outside the module → verify: `npm run build && node --test --test-name-pattern='execution.*mode|full-access|sandbox' dist/test/*.test.js`
4. Add redaction tests and wire the report into `npm run preflight` without changing the e01s01 command contract → verify: `npm run preflight -- --json`
5. Run blocking and passing fixture checks and document the remediation categories for the next e11 implementation → verify: `npm run build && node --test --test-name-pattern='preflight|diagnostic-redaction' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e01s02-P1-01: Missing tools are actionable

```gherkin
Given a project declares a required local tool that is absent or outside its accepted version range
When the maintainer runs preflight
Then the report names the failed check, shows a non-secret observed state, gives remediation, and exits non-zero
And it does not install the missing tool automatically
```

### Scenario SC-e01s02-P1-02: Execution modes are explicit and non-sandboxing

```gherkin
Given a project has no mode, an invalid mode, or one of ask, approve, or full-access configured
When the maintainer runs the machine-readable preflight
Then the report distinguishes not_configured, invalid, and ready mode states
And it accepts only ask, approve, or full-access
And full-access is labelled an explicit local-risk choice, not a sandbox guarantee
```

### Scenario SC-e01s02-P1-03: Diagnostics are redacted

```gherkin
Given process environment values include credential-shaped and research-like values
When preflight renders human-readable and JSON diagnostics
Then those values are absent or redacted
And the aggregate exit status remains independently machine-verifiable
```

## 18. Verification Script (Step-by-Step)

1. Run `npm run preflight -- --json` on the supported Node.js 24 environment and inspect the stable check identifiers and aggregate status.
2. Run the fixture for a missing required tool and confirm a non-zero exit plus remediation without an installation attempt.
3. Run fixtures for no mode, `ask`, `approve`, `full-access`, and an invalid mode.
4. Confirm `full-access` output includes the local-risk/non-sandbox notice and does not claim command containment.
5. Provide credential-shaped environment values to the test fixture and confirm diagnostics redact them.
6. Confirm the command does not read or modify global Pi configuration.

## 19. Risks and Mitigations

- **False readiness:** a check could report the binary but not a usable version; validate both presence and declared range.
- **Policy confusion:** mode reporting could be mistaken for enforcement; keep the notice and e11 ownership explicit in output and documentation.
- **Secret leakage:** broad environment serialization could disclose credentials; allow-list fields and test redaction with sentinel values.
- **Host coupling:** a macOS-only executable check would exclude valid environments; use portable process probes and declared tool adapters.
- **Automatic-install drift:** remediation text could become an implicit installer; preflight returns instructions only and follows the selected mode for any later install action.

## 20. Definition of Done and Slopcheck

- Preflight has stable text/JSON contracts, truthful exit codes, deterministic fixtures, required-tool remediation, and mode reporting.
- `ask`, `approve`, and `full-access` are the only accepted mode values; full-access is explicitly non-sandboxing.
- Redaction tests pass and no global Pi configuration or research content is required.
- All tasks in `e01s02-tasks.yaml` start as `failing` and are flipped only after verification during implementation.

### Slopcheck

- No new external runtime package is required; use the e01s01 TypeScript/compiler and Node standard library.
- `[OK]` Node.js built-in process and filesystem APIs — sufficient for local prerequisite checks.
- `[OK]` Existing e01s01 test/lint toolchain — reused rather than introducing a diagnostic framework.
- No `[SUS]` or `[SLOP]` package is proposed.

### Red-Flag Check

The plan does not implement a sandbox, silently select full-access, install missing tools, read global Pi configuration, or let a preflight result grant research or approval authority.
