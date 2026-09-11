# e06s01 — Immutable Local Text and Markdown Intake

## 1. Identity

- **Story ID:** e06s01
- **Epic:** e06 — Local import and source inspection
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want to import a local text or Markdown file as an exact source version so that I can inspect stable locations without losing the original or accidentally disclosing an unclassified source.

## 3. Context

E02 already stores immutable artifact bytes, hashes, versions and dependencies. E03 already treats unclassified material as local-only for external disclosure and provides scoped owner/worker capabilities. This first vertical slice adds source semantics and safe local-file intake without duplicating artifact storage or policy.

## 4. Problem

A file path alone is not a durable source identity. Reading a mutable or escaping path, normalizing away the original bytes, storing unbounded diagnostics, or auto-classifying the import would break provenance, project isolation and AC-10.

## 5. Goal

Import valid UTF-8 text and Markdown through a project- and operation-scoped capability, preserve exact original bytes as one acquired source version, record access/extraction diagnostics, and expose deterministic line and heading-path locators after reopen.

## 6. Non-Goals

- PDF, DOCX, bibliography, CSV or XLSX parsing; e06s02/e06s03 own these.
- Source matching, full inspection or downstream/viewer handoff; e06s04 owns these.
- Built-in OCR, provider retrieval, evidence/claim assessment, export, deletion or terminal presentation.
- Automatic sensitivity classification or disclosure grant.

## 7. Stakeholders

- Researchers importing local source material.
- E02 artifact/recovery consumers that require immutable bytes.
- E03 policy and capability boundaries that must remain deny-by-default.
- E07/E08 consumers that later need exact source versions and locators.

## 8. Dependencies

- Approved roadmap revision `sha256:cfa3a93975478ba685ee05fe66917a9d7e5cec40f4366082b2a9c42402b9553b`.
- E02 `registerArtifactVersion`, artifact inspection, project open/reopen and additive schema behavior.
- E03 owner/worker capabilities, classification records and disclosure gateway.
- `specs/IMPACT_LATEST.md` shared-module blast-radius assessment.
- `specs/tech-architecture/e06-TEST_PLAN_LATEST.md` scenarios SC-e06s01-P0-01 through SC-e06s01-P1-04.
- Node.js 24 standard library only; this story adds no package.

## 9. Assumptions

- Source identity uses the existing artifact `logicalId`; acquisition version uses the existing immutable artifact version label/ID.
- Valid text and Markdown inputs are UTF-8. Other encodings fail with a diagnostic rather than guessed transcoding.
- The owner capability must match the project owner. A worker capability must match the project ID and allow `source:import` plus the exact path.
- New imports intentionally have no classification or remote grant until a human records them through E03.

## 10. Constraints

- Open and inspect a regular file without following a symlink, enforce a finite byte limit, read from one descriptor, and compare pre/post `fstat` identity/size/mtime before registration.
- Use segment-aware and realpath-aware containment; lexical `startsWith` is forbidden for path authorization.
- Register exact original bytes through E02; do not write a second file path or replace an existing version.
- Keep `PROJECT_SCHEMA_VERSION` at 1 because E06 tables are additive feature tables, matching E03/E04 precedent. `createE06Schema` is idempotent and runs from new-project `createSchema`, explicit `migrateSchema`, and writable ready-project `openProject`; explicit read-only, migration-required and unknown-future opens never mutate schema. A read-only v1 project lacking E06 tables reports `source-schema-unavailable` for E06 reads.
- Persist a unique source-import operation before artifact registration using caller `commandId`, payload hash and deterministic artifact-version ID. Artifact registration remains its own durable operation; source record, all locators/diagnostics and operation completion commit in one following transaction.
- A retry with the same command ID and payload resumes after inspecting the exact artifact/hash; a changed payload or competing logical/version collision is rejected. A crash/failure may leave a visible pending import and immutable orphan artifact, but never a complete source. E06 does not garbage-collect that artifact.
- Text/Markdown locators point into the exact decoded original, so identical normalized copies are not created.
- All text spans use zero-based, start-inclusive/end-exclusive UTF-8 byte offsets into the locator's exact `artifactVersionId`; line numbers are one-based and CRLF, CR and LF are recognized without rewriting bytes. Duplicate Markdown headings carry a one-based same-parent occurrence.
- Diagnostics contain bounded codes, counts and safe basenames, never source excerpts, credentials or unrestricted paths.
- A denied/preflight-failed import creates no successful source record. Existing artifact registration recovery behavior remains unchanged.

## 11. Domain Model

- **Acquired source version:** one immutable artifact version containing the exact imported bytes plus source format/media metadata.
- **Source extraction:** status and parser provenance for inspectable text. For valid UTF-8 text/Markdown, the original artifact is itself the inspected text.
- **Source locator:** typed coordinate tied to one exact acquired source version: one-based line plus zero-based, start-inclusive/end-exclusive UTF-8 byte span; Markdown can also include a heading path with duplicate occurrence.
- **Extraction diagnostic:** bounded code, severity and safe detail describing loss, rejection or failure without embedding source content.
- **Source import operation:** idempotency/recovery record containing command ID, payload hash, deterministic artifact-version ID and `pending | complete | failed` status; only `complete` references a transactionally complete source/locator set.

## 12. Requirements

### MODIFIED: Ready-project feature schema initialization

**Before:** writable ready-project open idempotently ensured only E04 feature tables while explicit migration ensured E03/E04 tables; schema marker version 1 remained unchanged.

**After:** new-project creation, explicit migration and writable ready-project open also idempotently ensure additive E06 feature tables without changing schema marker version 1. Explicit read-only, migration-required and unknown-future opens never mutate schema, and missing E06 tables return a typed unavailable result.

### MODIFIED: Worker project-path authorization

**Before:** worker path scope used lexical prefix matching and did not itself require capability project identity, allowing sibling-prefix or symlink ambiguity.

**After:** E06 source import requires matching project identity and operation plus segment-aware lexical containment, realpath containment and no-symlink regular-file inspection. Existing valid contained reads remain allowed; invalid access is intentionally narrowed.

### ADDED: Capability-scoped source import

`importLocalSource` MUST verify owner/project identity or worker project/operation/path scope before reading. It MUST reject symlinks, non-regular files, path escapes, mutation during read and configured byte-limit breaches.

### ADDED: Immutable, recoverable source version

A successful text/Markdown import MUST register byte-identical original content through the artifact store and persist format, media type, safe original name, access level, extraction status and parser provenance against that exact artifact version. Source metadata/locators become complete atomically; same-command retries resume safely, payload conflicts reject, and pending/orphan state remains visible without a false success claim.

### ADDED: Stable local inspection

A successful import MUST persist deterministic line locators and Markdown heading paths that resolve after reopen. Invalid encoding or unsupported media MUST produce a bounded diagnostic without a successful extraction claim.

### ADDED: Local-only default

Import MUST NOT create a classification or permission. Existing E03 checks MUST therefore deny external disclosure until current destination/purpose authorization is recorded while still allowing authorized local inspection.

## 13. Non-Functional Requirements

- **Integrity:** stored original hash/length and source record remain reconstructable after reopen.
- **Security:** path checks resist sibling-prefix, `..`, symlink and wrong-project access.
- **Privacy:** unclassified content is never included in remote fallback or diagnostics.
- **Compatibility:** E01-E04 public APIs, SQLite rows and tests remain unchanged and passing.
- **Performance:** limits are injected configuration with finite defaults; tests use tiny ceilings, not large files.

## 14. Contracts

### New contracts

- `importLocalSource(handle, capability, request): SourceImportResult` imports one supported local source path under explicit `commandId`, payload identity and `SourceImportLimits`, resuming only an identical pending command.
- `inspectSourceImport(handle, commandId): SourceImportOperation` exposes pending/complete/failed recovery state without source content.
- `getSourceVersion(handle, artifactVersionId): SourceVersionRecord` returns source metadata without reading content.
- `listSourceLocators(handle, artifactVersionId): readonly SourceLocator[]` returns stable ordered coordinates.
- `listSourceDiagnostics(handle, artifactVersionId): readonly ExtractionDiagnostic[]` returns safe bounded diagnostics.

### Existing contracts preserved

- `registerArtifactVersion` remains the sole immutable byte-registration path and retains hash/path/dependency cleanup semantics.
- `classifyInput` and permission APIs remain explicit; source import does not call them.
- `requestDisclosure` remains the current-policy gateway; E06 does not weaken local-only defaults.
- Existing `readProjectPath` remains source-compatible but its valid-worker path test becomes segment-aware; invalid prefix/symlink access is intentionally narrowed.

## 15. Reason for Depth and Zoom-Out

`src/sources/source-types.ts` owns E06 source/locator/diagnostic types; `source-store.ts` owns additive SQLite mapping; `source-intake.ts` owns the trust-boundary read and artifact/source orchestration. Separate files are justified because parsing-independent records, persistence and filesystem side effects have different callers and failure contracts; no interface/factory hierarchy is introduced.

Shared modules are mapped in `specs/IMPACT_LATEST.md`:

- `src/persistence/schema.ts` serves 15 stores; E06 adds idempotent tables without rewriting E01-E04 data.
- `src/project/project-store.ts` owns create/reopen status; E06 adds latest additive schema creation without changing status semantics.
- `src/authority/capability-broker.ts` serves lifecycle/policy/decision callers; E06 narrows invalid path access and preserves all owner operations.
- `src/artifacts/artifact-store.ts` owns immutable bytes; E06 calls it rather than reimplementing writes.
- `src/index.ts` serves CLI/tests; E06 adds explicit typed exports only.

Planned tests: `tests/sources/source-import.test.ts`, `tests/integration/source-access.test.ts`, additions to `tests/authority/capabilities.test.ts`, and shared helpers in `tests/support/source-fixtures.ts`.

## 16. Implementation Steps

1. Add source-version/import-operation/locator types, exact v1 additive schema initialization paths and atomic retry/recovery coverage, reusing artifact identity/version → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s01.*(schema|source record|reopen|migration|atomic|retry|recovery|orphan)' dist/tests/*/*.test.js`
2. Harden capability-scoped file reads against sibling-prefix and symlink escapes, wrong-project use, missing operations, non-regular files, byte limits and source mutation → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s01.*(capability|path|symlink|project|limit|mutation)' dist/tests/*/*.test.js`
3. Import UTF-8 text/Markdown with exact originals, stable line/heading locators, access level and bounded diagnostics → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s01.*(text|markdown|original|locator|diagnostic)' dist/tests/*/*.test.js`
4. Prove local-only defaults, failure/redaction behavior and all released regressions → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e06s01.*(local.only|failure|redact|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e06s01-P0-01: Exact originals remain local-only

```gherkin
Given a project capability and a valid UTF-8 text or Markdown file
When the file is imported with an explicit source identity and acquisition version
Then the artifact bytes, hash, access level and transactionally complete source metadata match the input exactly
And an identical command retry returns the same exact version while a payload conflict is rejected
And external disclosure remains denied until classification and matching authorization exist
```

### Scenario SC-e06s01-P0-02: Locators survive reopen

```gherkin
Given an imported text or Markdown source with lines and headings
When the project is closed, reopened and the source is inspected
Then each line and heading-path locator resolves against the same exact source version
And no duplicate normalized byte copy is required
```

### Scenario SC-e06s01-P0-03: Filesystem attacks fail before source success

```gherkin
Given a symlink, sibling-prefix path, wrong-project capability, missing operation, non-regular file, over-limit file or file mutated during read
When import is attempted
Then access is denied or the import fails with a bounded code
And no successful source record or externally visible content is produced
```

### Scenario SC-e06s01-P1-04: Diagnostics are honest and safe

```gherkin
Given invalid UTF-8 or a mismatched unsupported extension/media declaration
When extraction is attempted
Then the result is failed or unsupported rather than complete
And diagnostics expose only bounded codes and safe metadata, not source content or unrestricted paths
```

## 18. Verification Script (Step-by-Step)

1. Create a temporary project and owner/worker capabilities with explicit source-import scope.
2. Import tiny text and Markdown fixtures; compare input bytes/hash with artifact storage and source records.
3. Close/reopen and resolve line/heading locators.
4. Request local and remote disclosure before/after explicit E03 classification/grant.
5. Exercise sibling-prefix, symlink, wrong-project, missing-operation, mutation, size, media and encoding failures.
6. Run all E01-E04 tests under Node.js 24.

## 19. Risks and Mitigations

- **Capability path escape:** replace lexical prefix checks with shared segment-aware containment plus realpath/symlink tests.
- **TOCTOU source replacement:** read one descriptor and compare `fstat` before/after.
- **Partial registration:** a durable command/payload operation brackets artifact registration; source+locator completion is one transaction, same-command retry resumes, and pending/orphan artifacts remain visible but never masquerade as complete sources.
- **Diagnostic leakage:** use enumerated codes/counts and safe basename only.
- **Duplicate storage:** locate valid text/Markdown directly instead of creating an identical derived copy.

## 20. Traceability

- Scope outcome: R06
- Epic acceptance scenarios: AC-10, AC-20
- Test scenarios: SC-e06s01-P0-01, SC-e06s01-P0-02, SC-e06s01-P0-03, SC-e06s01-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` global invariants 2–5 and artifact/deletion concurrency
- Architecture: `specs/docs/04-system-architecture.md` §§4, 5, 9 and 10
