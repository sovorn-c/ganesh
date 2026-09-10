# e02s02 — Versioned Research Branches and Concurrent Commit History

## 1. Identity

- **Story ID:** e02s02
- **Epic:** e02 — Durable versioned research projects
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 8
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want alternative research branches and exact history to remain isolated and concurrency-safe so that exploring a design cannot silently change my committed project state.

## 3. Context

E02s01 supplies durable project, artifact, and dependency records. This story adds named research branches, current references, append-only change history, expected-version checks, duplicate command handling, and SQLite writer exclusion. A branch is a project-state alternative, not a Pi conversation branch. Human commitment and permission authority remain owned by later epics.

## 4. Problem

A durable database alone can still lose research state when two processes update the same branch, when a stale screen writes over newer work, or when an exploratory branch shares mutable references with the current project. Historical versions must remain reconstructable and promotion must expose impact rather than silently merge contradictory changes.

## 5. Goal

Provide safe branch creation, isolated candidate changes, explicit promotion, and durable concurrent-writer rules. Every current reference update must name its expected prior version and command identity, and every accepted change must be reconstructable from exact dependency edges and history.

## 6. Non-Goals

- Owner approval, data-use permission, capability enforcement, or decision-packet authority; those belong to e03/e04.
- General event sourcing, distributed replication, or a hosted multi-user service.
- Automatic scholarly conflict resolution or silent branch merging.
- Full backup/export, migration, deletion, and restore drills; e15 extends recovery.

## 7. Stakeholders

- Researchers comparing alternative questions, designs, or project artifacts.
- Future owner commands and coordinator workers that need safe current references.
- Reviewers checking stale writes, duplicate commands, and historical reconstruction.

## 8. Dependencies

- e02s01 project, artifact-version, and exact-dependency contracts.
- SQLite transaction and foreign-key support in the Node.js 24 target.
- Node standard-library `node:sqlite`, `node:crypto`, and `node:test`; no new external package is required.
- D-09 exact-version history, D-15 SQLite canonical state, and the concurrency table in `tech-stack.md`.

## 9. Assumptions

- Each branch has one current snapshot reference per branch-owned logical object.
- An expected-version check is evaluated in the same transaction as the reference update.
- A command ID is unique within the project mutation domain; replaying the same payload is idempotent, while changing its payload fails.
- Promotion copies explicit candidate references and records affected dependents; it does not rewrite the source branch or silently resolve conflicts.

## 10. Constraints

- Branch changes never rewrite artifact bytes, prior snapshots, or historical decisions.
- A stale expected version must fail without a partial current-reference update.
- Concurrent writers must be excluded by database-backed transactions/locking, not only an in-process mutex.
- Dependency edges are exact and typed; traversal reports potential impact but does not decide scholarly validity.
- Current permissions and external authorizations are not weakened by branch selection; those checks remain later policy gates.

## 11. Domain Model

- **Research branch:** named project alternative with a parent snapshot, candidate references, and history.
- **Current reference:** branch-owned pointer to an exact artifact/version or project object version.
- **Change record:** append-only record of command ID, expected version, resulting version, actor/source, and timestamp.
- **Promotion:** explicit copying of selected candidate references into a destination branch with impact records.
- **Impact record:** deterministic list of direct/transitive dependents requiring review after a promoted change or shared-source correction.

## 12. Requirements

### ADDED: Isolated versioned branches

The application MUST create and inspect research branches with independent current references. Editing a candidate in one branch MUST NOT mutate another branch or the committed snapshot; promotion MUST be explicit and versioned.

### ADDED: Expected-version and duplicate-command protection

Every current-reference mutation MUST validate the expected prior version and unique command ID atomically. A stale writer MUST fail without mutation. A duplicate command with the same payload MAY return the original result, but a reused ID with a different payload MUST fail.

### ADDED: Concurrent history and impact traversal

The application MUST serialize conflicting writers at the SQLite boundary and retain append-only change history. Promotion and shared-source corrections MUST identify affected dependency edges and branches without rewriting historical snapshots or deciding whether the research interpretation is correct.

## 13. Non-Functional Requirements

- **Concurrency:** two database connections cannot both commit from the same expected version.
- **Isolation:** branch reads show only their own current references plus immutable shared versions.
- **Auditability:** command ID, expected/result versions, actor/source, and dependency impacts remain inspectable.
- **Recovery:** a committed history entry always resolves to a complete version record or reports an explicit missing/corrupt status from e02s01.
- **Security:** branch selection cannot grant owner authority or broaden data-use permissions.

## 14. Contracts

### New contracts

- `createBranch(project, input)` returns a named branch with a parent snapshot and independent references.
- `updateBranchReference(project, request)` requires branch ID, object/version, expected version, and command ID; it returns accepted, duplicate, stale, or blocked without partial mutation.
- `promoteBranch(project, request)` records explicit source/destination versions and deterministic affected dependents.
- `listHistory(project, branch)` returns append-only records sufficient to reconstruct current references and prior snapshots.

### Existing contracts preserved

- E02s01's immutable bytes, exact dependency references, explicit content status, and SQLite authority.
- The architecture's distinction between a research branch and Pi conversation navigation.
- Human commitment and permission checks remain outside generic branch mutation APIs.

## 15. Reason for Depth and Zoom-Out

The branch store is a shared module for future owner actions, coordinator work, import updates, and recovery. Its callers depend on three contracts—exact references, expected-version rejection, and append-only history—so a single transaction boundary is less complex and safer than caller-specific checks. Impact traversal is kept deterministic and read-only; scholarly interpretation remains outside this abstraction.

## 16. Implementation Steps

1. Add branch records, parent snapshots, current references, and append-only history on top of e02s01 → verify: `npm run build && node --test --test-name-pattern='e02s02.*branch|snapshot|history' dist/test/*.test.js`
2. Implement transactional expected-version checks, command-id idempotency, and database-backed concurrent-writer exclusion → verify: `npm run build && node --test --test-name-pattern='e02s02.*concurr|stale.*writer|duplicate.*command' dist/test/*.test.js`
3. Implement isolated candidate changes and explicit promotion with deterministic direct/transitive impact records → verify: `npm run build && node --test --test-name-pattern='e02s02.*promot|branch.*isolat|impact.*depend' dist/test/*.test.js`
4. Prove exact history and shared-source correction notices remain readable in every affected branch without rewriting old snapshots → verify: `npm run build && node --test --test-name-pattern='e02s02.*history|shared.*source|retraction|snapshot.*preserv' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e02s02-P0-01: Stale and concurrent writes are rejected safely

```gherkin
Given two project handles read the same current branch version
When both attempt a mutation with that expected version
Then at most one mutation becomes current
And the stale attempt returns an explicit conflict without a partial reference or history record
And replaying the accepted command is idempotent while changing its payload is rejected
```

### Scenario SC-e02s02-P0-02: Branch changes remain isolated until promotion

```gherkin
Given a current branch and a candidate branch sharing an immutable starting snapshot
When the candidate branch changes an artifact reference
Then the current branch and its snapshot remain unchanged
When the owner explicitly promotes the candidate reference
Then the destination records the exact change and affected dependents for impact review
```

### Scenario SC-e02s02-P1-03: History and shared-source impact remain reconstructable

```gherkin
Given multiple branches depend on one immutable source version
When a correction or retraction notice is recorded
Then each affected branch receives an inspectable impact notice
And prior snapshots and historical decisions remain readable without being rewritten
```

## 18. Verification Script (Step-by-Step)

1. Create a project and two named branches from the same initial snapshot.
2. Change an artifact reference in the candidate branch and confirm the current branch is unchanged.
3. Use two SQLite connections to submit the same expected-version mutation; confirm one success and one stale conflict.
4. Replay the successful command and then reuse its command ID with a changed payload; confirm idempotent replay and rejection respectively.
5. Promote an exact candidate version and inspect deterministic impacted dependents.
6. Record a shared-source correction notice and confirm every dependent branch retains its old snapshot plus the new notice.

## 19. Risks and Mitigations

- **Lost update:** perform expected-version comparison and update in one transaction; test with two real connections.
- **Duplicate side effect:** persist command IDs and payload identity before returning success.
- **Branch aliasing:** copy reference rows/snapshots, never share mutable current-reference records.
- **Overclaiming impact:** label traversal as potential impact; require later scholarly/human review for meaning.
- **Lock starvation:** use bounded SQLite transaction behavior and return an explicit retry/conflict result.

## 20. Traceability

- Scope outcome: R02
- Epic acceptance scenarios: AC-08, AC-17
- Test-plan scenarios: SC-e02s02-P0-01, SC-e02s02-P0-02, SC-e02s02-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — branches, dependencies, concurrency, and history
- Decisions: D-09, D-15, ADR 0001, ADR 0002
