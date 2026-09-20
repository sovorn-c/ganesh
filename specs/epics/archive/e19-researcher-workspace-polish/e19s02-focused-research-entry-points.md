# e19s02 — Focused Research Entry Points Over Existing Stores

## 1. Identity

- **Story ID:** e19s02
- **Epic:** e19 — Researcher-facing workspace polish and continuous verification
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 8
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher in the terminal workspace, I want named `/ganesh-*` commands for orientation, landscape, screening, appraisal, review, and specialist coordination, so that I can reach existing stores without a second workflow engine.

## 3. Context

`registerWorkspaceCommands` currently registers help, alternatives, confirm/reject/defer, inspect, viewer, status, access, and cancel. Domain APIs already exist: `recordOrientation`, `recordLandscapeMap`, `recordScreeningDecision`, `recordAppraisal`, `openReviewCycle`, `queueRoleRun`, `inspectWork`, `recordDisagreement`. e19s01 supplies launch guidance and the unfrozen workspace seam.

## 4. Problem

Researchers cannot invoke those stores from the workspace command surface. Help does not point at the research path. Adding a pipeline or skill-file runner would violate ADR 0002 and the epic freeze on a second workflow engine.

## 5. Goal

Six focused commands inspect current records and, with owner capability plus required args, call the existing store APIs. Help lists them. Workers cannot mutate. No new run ledger.

## 6. Non-Goals

- Provenance, unsupported-context, and catalog-honesty layer; e19s03 owns those.
- Execution-mode reminder; e19s04 owns those.
- GitHub Actions; e19s05 owns those.
- Twenty-two Pi skill files.
- Changing work-contract budgets, cancellation, or disagreement schema.

## 7. Stakeholders

- Researchers steering orientation through review.
- Owners authorizing specialist runs.
- Reviewers checking capability boundaries.

## 8. Dependencies

- e19s01 launch guidance and workspace unfreeze.
- Existing store and work APIs listed in epic `plan_pins`.
- Additive `listAppraisals` and `listReviewCycles` (inspect capability only) if list APIs are missing.
- SC-e19s02-P0-01 through SC-e19s02-P1-04.
- No new package.

## 9. Assumptions

- Command names are `/ganesh-orient`, `/ganesh-landscape`, `/ganesh-screen`, `/ganesh-appraise`, `/ganesh-review`, `/ganesh-specialist`.
- Empty args inspect. Required write args call existing `commandId` idempotent store functions.
- Specialist coordination queues or inspects through E05 APIs; it does not dispatch a hidden second engine.
- Tests register commands on a fake `ExtensionAPI` as e14s02 does.

## 10. Constraints

- Owner mutations require `OwnerCapability`. Workers receive denied/warning text and no row.
- Do not adopt a branch from these commands.
- Do not bypass disclosure, budgets, or cancellation fences.
- Keep `src/workspace/extension.ts` under the documented size limit or extract presenters.

## 11. Domain Model

- **Research entry point:** a focused `/ganesh-*` command that presents or records through an existing store.
- Distinct from competency affordance honesty (e19s03) and from work-contract internals.

## 12. Requirements

### ADDED: Focused research entry points

`presentResearchEntry` and `registerWorkspaceCommands` MUST expose the six commands. Inspect paths MUST use existing inspect/list APIs. Write paths MUST call existing record/open/queue functions with owner capability and MUST preserve `commandId` idempotency.

### MODIFIED: Workspace help catalog

**Before:** `presentHelp` listed help, alternatives, confirm/reject/defer, inspect, viewer, status, access, and cancel.

**After:** Help also lists the six research entry points. `/ganesh-alternatives` still inspects without adopting a branch.

## 13. Non-Functional Requirements

- **Authority:** workers cannot record orientation, landscape, screening, appraisal, review cycles, or queue specialist runs.
- **Integrity:** existing store validation and payload-conflict behavior remain.
- **Discoverability:** help text includes the six commands.

## 14. Contracts

### New contracts

- `presentResearchEntry(session, kind, args): EntryView`
- `src/workspace/entry-points.ts`
- `tests/workspace/research-entry-points.test.ts`
- `listAppraisals`, `listReviewCycles` if missing

### Existing contracts preserved

- Store capability names (`methodology:frame`, `literature:protocol`, `literature:inspect`, evidence appraisal, writing cycle, `work:*`)
- `recordDisagreement` retention
- `presentHelp` keyboard map
- E14 confirmation and inspection commands

## 15. Reason for Depth and Zoom-Out

**Purpose of `registerWorkspaceCommands`:** trusted `/ganesh-*` owner surface. **Callers:** `createWorkspaceExtensions`. **Contracts:** help, alternatives, exact-version confirmation, inspect, viewer, status, access, cancel.

**Purpose of `recordOrientation`:** durable orientation rows. **Callers:** methodology stores. **Contracts:** `methodology:frame` / `methodology:inspect`, `commandId` idempotency.

Reason for depth: entry points are presenters over existing commands, not a dispatcher or workflow engine.

## 16. Implementation Steps

1. Add entry-point presenters and register the six `/ganesh-*` inspect paths over existing stores → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s02.*(orient|landscape|screen|appraise|review|specialist)' dist/tests/*/*.test.js`
2. Wire owner write paths through existing record/open/queue APIs with commandId idempotency and keep help listing the new commands → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s02.*(record|queue|help|idempoten|commandId)' dist/tests/*/*.test.js`
3. Deny worker mutation, preserve disagreement and budget contracts, and record no new security findings in the command path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s02.*(worker|forbidden|disagreement|budget|deny)' dist/tests/*/*.test.js`
4. Keep released E01-E18 behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e19s02-P0-01: Six entry points reach existing stores

```gherkin
Given a writable project with owner capability
When /ganesh-orient, /ganesh-landscape, /ganesh-screen, /ganesh-appraise, /ganesh-review, and /ganesh-specialist run in inspect or write form
Then each command uses the existing store or work API from plan_pins
And no second run ledger is created
```

### Scenario SC-e19s02-P0-02: Workers cannot mutate

```gherkin
Given a worker capability bound to the same project
When a research entry point write is attempted
Then the store is unchanged
And the command reports forbidden or denied
```

### Scenario SC-e19s02-P0-03: Existing commandId idempotency holds

```gherkin
Given an owner write with a commandId that already completed
When the same entry point is invoked with the same payload
Then the existing row is returned
And a conflicting payload fails closed
```

### Scenario SC-e19s02-P1-04: Help lists the new commands without adopting a branch

```gherkin
Given presentHelp after this story
When help text is inspected
Then it includes the six research commands
And /ganesh-alternatives still reports that no branch was adopted
```

## 18. Verification Script (Step-by-Step)

1. Register commands on a fake ExtensionAPI; invoke each inspect path.
2. Record one orientation with owner capability; retry same commandId; conflict a payload.
3. Repeat a write with worker capability; assert no row.
4. Read help text for the six commands.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Second workflow engine:** commands call existing functions only; tests assert no new queue table.
- **Authority bypass:** worker fixtures required; T-E19-03.
- **File size:** extract presenters from `extension.ts`.

## 20. Traceability

- Scope outcome: R19 criterion 2
- Epic acceptance: focused entry points over existing stores
- Test scenarios: SC-e19s02-P0-01, SC-e19s02-P0-02, SC-e19s02-P0-03, SC-e19s02-P1-04
- Domain contracts: focused commands; ADR 0002
- Language: Work contract, Competency
- Security: T-E19-03, T-E19-04
