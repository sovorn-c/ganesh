# e19s01 — First-Run Identity, Bounded Supervisor Context and Returning Next Action

## 1. Identity

- **Story ID:** e19s01
- **Epic:** e19 — Researcher-facing workspace polish and continuous verification
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 8
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher launching Ganesh, I want the first screen to name Ganesh and the bounded Supervisor and to show one next safe action, so that I can start or resume work without a wizard or a blank Pi session.

## 3. Context

`runWorkspace` already creates or reopens a durable project and starts Pi InteractiveMode. `PiWorkspaceTuiPort` passes `initialMessages: []`. Success text only says current records are ready. `pi:base-prompt` is an inert curated resource. Fake TuiPort tests already distinguish `created` versus `reopened`. `--print-launch` skips the TUI and prints `result.message`.

## 4. Problem

A new researcher cannot tell Ganesh from generic Pi, cannot see that the Supervisor is a coordinating agent rather than an academic supervisor, and gets no next action. Returning researchers see the same empty session.

## 5. Goal

`composeLaunchGuidance` builds identity, bounded Supervisor role, and one next action from current records. Created launches use the first-run banner. Reopened launches skip onboarding noise. The same payload feeds InteractiveMode initial fields and `--print-launch`.

## 6. Non-Goals

- Focused `/ganesh-*` research commands; e19s02 owns those.
- Competency metadata versus executable subset; e19s03 owns those.
- Execution-mode reminder; e19s04 owns those.
- Release-state copy and GitHub Actions; e19s05 owns those.
- Dumping source bodies, participant content, or restricted bytes into model context.
- Changing `createProject` / `openProject` schemas.

## 7. Stakeholders

- Researchers on first launch and on return.
- Reviewers checking that Supervisor context is real runtime context.
- Later stories that reuse `composeLaunchGuidance` for help and next-action text.

## 8. Dependencies

- Existing `runWorkspace`, `WorkspaceIntakeState`, `PiWorkspaceTuiPort`.
- Locked Pi 0.85.1 InteractiveMode options: `initialMessage` and `initialMessages` (`docs/sdk.md` around the InteractiveMode constructor).
- Additive read-only `listOrientations` if launch guidance needs orientation ids; inspect capability only.
- SC-e19s01-P0-01 through SC-e19s01-P1-04.
- No new package.

## 9. Assumptions

- Next action is derived from current records (missing orientation, open decision packet, waiting run, or help). It is not an invented approved research question.
- `--print-launch` remains the non-TTY seam. Tests inject TuiPort and never call `InteractiveMode.run()`.
- Bounded context is ids, statuses, and owner-visible summaries. Restricted material is omitted with an honest limiter.
- Ganesh Supervisor is not the academic supervisor.

## 10. Constraints

- Do not select an execution mode.
- Do not write `~/.pi` or change global Pi configuration.
- Do not treat `pi:base-prompt` as Supervisor identity.
- Authority stays in `capability-broker`, not in the banner.
- Schema marker stays 1. No PacketKind or OWNER_OPERATIONS change.

## 11. Domain Model

- **Launch guidance:** identity, Supervisor role bound, next action, created-versus-reopened variant, and InteractiveMode initial fields.
- Distinct from HelpView, WorkStatus, and competency affordances.

## 12. Requirements

### ADDED: First-run identity, bounded Supervisor context and returning next-action

`composeLaunchGuidance(session)` MUST return Ganesh identity, a bounded Ganesh Supervisor role statement, and exactly one next safe action. Created launches MUST include first-run identity. Reopened launches MUST set `returning: true` and MUST NOT repeat first-run onboarding. Supervisor context MUST be passed through InteractiveMode `initialMessage` / `initialMessages`, not `loadCuratedResource("pi:base-prompt")`.

### MODIFIED: Empty InteractiveMode initial context

**Before:** `PiWorkspaceTuiPort` constructed InteractiveMode with `initialMessages: []`. `runWorkspace` success text only said current records are ready.

**After:** `TuiPort.run` receives composed guidance. `--print-launch` prints that guidance text. Fake TuiPort tests observe the payload without a live TTY.

## 13. Non-Functional Requirements

- **Honesty:** next action is not an invented approval.
- **Privacy:** restricted or participant content is omitted from initial fields.
- **Isolation:** project-local `agentDir`; no `~/.pi` write.
- **Authority:** banner text cannot mint OwnerCapability.

## 14. Contracts

### New contracts

- `composeLaunchGuidance(session): LaunchGuidance`
- `src/workspace/guidance.ts`
- `tests/workspace/launch-guidance.test.ts`
- optional `listOrientations(handle, capability)` with `methodology:inspect`

### Existing contracts preserved

- `runWorkspace` create/reopen and fail-closed argv
- `WorkspaceIntakeState.stagePipeline === false`
- `createOwnerCapability` in-process
- `--print-launch` skip-TUI behavior

## 15. Reason for Depth and Zoom-Out

**Purpose of `runWorkspace`:** create or reopen the project and start the Pi workspace. **Callers:** `src/cli.ts`. **Contracts:** create/reopen, project-local agent dir, extension factories.

**Purpose of `PiWorkspaceTuiPort`:** construct InteractiveMode. **Callers:** `createWorkspacePorts`. **Contracts:** `initialMessages` currently empty; tests inject TuiPort.

Reason for depth: launch guidance is a fail-closed presenter over current records, not inline strings in the TUI adapter.

## 16. Implementation Steps

1. Add launch-guidance types and compose identity, Supervisor bound, and created-versus-reopened variants → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s01.*(identity|supervisor|created|reopened|returning)' dist/tests/*/*.test.js`
2. Pass composed initial fields through TuiPort and print the same text from `--print-launch`, including one next action from current records → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s01.*(initial|print-launch|next-action|guidance)' dist/tests/*/*.test.js`
3. Omit restricted content from Supervisor context, refuse pi:base-prompt as identity, and record no new security findings in the launch path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s01.*(restrict|base-prompt|redact|omitted)' dist/tests/*/*.test.js`
4. Keep released E01-E18 behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e19s01-P0-01: First-run names Ganesh and the bounded Supervisor

```gherkin
Given a folder with no project store
When runWorkspace creates the project
Then launch guidance identifies Ganesh
And it describes the Ganesh Supervisor as a bounded coordinating role
And it does not call that role an academic supervisor
```

### Scenario SC-e19s01-P0-02: Next action comes from current records

```gherkin
Given a created or reopened project with inspectable current records
When composeLaunchGuidance runs
Then it returns exactly one next safe action
And that action is derived from current records or help
And it is not an invented approved research question
```

### Scenario SC-e19s01-P0-03: Returning launch skips onboarding and uses real initial fields

```gherkin
Given an existing writable project
When runWorkspace reopens it
Then guidance.returning is true
And first-run onboarding text is absent
And TuiPort receives non-empty InteractiveMode initial fields
And those fields are not loaded from pi:base-prompt
```

### Scenario SC-e19s01-P1-04: Restricted bytes stay out of Supervisor context

```gherkin
Given current records that include restricted or participant material
When composeLaunchGuidance builds initial fields
Then the payload omits restricted bodies
And it states that restricted records require authorized inspection
```

## 18. Verification Script (Step-by-Step)

1. Create a temp folder; run workspace with injected ports; read identity and Supervisor text.
2. Reopen the same project; confirm returning guidance and a next action.
3. Assert TuiPort captured initial fields and `pi:base-prompt` was not the source.
4. Seed a restricted record; confirm omission.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Prompt-as-authority:** tests assert no OwnerCapability is minted from guidance text.
- **Context leak:** omit classified/participant bodies; T-E19-01.
- **TUI hang:** tests inject TuiPort; `--print-launch` remains non-interactive.

## 20. Traceability

- Scope outcome: R19 criterion 1
- Epic acceptance: first-launch identity and returning next action
- Test scenarios: SC-e19s01-P0-01, SC-e19s01-P0-02, SC-e19s01-P0-03, SC-e19s01-P1-04
- Domain contracts: Ganesh Supervisor; Launch guidance; ADR 0002
- Language: Ganesh Supervisor, Academic supervisor
- Security: T-E19-01, T-E19-02
