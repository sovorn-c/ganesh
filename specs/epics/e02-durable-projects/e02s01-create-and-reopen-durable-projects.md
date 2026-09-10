# e02s01 — Create and Reopen Durable Projects and Immutable Artifact Versions

## 1. Identity

- **Story ID:** e02s01
- **Epic:** e02 — Durable versioned research projects
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 8
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want a project and its artifact versions to survive a process restart so that my exact research state does not depend on conversation history.

## 3. Context

E01 provides the locked Node.js 24 TypeScript baseline but no durable application state. This story establishes the smallest vertical path from project creation through SQLite metadata, finalized local artifact bytes, immutable version registration, close/reopen, and offline inspection. It uses the approved SQLite-plus-artifact-files model and does not make a chat session or a graph database authoritative.

## 4. Problem

Without an atomic project store, an artifact can be visible in metadata before its bytes are complete, or a restart can lose the exact version and dependency references that informed later research decisions. Missing and corrupt content must be visible rather than silently replaced.

## 5. Goal

Create the project storage boundary and content-addressed artifact registration path. A reopened project can reconstruct exact versions and dependency references, distinguish unavailable content states, and remain readable without a provider or network connection.

## 6. Non-Goals

- Branch promotion, concurrent branch writers, or impact review; those belong to e02s02.
- Crash recovery and schema migration policy beyond the initial schema marker; those belong to e02s03/e15.
- Human commitments, permissions, provider access, parsing, or terminal UI.
- A graph database, general event store, or conversation-history adapter.

## 7. Stakeholders

- Researchers who need durable local project state.
- Later persistence, permission, evidence, and recovery implementers.
- Reviewers who need to inspect exact bytes and metadata after restart.

## 8. Dependencies

- E01's Node.js 24/npm lockfile and strict TypeScript command contract.
- `specs/tech-architecture/tech-stack.md` artifact/version invariants and SQLite canonical-state decision.
- `[OK] node:sqlite` — Node.js 24 built-in SQLite API; no additional native dependency is proposed. The implementation must verify the target runtime API before use.
- Node standard-library `node:crypto` for content hashes, `node:fs` for local files, and `node:test` for deterministic fixtures.

## 9. Assumptions

- A project has one local owner identity and one canonical SQLite database path selected at creation.
- Artifact bytes are finalized in the local artifact directory before a SQLite reference becomes visible.
- SHA-256 content identity is sufficient for the first artifact store; cryptographic identity is not scholarly validity.
- An unavailable, missing, or corrupt artifact is a readable status, not permission to fabricate replacement content.

## 10. Constraints

- SQLite records are the authority for project metadata, artifact versions, and exact dependency references; artifact files hold immutable content.
- Content edits create a new version and never rewrite bytes referenced by an existing version.
- Registration is atomic from the reader's perspective: no committed row may point to incomplete bytes.
- Reads must work without a network connection and must report the exact source/version/status observed.
- Paths and identifiers are validated at the boundary; a project cannot escape its configured storage root.
- Database writes and artifact finalization must return actionable errors without exposing secrets or silently accepting partial state.

## 11. Domain Model

- **Project:** local owner, storage root, schema version, and current durable metadata.
- **Artifact identity:** logical source or research-file identity that can have multiple versions.
- **Artifact version:** immutable content hash, local path, byte metadata, origin/access metadata, and lifecycle status.
- **Dependency reference:** an exact edge from one artifact/version to another artifact/version.
- **Content status:** available, missing, corrupt, or unavailable with an explicit reason.

## 12. Requirements

### ADDED: Durable project record

The application MUST create and reopen a project using a versioned SQLite schema and a validated local artifact root. The reopened record MUST preserve the project identity, owner, schema marker, and storage locations.

### ADDED: Immutable artifact registration

The application MUST finalize artifact bytes and validate their content hash before registering an immutable artifact version. A later edit MUST create a new version; it MUST NOT rewrite bytes or metadata for an existing version.

### ADDED: Exact dependency references and honest availability

The application MUST persist exact version-to-version dependency references and, on inspection, distinguish available, missing, corrupt, and unavailable content. It MUST not silently remove a dependency or substitute content when bytes cannot be read or validated.

## 13. Non-Functional Requirements

- **Durability:** close/reopen reconstructs the same project, versions, hashes, and edges.
- **Atomicity:** a failed registration leaves no current reference to incomplete content.
- **Portability:** offline reads use only the local database and artifact files.
- **Security:** path traversal and unsafe identifiers are rejected; diagnostics redact sensitive values.
- **Maintainability:** storage operations have focused APIs and explicit result/error types.

## 14. Contracts

### New contracts

- `createProject(input)` returns a project ID, schema version, and validated storage root.
- `openProject(projectRoot)` validates the database schema and returns a read/write or read-only project handle.
- `registerArtifactVersion(project, input)` exposes an immutable version only after finalized bytes and exact dependency rows are durable.
- `inspectArtifactVersion(project, versionId)` returns metadata plus an explicit content status and integrity detail.
- The project database schema records versioned migrations and foreign-keyed exact dependency references.

### Existing contracts preserved

- E01's Node.js 24 target, locked npm installation, strict TypeScript, and foreground command behavior.
- The architecture's separation between candidate artifacts and later human commitments.
- SQLite canonical records plus local artifact files; no YAML/JSON or conversation history becomes authoritative.

## 15. Reason for Depth and Zoom-Out

This is a greenfield persistence boundary, not a refactor. Its callers are the future project intake, import/source, evidence, branch, and recovery commands; their shared contract is that an exact version is readable only when its finalized bytes and metadata agree. One focused project/artifact store is justified because splitting registration across callers would duplicate the atomicity and integrity rule.

## 16. Implementation Steps

1. Bind the Node.js 24 SQLite API, create the initial schema/migration marker, and implement validated project creation/opening → verify: `npm run build && node --test --test-name-pattern='e02s01.*project|project.*schema|sqlite.*runtime' dist/test/*.test.js`
2. Implement content-addressed artifact finalization with validated paths, hashes, and immutable version records → verify: `npm run build && node --test --test-name-pattern='e02s01.*artifact|artifact.*immutable|hash' dist/test/*.test.js`
3. Register exact dependency edges in the same durable operation and expose available/missing/corrupt/unavailable inspection results → verify: `npm run build && node --test --test-name-pattern='e02s01.*depend|missing.*artifact|corrupt.*artifact' dist/test/*.test.js`
4. Exercise close/reopen and offline inspection using isolated temporary fixtures, including failed registration cleanup → verify: `npm run build && node --test --test-name-pattern='e02s01.*reopen|offline.*project|atomic.*registration' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e02s01-P0-01: Project and exact artifact state survive restart

```gherkin
Given a new local project and an artifact with explicit version and dependency inputs
When the project is closed and reopened without network access
Then the project identity, schema marker, artifact hash, version, and exact dependency references are reconstructed
And the stored bytes validate against the recorded content hash
```

### Scenario SC-e02s01-P0-02: Registration never exposes incomplete content

```gherkin
Given an artifact registration fails before or during finalization
When the project is reopened
Then no current artifact version points to incomplete bytes
And the operation reports the failure and leaves no misleading committed reference
```

### Scenario SC-e02s01-P1-03: Availability limits remain explicit

```gherkin
Given a registered artifact whose bytes are missing, corrupt, or locally unavailable
When a researcher inspects the project offline
Then the result identifies the exact version and content status
And no replacement, dependency deletion, or successful-read claim is fabricated
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project using the project-store API.
2. Register deterministic artifact bytes and one exact dependency version.
3. Close the handle, disable network access for the test process, and reopen the project.
4. Confirm the same IDs, hashes, versions, dependency edge, and available status.
5. Remove or alter a fixture byte and inspect it again; confirm missing or corrupt status is explicit.
6. Inject a registration failure and confirm reopening shows no incomplete current reference.

## 19. Risks and Mitigations

- **SQLite API drift:** verify the Node.js 24 `node:sqlite` surface before implementation and keep the adapter narrow.
- **Partial files:** finalize to a temporary path and rename before registering; cleanup failed temporary files.
- **Hash confusion:** label content identity separately from scholarly verification and preserve the observed hash.
- **Path escape:** resolve and validate all project-relative paths against the configured root.
- **Read/write mismatch:** return read-only or blocked status explicitly rather than mutating a different location.

## 20. Traceability

- Scope outcome: R02
- Epic acceptance scenarios: AC-08, AC-17
- Test-plan scenarios: SC-e02s01-P0-01, SC-e02s01-P0-02, SC-e02s01-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — artifact versions, dependencies, readiness, and SQLite concurrency obligations
- Decisions: D-09, D-15, ADR 0001
