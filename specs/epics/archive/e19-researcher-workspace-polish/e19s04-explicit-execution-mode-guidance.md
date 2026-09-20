# e19s04 — Explicit Execution-Mode Guidance Without Auto-Selection

## 1. Identity

- **Story ID:** e19s04
- **Epic:** e19 — Researcher-facing workspace polish and continuous verification
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher about to run local analysis or a specialist command that needs execution, I want to see the current ask/approve/full-access state, so that Ganesh never silently picks a mode and never calls full-access a sandbox.

## 3. Context

`checkExecutionMode` already treats null/empty as `not_configured` and does not auto-select. `GANESH_EXECUTION_MODE` is the env seam. `FULL_ACCESS_NOTICE` exists. Workspace commands do not currently show this report at the point of need. e19s01 launch guidance must not select a mode either.

## 4. Problem

Researchers can reach analysis-adjacent workspace actions without seeing that no mode is selected. A convenience default would violate the hard gate.

## 5. Goal

`presentExecutionModeGuidance` renders the existing `checkExecutionMode` report when a workspace action needs local execution. Empty or invalid values stay unselected. The reminder never writes the env var and never calls full-access a sandbox.

## 6. Non-Goals

- Changing preflight check ids or Pi mode semantics; E11 owns those.
- Auto-selecting ask, approve, or full-access.
- GitHub Actions; e19s05 owns those.
- Implementing a settings UI that persists a default mode.

## 7. Stakeholders

- Researchers enabling local commands.
- Reviewers of the no-implicit-mode hard gate.

## 8. Dependencies

- e19s01 workspace unfreeze and launch guidance (must remain mode-neutral).
- `checkExecutionMode` in `src/runtime/preflight-checks.ts`.
- Point-of-need surfaces: specialist entry and any command that would run local analysis. Help may mention the reminder; it must not set a mode.
- SC-e19s04-P0-01 through SC-e19s04-P1-04.
- No new package.

## 9. Assumptions

- Point of need is specialist coordination and any future analysis-triggered workspace command. Launch guidance may mention that no mode is selected without selecting one.
- `/ganesh-mode` is not required; presenting through status/help plus specialist entry is enough if tests prove visibility at the point of need.
- Invalid values keep `status: invalid` and grant no execution authority.

## 10. Constraints

- Do not write `process.env.GANESH_EXECUTION_MODE`.
- Do not change `checkExecutionMode` ids.
- Do not describe full-access as a sandbox.
- Do not grant research authority from a ready preflight check.

## 11. Domain Model

- **Execution-mode guidance:** the existing ExecutionModeReport rendered in the workspace at the point of need.
- Distinct from analysis-run records and from work-contract execution_mode fields, which remain E11/E05 concerns.

## 12. Requirements

### ADDED: Execution-mode guidance at point of need

When a workspace action needs local execution, the workspace MUST show `presentExecutionModeGuidance()` built from `checkExecutionMode(process.env.GANESH_EXECUTION_MODE)`. If the value is empty, the report MUST stay `not_configured` and MUST NOT select ask, approve, or full-access. If `full-access` is selected, the text MUST include the existing full-access notice and MUST NOT call it a sandbox. Guidance MUST NOT write the environment variable.

## 13. Non-Functional Requirements

- **Honesty:** unselected stays unselected.
- **Safety:** full-access notice remains; not a sandbox.
- **Compatibility:** preflight check id `execution-mode` unchanged.

## 14. Contracts

### New contracts

- `presentExecutionModeGuidance(value?: string | null): ExecutionModeGuidanceView`
- `src/workspace/execution-mode-guidance.ts`
- `tests/workspace/execution-mode-guidance.test.ts`

### Existing contracts preserved

- `checkExecutionMode` statuses and FULL_ACCESS_NOTICE
- E11 bash-guard and unconfigured-mode failures
- e19s01 launch guidance does not set a mode

## 15. Reason for Depth and Zoom-Out

**Purpose of `checkExecutionMode`:** report whether ask/approve/full-access is configured without selecting one. **Callers:** `runPreflight`. **Contracts:** empty → not_configured; invalid → invalid; full-access notice.

Reason for depth: workspace guidance is a presenter over that report. Do not duplicate mode parsing in the extension.

## 16. Implementation Steps

1. Add execution-mode guidance presenter over checkExecutionMode and show it when a workspace action needs local execution → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s04.*(guidance|point-of-need|not_configured|specialist)' dist/tests/*/*.test.js`
2. Keep empty and invalid values unselected and include the full-access notice without sandbox language → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s04.*(auto-select|invalid|full-access|sandbox)' dist/tests/*/*.test.js`
3. Prove guidance never writes GANESH_EXECUTION_MODE and record no new security findings → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s04.*(env|write|GANESH_EXECUTION_MODE)' dist/tests/*/*.test.js`
4. Keep released E01-E18 behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e19s04-P0-01: Guidance appears at the point of need

```gherkin
Given a workspace action that needs local execution
When the action is invoked
Then execution-mode guidance is visible
And it uses checkExecutionMode rather than a second parser
```

### Scenario SC-e19s04-P0-02: Empty or invalid mode is never auto-selected

```gherkin
Given GANESH_EXECUTION_MODE is unset or invalid
When presentExecutionModeGuidance runs
Then status is not_configured or invalid
And the selected mode is not ask, approve, or full-access
```

### Scenario SC-e19s04-P0-03: Full-access is not a sandbox

```gherkin
Given GANESH_EXECUTION_MODE=full-access
When guidance is rendered
Then the full-access notice is present
And the text does not call the mode a sandbox
```

### Scenario SC-e19s04-P1-04: Reminder does not write the environment

```gherkin
Given any guidance invocation
When the presenter returns
Then process.env.GANESH_EXECUTION_MODE is unchanged
And no project record stores a default mode from this reminder
```

## 18. Verification Script (Step-by-Step)

1. Invoke specialist entry with unset mode; confirm not_configured guidance.
2. Set an invalid value; confirm invalid and no selection.
3. Set full-access; confirm notice and no sandbox claim.
4. Assert env unchanged.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Hidden default:** tests cover unset, whitespace, and invalid; T-E19-07.
- **Sandbox over-claim:** string scan on guidance text.
- **Duplicated parser:** presenter must call `checkExecutionMode`.

## 20. Traceability

- Scope outcome: R19 criterion 4
- Epic acceptance: visible mode guidance, no auto-select
- Test scenarios: SC-e19s04-P0-01, SC-e19s04-P0-02, SC-e19s04-P0-03, SC-e19s04-P1-04
- Domain contracts: ExecutionMode; E11 unconfigured-mode
- Language: Analysis run
- Security: T-E19-07, T-E19-08
