# e14s01 — Product Launcher and Late-Entry Project Intake

## 1. Identity

- **Story ID:** e14s01
- **Epic:** e14 — Accessible terminal research workspace
- **Type:** feat
- **Risk:** P0
- **Context:** infra/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a project owner, I want `ganesh [project-folder]` to open a curated Pi terminal session on that local project so that I can enter with incomplete context or an existing corpus without a stage wizard.

## 3. Context

E01 already ships `src/cli.ts` and `npm run dev` as a baseline print. E02 already creates and reopens durable projects. E03 already mints non-serializable `OwnerCapability`. This tracer turns the CLI into the product launcher: resolve a folder, create or reopen the project, bind Pi `InteractiveMode` through an injected runtime port, and admit late entry.

Installed Pi `docs/sdk.md` exports `createAgentSessionRuntime` and `new InteractiveMode(runtime, options)` followed by `await mode.run()`. Ganesh tests must not call `mode.run()`.

## 4. Problem

Without a project-bound launcher, owners cannot steer E04-E06 records from the approved Pi UI. Printing a version string, defaulting to `~/.pi`, or forcing a topic-to-protocol wizard would violate AC-01, AC-02 and the local-first Pi reuse decision.

## 5. Goal

Resolve an optional positional project folder (default cwd), create or reopen the durable project, mint an in-process owner capability, bind curated InteractiveMode options to that project cwd and a project-local agent directory, and present current records without a mandatory pipeline.

## 6. Non-Goals

- Contextual help, alternatives and exact-version confirmation; e14s02 owns these.
- Evidence inspection and native viewers; e14s03 owns these.
- Live work-status presentation, keyboard-map catalogue and access-path blockers; e14s04 owns these.
- Scholarly competencies, analysis execution, export, packaging, live TTY `mode.run()` in `npm test`.

## 7. Stakeholders

- Owners launching Ganesh from a local folder.
- E02-E06 domain APIs that must remain the source of project state.
- E03 authority: the launcher is the trusted owner-capability factory for later workspace actions.
- E18 packaging of the `ganesh` binary.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E01 `src/cli.ts`, `npm run dev`, `runtimeBaseline`.
- E02 `createProject` / `openProject`.
- E03 `createOwnerCapability`.
- Locked `@earendil-works/pi-coding-agent@0.85.1` InteractiveMode factory.
- `specs/IMPACT_LATEST.md` and `specs/tech-architecture/e14-TEST_PLAN_LATEST.md` SC-e14s01-P0-01 through SC-e14s01-P1-04.

## 9. Assumptions

- Positional `[project-folder]` is optional. Omitted means `process.cwd()`. Brackets in the product command table mean optional, not a picker wizard.
- `createProject` runs only when the resolved directory has no `.ganesh` project yet and the owner intake path is explicit; an existing `.ganesh` always reopens.
- Pi `agentDir` and session manager live under `<project>/.ganesh/pi/`. Canonical research state remains SQLite plus artifact files. Conversation files are not commitments.
- Production `cli.ts` calls `InteractiveMode.run()` only through `TuiPort` when a TTY is present. Tests inject a non-blocking port.
- No new npm package. No SQLite schema change.

## 10. Constraints

- Never write or read `~/.pi` or call `getAgentDir()` for the product session.
- Never mint owner capability from argv, environment role fields, JSON, or chat.
- Missing, non-directory, unreadable and escaping folders fail closed with a readable text status and non-zero CLI exit.
- Incomplete topic/discipline/goal or an existing methodology draft must not start a forced discovery or ethics pipeline (AC-01, AC-02).
- `npm run dev` keeps its script name; after build it invokes the same launcher.
- Add `package.json` `"bin": { "ganesh": "dist/src/cli.js" }` and a Node shebang on the CLI entry.

## 11. Domain Model

- **Workspace launch request:** argv, cwd, env and injected ports.
- **Workspace session:** project handle, owner capability, bound runtime options, current-record snapshot.
- **Launch status:** `ready`, `created`, `reopened`, or typed failure (`missing-folder`, `not-a-directory`, `unreadable`, `invalid-project`).
- **TuiPort / WorkspaceRuntimePort:** test and production seams so InteractiveMode construction is injectable.

## 12. Requirements

### MODIFIED: Developer CLI entry and npm run dev

**Before:** `src/cli.ts` printed `runtimeBaseline.name` and `runtimeBaseline.version`; `npm run dev` built and ran that print.

**After:** those commands invoke `runWorkspace`. `runtimeBaseline` remains exported. Tests use a non-blocking `TuiPort` and never hang on `InteractiveMode.run()`.

### ADDED: Product launcher and late-entry project intake

`runWorkspace` MUST resolve the optional folder, create or reopen through E02, mint in-process `OwnerCapability` for `handle.project.ownerId`, and return curated InteractiveMode bind options whose cwd is the project root and whose agent directory is project-local.

### ADDED: Fail-closed folder handling

Invalid folders MUST NOT create `.ganesh`, MUST NOT write Pi config, and MUST emit a readable non-colour text error.

### ADDED: No stage pipeline

A project with only a topic, or an existing methodology draft and attributed supervisor feedback, MUST open current records. The launcher MUST NOT invent an approved research question or demand a complete protocol before presenting the workspace.

## 13. Non-Functional Requirements

- **Security:** no global Pi mutation; owner capability stays in-process.
- **Accessibility (intake):** launch success and failure messages are readable text, not colour-only. Full keyboard maps belong to e14s04.
- **Compatibility:** E01-E06 public APIs and tests remain passing.
- **Isolation:** tests intercept network and home-directory writes.

## 14. Contracts

### New contracts

- `runWorkspace(request): Promise<WorkspaceLaunchResult>` parses argv and returns launch status plus session or typed error.
- `resolveProjectFolder(argv, cwd): FolderResolution` resolves the optional positional path.
- `WorkspaceRuntimePort.create(options)` builds the Pi runtime; tests supply a fake.
- `TuiPort.run(runtime, options)` stands in for `InteractiveMode.run()`.

### Existing contracts preserved

- `createProject` / `openProject` remain the only create/reopen paths.
- `runtimeBaseline` remains `{ name, version }`.
- Preflight CLI stays a separate entry.

## 15. Reason for Depth and Zoom-Out

`src/workspace/` owns presentation and Pi binding; it does not copy project, policy, or decision rules. Split launcher/argv/runtime-port files because filesystem intake, argv parsing and Pi construction fail differently. No plugin registry.

Shared modules are mapped in `specs/IMPACT_LATEST.md`. `src/cli.ts` purpose is the process entry; its only current caller is `npm run dev`; its contract becomes the launcher while remaining a foreground Node script.

Planned tests: `tests/workspace/launcher-intake.test.ts` and helpers in `tests/support/workspace-fixtures.ts`.

## 16. Implementation Steps

1. Add workspace launch types, argv folder resolution, E02 create/reopen intake and project-local agent-dir binding with TuiPort/RuntimePort fakes → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s01.*(argv|intake|create|reopen|agent.dir)' dist/tests/*/*.test.js`
2. Fail closed on missing, unreadable, non-directory and escaping folders with readable text status and no `~/.pi` write → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s01.*(missing|unreadable|directory|escape|pi.config)' dist/tests/*/*.test.js`
3. Admit incomplete context and late entry without a stage pipeline, and wire `src/cli.ts` plus `package.json` bin/`dev` to `runWorkspace` → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s01.*(pipeline|late.entry|incomplete|stage|cli|bin)' dist/tests/*/*.test.js`
4. Prove in-process owner capability, no global Pi config mutation, no new security findings in affected paths, and all released E01-E06 behavior remains passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e14s01.*(capability|global|config|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e14s01-P0-01: Launcher binds the project

```gherkin
Given a local folder argument or cwd
When runWorkspace executes with injected runtime and TUI ports
Then the durable project is created or reopened at that folder
And InteractiveMode bind options use that cwd and a project-local agent directory
```

### Scenario SC-e14s01-P0-02: Late entry does not force a pipeline

```gherkin
Given an existing project with a methodology draft and attributed supervisor feedback, or only a topic
When the owner launches Ganesh on that folder
Then current records are presented without a mandatory discovery or protocol wizard
And no approved research question is invented
```

### Scenario SC-e14s01-P0-03: Invalid folders fail closed

```gherkin
Given a missing path, non-directory, unreadable directory or escaping path
When launch is attempted
Then the result is a typed failure with readable text
And no project and no ~/.pi write occur
```

### Scenario SC-e14s01-P1-04: Owner capability stays local

```gherkin
Given a successful launch
When the session is inspected
Then OwnerCapability belongs to the project owner and is not serializable from argv
And the real home ~/.pi directory is unchanged
```

## 18. Verification Script (Step-by-Step)

1. Create a temp folder and launch with injected ports; assert create then reopen.
2. Seed an existing project with a draft packet and launch again; assert no wizard flag.
3. Launch against missing and file-as-folder paths; assert non-zero/typed failure.
4. Snapshot `~/.pi` before/after; assert unchanged.
5. Run E01-E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Blocking InteractiveMode.run in tests:** require TuiPort; production-only live run.
- **Global Pi config:** inject agentDir; assert home unchanged.
- **cwd confusion:** bind cwd to resolved project root, not process.cwd after chdir races.
- **Create versus reopen:** `.ganesh` presence selects reopen; do not recreate.

## 20. Traceability

- Scope outcome: R14
- Epic acceptance scenarios: AC-01, AC-02
- Test scenarios: SC-e14s01-P0-01, SC-e14s01-P0-02, SC-e14s01-P0-03, SC-e14s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` human authority and global invariants 1, 10
- Architecture: `specs/docs/04-system-architecture.md` §§1, 8 and `specs/docs/01-product.md` selected interface
- Pi API: installed `docs/sdk.md` InteractiveMode example (`new InteractiveMode(runtime, options)` then `mode.run()`)
