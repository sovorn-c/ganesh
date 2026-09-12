# e14s04 — Accessible Live Work State and Access-Path Qualification

## 1. Identity

- **Story ID:** e14s04
- **Epic:** e14 — Accessible terminal research workspace
- **Type:** feat
- **Risk:** P0
- **Context:** infra/security
- **BCPs:** 4
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want working, waiting, blocked, budget and cancellation state in readable non-colour text, and I want unsupported access paths named as blockers, so that I can steer live work from the keyboard on supported terminals.

## 3. Context

e14s01-e14s03 deliver launch, confirmation, inspection and viewers. E05 already persists run status, `inspectBudget`, `cancelRun` and `cancelContract`. This slice presents those records, publishes a keyboard-only map for every critical flow, and classifies the terminal/screen-reader path.

R14 requires supported screen-reader/terminal combinations to complete critical flows and unsupported paths to be explicit release blockers. `npm test` proves labels, maps and blocker codes. E17 owns live VoiceOver review.

## 4. Problem

Colour-only status, pointer-only confirmation, or silently claiming accessibility on a dumb terminal would make cancellation and budgets unusable and would hide a release blocker.

## 5. Goal

Render E05 working/waiting-for-human/blocked status, remaining budgets and cancel actions as text; complete launch, help, confirm, inspect and cancel from a documented keyboard map; return `supported` or `blocked` for the access path without claiming accessibility when blocked.

## 6. Non-Goals

- Reimplementing budget accounting or cancel fences; E05 owns those.
- Live VoiceOver, Terminal.app or iTerm2 automation.
- E16 diagnostic export and performance budgets.
- E11 execution-mode enforcement beyond displaying the selected mode as text.
- Replacing Pi's TUI renderer.

## 7. Stakeholders

- Keyboard-only owners and screen-reader users on the documented combinations.
- E05 work runtime (status and cancel).
- E17 qualified-human accessibility review.
- Release management: unsupported paths block production release, not silent ship.

## 8. Dependencies

- e14s01, e14s02, e14s03 critical flows that the keyboard map must cover.
- E05 `listRuns`, `inspectBudget`, `cancelRun`, `cancelContract`.
- `specs/tech-architecture/e14-TEST_PLAN_LATEST.md` SC-e14s04-P0-01 through SC-e14s04-P1-04.

## 9. Assumptions

Supported access paths for this epic:

1. Keyboard-only UTF-8 TTY with text status labels; a screen reader is not required.
2. Documented initial-host pairing of macOS Terminal.app or iTerm2 with VoiceOver, using the same text labels and focus names. Live VoiceOver is not an npm-test obligation.

Unsupported (explicit blockers): no keyboard map for a critical flow; colour-only status; non-UTF-8 or non-text terminal; pointer-only interaction; any other screen-reader/terminal pairing.

If a keyboard is absent, launch/session qualification is `blocked` because critical flows cannot complete. Colour may still be used when a text equivalent exists.

## 10. Constraints

- Status strings MUST include `working`, `waiting-for-human`, `blocked` and remaining token/call/time/spend figures as text. Uncertain spend MUST be labeled uncertain, never zero.
- Cancel in the workspace MUST call E05 cancel APIs with the session owner capability and MUST show fenced/quarantine outcomes as text.
- The keyboard map MUST name keys for: open/intake continuation, help, alternatives, confirm, reject/defer, inspect, viewer request, cancel run, and focus next/previous.
- `AccessPathResult.accessible` MUST be true only for supported paths.
- Blocker reasons MUST be bounded codes, not a claim that the session is accessible.

## 11. Domain Model

- **Status view:** run id, work status, remaining budget, uncertain flag, last cancel result.
- **Keyboard map:** ordered list of `{ action, keys, label }` covering critical flows.
- **Access path result:** `{ status: "supported" | "blocked", accessible: boolean, reason?: string, keyboard: boolean, textStatus: boolean, utf8: boolean }`.

## 12. Requirements

### ADDED: Understandable live work state

The workspace MUST present working, waiting-for-human, blocked, remaining budget and cancellation as readable text sourced from E05 records.

### ADDED: Keyboard-only critical flows

Every critical flow from e14s01-e14s03 plus cancel MUST have a documented keyboard activate path and visible focus label.

### ADDED: Explicit unsupported access-path blockers

`qualifyAccessPath` MUST return `blocked` with a reason code when the path is unsupported, and MUST NOT set `accessible: true` for that result.

## 13. Non-Functional Requirements

- **Accessibility:** text status, focus labels, keyboard completeness.
- **Honesty:** unsupported paths are blockers, not degraded-but-claimed-accessible sessions.
- **Security:** cancel remains owner-only through E05.
- **Compatibility:** E05 cancel fences stay authoritative.

## 14. Contracts

### New contracts

- `presentWorkStatus(session): StatusView` reads `listRuns` and `inspectBudget`.
- `cancelFromWorkspace(session, request): StatusView` calls `cancelRun` or `cancelContract`.
- `keyboardMap(): readonly KeyboardBinding[]` is the complete critical-flow map.
- `qualifyAccessPath(input): AccessPathResult` classifies the current terminal/keyboard/text capabilities.

### Existing contracts preserved

- E05 cancel and budget inspection remain the writers/readers of work state.

## 15. Reason for Depth and Zoom-Out

Access-path qualification is a pure function so tests do not need a TTY. Status presentation stays a thin reader of E05. Reason for depth: mixing colour styling into work-store would hide the accessibility contract.

`src/work/work-runtime.ts` purpose is run lifecycle including cancel; callers are work tests and this status presenter; contracts are owner-only cancel and fenced late output.

## 16. Implementation Steps

1. Present working, waiting-for-human, blocked, remaining budget and uncertain flags as text, and wire workspace cancel to E05 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s04.*(working|waiting|blocked|budget|cancel)' dist/tests/*/*.test.js`
2. Publish a keyboard-only map that covers launch, help, confirm, inspect and cancel with focus labels → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s04.*(keyboard|focus|map)' dist/tests/*/*.test.js`
3. Qualify supported versus blocked access paths, including colour-only and no-keyboard blockers → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s04.*(access.path|blocker|unsupported|colour|color|screen.reader)' dist/tests/*/*.test.js`
4. Prove no new security findings in affected paths and all released E01-E06 behavior remains passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e14s04.*(regression|security)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e14s04-P0-01: Status is readable without colour

```gherkin
Given running, waiting-for-human and blocked runs with remaining and uncertain budget
When the status view is rendered without colour
Then each state name and remaining token, call, time and spend figures appear as text
And uncertain spend is not shown as zero
```

### Scenario SC-e14s04-P0-02: Keyboard-only critical flows

```gherkin
Given a launched session
When only the documented keyboard map is used
Then intake continuation, help, exact-version confirmation, evidence inspect and cancel each have a key and focus label
And no action requires a pointer
```

### Scenario SC-e14s04-P0-03: Unsupported paths are blockers

```gherkin
Given no keyboard, colour-only status, or a non-text terminal
When qualifyAccessPath runs
Then status is blocked, accessible is false, and a bounded reason is present
```

### Scenario SC-e14s04-P1-04: Cancel uses E05

```gherkin
Given an in-flight run
When the owner cancels from the workspace
Then cancelRun or cancelContract records the fence
And the status view shows cancelled plus quarantine text for late output
```

## 18. Verification Script (Step-by-Step)

1. Seed running/waiting/blocked runs and inspect budgets with colour disabled.
2. Assert keyboard map coverage for the five critical actions.
3. Feed no-keyboard and colour-only fixtures into qualifyAccessPath.
4. Cancel a run; assert E05 status and workspace text.
5. Run E01-E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Accessibility theatre:** tests assert text and maps, not a screenshot of colour.
- **Second cancel ledger:** workspace cancel is a wrapper; work tables remain E05.
- **Over-claiming VoiceOver:** document supported pairing; do not mark npm tests as SR-complete.

## 20. Traceability

- Scope outcome: R14
- Epic acceptance scenarios: AC-01, AC-02 (understandable state on late entry)
- Test scenarios: SC-e14s04-P0-01, SC-e14s04-P0-02, SC-e14s04-P0-03, SC-e14s04-P1-04
- Domain contracts: work/execution transitions; cancellation fences
- Architecture: progress/result events and explicit terminal status
