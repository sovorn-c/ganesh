# e15s01 — Versioned Project Export with Integrity and Current Permissions

## 1. Identity

- **Story ID:** e15s01
- **Epic:** e15 — Recovery portability and controlled deletion
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 8
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a project owner, I want to export a versioned project packet that checks integrity and current permissions, so that I can move permitted history without shipping restricted bytes or treating chat backup as the project.

## 3. Context

E02 already stores SQLite canonical state and hashed artifact bytes. E03 already classifies material and authorizes the existing `export` disclosure kind. E04 already records commitments. This first vertical slice writes a portable directory packet without restoring, deleting, or claiming that writing-format files are complete project history.

## 4. Problem

Copying `.ganesh/` by hand, zipping without a manifest, or exporting under a withdrawn grant would either leak restricted bytes or produce a packet that cannot be checked. A fluent Markdown dump is not a project snapshot.

## 5. Goal

Give the matching owner a command that writes a directory packet with schema version, per-file hashes, omission notices and reconstructable permitted commitments and evidence locators, evaluated against current policy at export time.

## 6. Non-Goals

- Restore, backup snapshots, restore drills and `migrateWithBackup`; e15s02 owns those.
- Crash, disk-full, corruption and inter-process locking; e15s03 owns those.
- Deletion and tombstones; e15s04 owns those.
- Stale-restore versus withdrawn grants; e15s05 owns those.
- Markdown/DOCX/BibTeX/CSV writing exporters and supervisor review packets; E13 owns those.
- TUI commands and native viewers; E14 stays unmodified.
- zip/tar packages, cloud backup SDKs and a second database.

## 7. Stakeholders

- Owners moving a project folder to another disk or machine.
- e15s02 restore, which consumes this packet layout.
- E03 policy and capability boundaries that must remain deny-by-default.
- Reviewers checking AC-20 omission notices.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E02 `registerArtifactVersion`, reopen and additive schema behavior.
- E03 `requestDisclosure` with operation `export`, owner identity match and `protectCanonicalWrite`.
- E04 `listCommitments` as a reader, not a writer.
- `specs/IMPACT_LATEST.md` shared-module blast-radius assessment.
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` scenarios SC-e15s01-P0-01 through SC-e15s01-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- A project packet is a directory, not an archive file. Layout: `ganesh-project-packet.json`, a copied `project.sqlite`, and permitted files under `artifacts/`.
- Packet kind is `project`. Review packets remain E13.
- Destination `local` may include classified local-only bytes that current policy still allows locally. Any non-`local` destination must call `requestDisclosure` per included source version and omit denied bytes.
- Origin of the export command is owner-only. Workers, including `allowedOperations: ["*"]`, are denied.
- `PROJECT_SCHEMA_VERSION` stays 1. E15 tables are additive feature tables.
- Export copies commitment rows and evidence locators; it does not create a new human commitment.

## 10. Constraints

- `exportProject` MUST persist a unique portability operation before completion using caller `commandId` and payload hash. Same-command retries resume; a changed payload is rejected. Pending state remains visible and never claims a complete packet.
- The manifest MUST include schema version, project id, created-at, destination, purpose, included file relative paths with sha256, and an `omissions` array of `{ artifactVersionId, reason }`.
- Included file hashes MUST match bytes on disk at write time. The copied SQLite file is hashed too.
- Diagnostics and errors contain bounded codes and safe identifiers, never restricted artifact bytes, credentials or unrestricted paths.
- `src/workspace/**` MUST NOT change.
- Keep `PROJECT_SCHEMA_VERSION` at 1. `createE15Schema` is idempotent and runs from new-project `createSchema`, explicit `migrateSchema`, and writable ready-project `openProject`. Explicit read-only, migration-required and unknown-future opens never mutate schema. A read-only v1 project lacking E15 tables reports `portability-schema-unavailable` for E15 reads.

## 11. Domain Model

- **Project packet:** directory snapshot of permitted project records and referenced artifacts with an integrity manifest. Distinct from a conversation backup and from a review packet.
- **Omission notice:** recorded reason that an artifact version's bytes were not copied.
- **Portability operation:** idempotency/recovery record containing command ID, payload hash and `pending | complete | failed` status.

## 12. Requirements

### MODIFIED: Ready-project feature schema initialization

**Before:** writable ready-project open idempotently ensured E04, E06, E05, E07 and E08 additive tables while schema marker version 1 remained unchanged. `createSchema` and `migrateSchema` ensured E03 through E08.

**After:** new-project creation, explicit migration and writable ready-project open also idempotently ensure additive E15 portability tables without changing schema marker version 1. Explicit read-only, migration-required and unknown-future opens never mutate schema, and missing E15 tables return a typed unavailable result.

### ADDED: Capability-scoped project export

`exportProject` MUST verify `OwnerCapability` whose `ownerId` matches `project.ownerId` and MUST run inside `protectCanonicalWrite`. Workers and forged callers MUST be denied before any packet directory is created.

### ADDED: Integrity manifest

A successful export MUST write `ganesh-project-packet.json` with schema version, per-included-file sha256 and omission notices, then copy only included artifact bytes and a SQLite snapshot.

### ADDED: Current-permission evaluation

Export MUST call `requestDisclosure` with operation `export` for each candidate source version when destination is not `local`. Denied versions MUST appear in `omissions` and MUST NOT appear under `artifacts/`.

### ADDED: Permitted history is copied, not re-approved

The packet MUST include permitted commitment identifiers and evidence locators. Export MUST NOT call `recordOwnerDecision` or insert `scholarly_findings`.

## 13. Non-Functional Requirements

- **Integrity:** packet files reconstruct after the source project is closed; hashes match included bytes.
- **Security:** forged, wrong-owner and worker callers cannot write another project's packet.
- **Privacy:** restricted bytes are omitted with a notice; diagnostics do not copy them.
- **Compatibility:** E01–E08 and E14 public APIs, SQLite rows and tests remain unchanged and passing.
- **Honesty:** a packet is not a claim that omitted licensed sources may be redistributed.

## 14. Contracts

### New contracts

- `exportProject(handle, capability, request): ProjectPacket` writes one directory packet under explicit `commandId`, `destinationPath`, `destination` and `purpose`.
- `inspectProjectPacket(packetPath): ProjectPacketInspection` reads the manifest and verifies included hashes without opening the source project as writable.
- `getPortabilityOperation(handle, commandId): PortabilityOperation` exposes pending/complete/failed recovery state.
- `createE15Schema(db)` creates additive portability tables.

### Existing contracts preserved

- `requestDisclosure` remains the disclosure oracle; E15 does not add an enum value.
- `recordOwnerDecision` and `listCommitments` remain unused as writers.
- `src/workspace/**` remains unmodified.
- `migrateSchema(root)` still migrates a v0 marker to v1 for released tests.

## 15. Reason for Depth and Zoom-Out

`src/portability/portability-types.ts` owns E15 types; `src/portability/export-store.ts` owns packet write and manifest hashing. Separate files are justified because type contracts and filesystem/SQLite side effects have different callers; no interface/factory hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`:

- `src/persistence/schema.ts` serves existing stores; E15 adds idempotent tables without rewriting E01–E08 data.
- `src/project/project-store.ts` owns create/reopen status; E15 adds latest additive schema creation without changing status semantics.
- `src/artifacts/artifact-store.ts` owns immutable bytes; E15 copies permitted files and does not rewrite hashes.
- `src/index.ts` serves CLI/tests; E15 adds explicit typed exports only.

Planned tests: `tests/portability/project-export.test.ts`, `tests/integration/portability-authority.test.ts`, and shared helpers in `tests/support/portability-fixtures.ts`.

## 16. Implementation Steps

1. Add portability types, exact v1 additive E15 schema initialization paths, atomic command/payload completion and a directory packet writer with hashes → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s01.*(schema|packet|hash|reopen|migration|atomic|retry)' dist/tests/*/*.test.js`
2. Harden owner-only export against forged, wrong-owner and worker callers, and prove no new security findings in affected authority paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s01.*(capability|forged|worker|wrong-owner|denied|authority)' dist/tests/*/*.test.js`
3. Omit restricted and local-only-to-remote bytes with explicit omission notices and absent artifact paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s01.*(omission|restricted|local-only|remote)' dist/tests/*/*.test.js`
4. Evaluate current disclosure at export time, copy permitted commitments and locators without creating decisions, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e15s01.*(withdrawn|commitment|locator|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e15s01-P0-01: Packet survives close with matching hashes

```gherkin
Given an owner capability for a ready project with permitted artifacts and a commitment
When exportProject writes a directory packet
Then ganesh-project-packet.json names schema version 1 and sha256 for each included file
And inspectProjectPacket succeeds after the source project is closed
And an identical command retry returns the same packet while a payload conflict is rejected
```

### Scenario SC-e15s01-P0-02: Capability attacks fail before packet success

```gherkin
Given a forged capability, wrong-owner capability or worker capability
When export is attempted
Then access is denied
And no packet directory or portability row is completed
```

### Scenario SC-e15s01-P0-03: Restricted bytes are omitted with a notice

```gherkin
Given a local-only classified artifact and a non-local export destination
When exportProject runs
Then the artifact path is absent from the packet artifacts directory
And omissions records that artifactVersionId and a bounded reason
And included file hashes do not cover the omitted bytes
```

### Scenario SC-e15s01-P1-04: Current policy wins over an older snapshot name

```gherkin
Given an artifact named by an older branch snapshot whose grant is now withdrawn
When exportProject runs for a remote destination
Then the withdrawn artifact is omitted
And no new human commitment or scholarly finding is inserted
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project, register a public artifact, classify/grant it for local use, and record one E04 commitment if the fixture allows a legal owner decision.
2. Export to a sibling directory with destination `local`.
3. Close the source handle, inspect the packet, and match hashes.
4. Retry the same commandId and then retry with a changed destinationPath.
5. Attempt forged, wrong-owner and worker exports.
6. Classify a second artifact local-only and export with destination `external-repo`.
7. Confirm the second artifact is omitted.
8. Withdraw a grant and export again; confirm omission.
9. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Archive-format creep:** keep a directory packet; reject zip/tar packages.
- **Stale permission copy:** evaluate `requestDisclosure` at export time, not at original import time.
- **Partial packet:** a durable command/payload operation brackets completion; pending never masquerades as complete; delete an incomplete destination directory on failure.
- **Authority bypass:** workers never export; owners remain identity-matched.
- **TUI drift:** do not edit `src/workspace/**` in this story.

## 20. Traceability

- Scope outcome: R15
- Epic acceptance scenarios: AC-20 (project packet export and omission)
- Test scenarios: SC-e15s01-P0-01, SC-e15s01-P0-02, SC-e15s01-P0-03, SC-e15s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` invariant 11 and artifact/export concurrency row; D-09, D-15
- Language: Project snapshot, Review packet as a distinct later object, Data-use permission
