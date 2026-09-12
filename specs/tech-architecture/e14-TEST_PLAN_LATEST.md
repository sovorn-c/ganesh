# Test Design: e14-terminal-workspace

## 1. Risk Matrix and Scenarios

| Scenario ID | Behavior description | Risk | Test level | Target file/module |
|---|---|---|---|---|
| SC-e14s01-P0-01 | `ganesh [project-folder]` resolves the folder, creates or reopens the durable project, and binds curated InteractiveMode options to that project cwd and a project-local agent directory. | P0 | Integration | `tests/workspace/launcher-intake.test.ts`, `src/workspace/launcher.ts` |
| SC-e14s01-P0-02 | Incomplete research context and late entry into an existing project open the current records without a mandatory stage wizard or invented approved question. | P0 | Integration | `tests/workspace/launcher-intake.test.ts`, `src/workspace/intake.ts` |
| SC-e14s01-P0-03 | Missing, unreadable, non-directory or escaping project folders fail closed with a readable non-colour text status and create no project or `~/.pi` write. | P0 | Adversarial integration | `tests/workspace/launcher-intake.test.ts`, `src/workspace/argv.ts` |
| SC-e14s01-P1-04 | Launcher mints in-process `OwnerCapability` for the project owner and does not read or write global Pi configuration. | P1 | Contract | `tests/workspace/launcher-intake.test.ts`, `src/workspace/runtime-port.ts` |
| SC-e14s02-P0-01 | Exact-version confirmation displays packet id, packet version and selected option versions, then calls `recordOwnerDecision` only after an explicit local owner action. | P0 | Integration | `tests/workspace/steering-confirmation.test.ts`, `src/workspace/confirmation.ts` |
| SC-e14s02-P0-02 | Ordinary chat, imported "approved" text, forged role objects, worker capabilities and unbound built-in Pi commands create no human commitment. | P0 | Adversarial integration | `tests/integration/workspace-authority.test.ts`, `src/workspace/extension.ts` |
| SC-e14s02-P0-03 | A displayed stale packet is rejected; the workspace presents a refreshed packet and does not duplicate the decision on retry. | P0 | Integration | `tests/workspace/steering-confirmation.test.ts`, `src/workspace/confirmation.ts` |
| SC-e14s02-P1-04 | Contextual help and research alternatives are inspectable without adopting a branch or recording a disposition. | P1 | Contract | `tests/workspace/steering-confirmation.test.ts`, `src/workspace/steering.ts` |
| SC-e14s03-P0-01 | Evidence inspection shows access, extraction, integrity, locators and limitations from E06 descriptors and never fabricates unavailable quotations. | P0 | Integration | `tests/workspace/evidence-viewers.test.ts`, `src/workspace/inspection.ts` |
| SC-e14s03-P0-02 | Native viewer launch occurs only after `authorizeSourceHandoff` returns `allow` with a project-contained path, via the injected `LocalViewerPort`. | P0 | Integration | `tests/workspace/evidence-viewers.test.ts`, `src/workspace/viewer.ts` |
| SC-e14s03-P0-03 | Denied capability, failed integrity, unclassified remote destination, symlink/escape and missing path results never spawn a viewer or return a usable path. | P0 | Adversarial integration | `tests/integration/workspace-authority.test.ts`, `src/workspace/viewer.ts` |
| SC-e14s03-P1-04 | Inspection and a denied viewer request succeed offline with provider/network/fetch/spawn intercepted. | P1 | Integration | `tests/workspace/evidence-viewers.test.ts`, `src/workspace/inspection.ts` |
| SC-e14s04-P0-01 | Working, waiting-for-human, blocked, remaining budget and uncertain-spend flags render as readable text independent of colour. | P0 | Contract + integration | `tests/workspace/live-status-access.test.ts`, `src/workspace/status.ts` |
| SC-e14s04-P0-02 | A documented keyboard-only map completes launch intake, help, exact-version confirmation, evidence inspect and cancel without pointer input. | P0 | Contract | `tests/workspace/live-status-access.test.ts`, `src/workspace/keyboard.ts` |
| SC-e14s04-P0-03 | Unsupported access paths (no keyboard, colour-only status, non-text terminal) return an explicit blocker and are not reported as accessible sessions. | P0 | Contract | `tests/workspace/live-status-access.test.ts`, `src/workspace/access-path.ts` |
| SC-e14s04-P1-04 | Workspace cancel calls existing E05 `cancelRun`/`cancelContract` and shows fenced/quarantine text; it does not implement a second cancel ledger. | P1 | Integration | `tests/workspace/live-status-access.test.ts`, `src/workspace/status.ts` |

## 2. Test-Level Strategy

- Keep presenter, argv, access-path and keyboard-map checks at unit/contract level against pure data.
- Use real temporary SQLite projects and existing E02-E06 APIs for intake, confirmation, inspection, budget and cancel integration.
- Inject `TuiPort`, `WorkspaceRuntimePort`, `LocalViewerPort` and `AccessPathPort`. Never call `InteractiveMode.run()`, never spawn Preview/`open`/`xdg-open`, never write `~/.pi`, and never use the network.
- Intercept `fetch`, HTTP(S), sockets and `child_process` spawn in workspace tests. Production viewer adapter is unbound in tests.
- Do not add live VoiceOver, Terminal.app or iTerm2 jobs to `npm test`. E17 owns qualified-human accessibility review of the documented supported combinations.
- Do not treat TUI rendering or schema validation as scholarly quality.

## 3. Canonical Workspace Semantics

- Argv: optional positional project folder; when omitted, resolve `process.cwd()`. Relative paths resolve against cwd. The resolved path must be an existing directory before create/open, except the explicit create-new intake which may create the directory only through `createProject`.
- Fail closed: missing path, non-directory, unreadable directory, and path escape outside the intended root produce a typed launch error and exit non-zero from the CLI wrapper.
- Late entry: opening a project with existing packets, sources or runs does not start topic-discovery, methodology, or ethics wizards. Unknowns are listed as current records or readiness, not invented approvals (AC-01, AC-02).
- Owner confirmation: the confirmation payload includes `packetId`, `packetVersion`, selected candidate version ids and dependency version ids exactly as displayed. Chat text is never an `OwnerCapability`.
- Viewer: spawn argument is the handoff `path` string only. No shell interpolation.
- Status labels: `working`, `waiting-for-human`, `blocked`, `cancelled` plus numeric remaining token/call/time/spend text. Colour, if present, is redundant.
- Access path: `supported` or `blocked` with a bounded reason code. Blocked paths are release blockers and must not set `accessible: true`.

## 4. Fixture Architecture and Isolation

- Add behavior-owned helpers to `tests/support/workspace-fixtures.ts`; keep names free of epic IDs.
- Reuse `tests/support/project-fixtures.ts` and `work-fixtures.ts` to seed packets, sources, runs and budgets.
- Capture argv via `runWorkspace({ argv, cwd, ports, env })` rather than spawning the CLI for routine cases. One CLI wrapper test may spawn `node dist/src/cli.js` with `--print-launch` or equivalent non-interactive flag.
- Default `agentDir` in tests to a temp directory under the project fixture, never the real home directory. Assert `~/.pi` mtime/absence unchanged.
- Close and remove every temporary project in `finally`.

## 5. Dependency and Supply-Chain Verification

| Purpose | Package | Version | License | Tag | Required adoption evidence |
|---|---|---|---|---|---|
| Pi runtime and InteractiveMode | `@earendil-works/pi-coding-agent` | `0.85.1` | MIT | `[OK]` | Already locked. Production adapter may construct `createAgentSessionRuntime` and `new InteractiveMode(runtime, options)` per installed `docs/sdk.md` lines 1039-1076. Tests inject ports and never construct a live TTY session. |
| Extension commands and custom UI | same package `docs/extensions.md` | `0.85.1` | MIT | `[OK]` | Use `pi.registerCommand`, `ctx.ui.confirm` / `ctx.ui.custom` for owner confirmation. Do not load `~/.pi/agent/extensions`. |

No new production or test package is proposed. Native viewer uses Node `child_process` behind `LocalViewerPort`; do not add `open`, `opn`, or a GUI library.

Rejected: a second TUI toolkit, Ink/Blessed, a localhost web viewer, Playwright/VoiceOver in unit tests, extra agent SDKs, and changing the locked Pi version.

## 6. Non-Functional Verification

| NFR | Requirement | Verification command |
|---|---|---|
| Authority | Only in-process owner confirmation commits; chat/forged/worker/built-in Pi paths do not. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14.*(confirm|forg|chat|bypass|commit)' dist/tests/*/*.test.js` |
| Isolation | Project-local agent dir; no `~/.pi` mutation; no network; no GUI spawn in tests. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14.*(pi.config|agent.dir|network|spawn|offline)' dist/tests/*/*.test.js` |
| Accessibility | Keyboard maps, text status, and unsupported-path blockers are deterministic. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14.*(keyboard|focus|colour|color|access.path|blocker)' dist/tests/*/*.test.js` |
| Privacy | Viewer/inspection denials redact content; unclassified material cannot take a remote destination. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14.*(handoff|disclose|unclassified|redact)' dist/tests/*/*.test.js` |
| Compatibility | Released E01-E06 persistence, authority, policy, decision, work and source behavior remains passing. | `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && npm run preflight` |

All commands run in the foreground with Node.js 24. Tests use Node's built-in `node:test`; no new test framework is proposed.

## 7. Out of Scope

- Live screen-reader hardware, Terminal.app/iTerm2 automation and qualified-human a11y sign-off; E17 owns those.
- Local analysis execution, bash-guard enforcement and Pi ask/approve/full-access semantics beyond displaying the selected mode; E11 owns those.
- Evidence/claim scholarly assessment; E07 owns those.
- Export, restore, deletion and treating Pi session files as canonical state; E15 owns those.
- Packaging, Homebrew/npm publish and support-matrix expansion; E18 owns those.
- Replacing Pi, forking Pi, or adding a Ganesh web application.

## 8. Release Evidence

E14 implementation review requires all 16 scenarios, all inherited E01-E06 tests, explicit AC-01/AC-02/AC-06/AC-07 coverage, and inspection of owner-confirmation, viewer-spawn and access-path denials. Deterministic presenter and authority tests establish software behavior with fakes; they do not prove VoiceOver compatibility, Pi TTY aesthetics, scholarly steering quality or production readiness of the complete Ganesh release.
