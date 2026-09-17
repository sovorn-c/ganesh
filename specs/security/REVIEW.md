# e01 security review

**Pass-2 status:** historical blocker resolved. Later whole-epic review evidence is recorded in `specs/verifications/e01-review-pass-3.yaml`, `specs/verifications/e01-review-pass-4.yaml`, and `specs/verifications/e01-review-pass-7.yaml`; the e01 release was completed locally after pass 7.

## Scope

The review covered the complete `feat/e01-runtime-baseline` branch, including the preflight CLI, clean-install process, package metadata, local plan-consistency tooling, and diagnostic output.

## Resolved finding

- **`scripts/lib/extract-story-verify.rb:22,32` — HIGH — unsafe deserialization.** The first review found `YAML.load_file` on project-controlled epic and task files. The extractor now uses Ruby-compatible safe parsing:

```ruby
document = YAML.safe_load(File.read(epic_path), [], [], false) || {}
```

The same safe loader is used for task ledgers. A full Ruby `YAML.safe_load` scan of `specs/**/*.yaml` and the plan-consistency gate both pass after the correction.

## Checks

- `npx --yes --package=node@24 npm audit --audit-level=high`: passed; 0 vulnerabilities.
- Credential-pattern scan over tracked source: no matches.
- Application paths inspected for command injection, path traversal, secret leakage, and unsafe network/auth sinks: no additional high-confidence finding.
- `bash scripts/bp-timing.sh start verify-work`: passed after repairing the state YAML gate.

## Pass-2 limitation

The section above records the resolved pass-2 security finding and its checks. It is historical evidence, not an independent release approval; current pass-4 checks are recorded below.

## Pass-4 correction review

- `npm audit --audit-level=high`: passed; 0 vulnerabilities under Node.js 24.20.0.
- Credential-shaped literal scan and changed-file unsafe-sink spot check: passed.
- The correction only adds narrow CLI argument validation, a deterministic unsupported-runtime fixture, standard-library status parsing, and regression checks. No external API, auth, or research-data path was introduced.
- Request-review was not run because subagents, interactive forks, and filesystem worktrees were prohibited for this fallback review. This is a process limitation, not an independent security approval.

## Pass-7 current-branch release evidence

- The fresh whole-epic review pass 7 covered the current `feat/e01-runtime-baseline` branch after the coverage and whitespace corrections.
- `npm audit --audit-level=high`, credential-pattern scanning, and unsafe-sink scanning passed under Node.js 24 with no unresolved high-confidence findings.
- The current review artifact is `specs/verifications/e01-review-pass-7.yaml`; release and merge were not performed during that review.

## e02 security review pass 1

- Scope: complete `feat/e02-durable-projects` diff from `main`, including SQLite persistence, artifact finalization, branch history, dependency impact, and recovery.
- `npm audit --audit-level=high`: passed; 0 vulnerabilities under Node.js 24.
- Credential-shaped literal and unsafe-sink spot checks: passed; no secrets, network sinks, shell interpolation, unsafe deserialization, or unparameterized SQL were introduced.
- Artifact paths use validated relative paths, canonical-parent checks, symlink rejection, temporary files, and no-clobber finalization. Recovery traverses only non-symlink entries.
- No unresolved HIGH-confidence finding. Request-review was not run because subagents, interactive forks, and worktrees are prohibited by the project workflow.

## e04 security review — local verification

- Scope: E04 decision packets, owner dispositions, commitments, readiness, alternative adoption, scholarly findings, overrides, gate composition, additive SQLite schema, and public exports on `feat/e04-human-commitments`.
- Owner actions use the trusted non-serializable capability boundary and exact project-owner matching. Forged capability-shaped objects are rejected before mutation.
- SQL inputs are bound parameters. Dynamic `IN` clauses use placeholder counts derived only from validated artifact IDs; no shell, network, or template execution sinks were introduced.
- Packet, decision, readiness, impact, dissent, and gate records retain references and metadata only. Tests assert restricted artifact content is not returned in decision results.
- Additive schema creation is idempotent and includes a compatibility check for the new readiness action column. `npm audit --audit-level=high` reports 0 vulnerabilities under Node.js 24.
- No high-confidence security finding was identified in the local spot check. A fresh independent request-review remains pending because the fork/subagent facility is unavailable in this session; this is a process limitation, not a release approval.

## e06 security review — local release gate

- **Scope:** Current `feat/e06-source-intake` diff from `main` at `72e063f`, covering source intake, document and structured parsers, worker entry points, path authorization, additive schema changes, disclosure operation typing, and pinned dependencies.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high` and `npm audit --omit=dev` both reported `found 0 vulnerabilities`.
- **Input and execution boundaries:** `src/sources/source-intake.ts` performs capability validation, realpath containment, regular non-symlink checks, stable-file reads, and bounded bytes before registration. `src/sources/parser-worker.ts`, `src/sources/parser-worker-runtime.ts`, `src/sources/structured-worker.ts`, and `src/sources/structured-worker-runtime.ts` use terminable workers with finite time, memory, archive, output, and field limits. No E06 source path imports `child_process`, network clients, or dynamic code execution.
- **Parser safety:** `src/sources/document-parser.ts` disables Mammoth external file access and image output; `src/sources/structured-parser-runtime.ts` scans OOXML relationships, formulas, hyperlinks, and active-content markers without evaluating or fetching them. `src/sources/archive-preflight.ts` applies nullish-safe finite defaults when optional limits are omitted.
- **Persistence and authorization:** Changed E06 SQL uses prepared statements with bound values; source inspection and disclosure handoff retain metadata-only behavior and current capability checks. Exact source-to-derived artifact dependencies are recorded.
- **Credential/sink checks:** Tracked-source credential-pattern scan found no matches. Review of changed E06 modules found no shell, network, unsafe deserialization, or unparameterized user-controlled SQL sink. The `fetch`/URL strings found outside the E06 diff are existing policy regression fixtures, not executable E06 paths.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the E06 local merge. This is a local security gate, not a production-readiness or scholarly-validity claim; remote CI and the separate release-check gate remain outside this local release.

## e05 security review — local release gate

- **Scope:** Current `feat/e05-bounded-work` diff from `main` at `ff40bf6`, covering work contracts, capabilities, lifecycle/disclosure checkpoints, additive schema, budget accounting, cancellation/quarantine, provider attempts, and session rebinding.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high --omit=dev` reported `found 0 vulnerabilities`.
- **Authority and policy:** `src/work/work-runtime.ts` requires owner/worker capabilities, checks current dispatch and external policy immediately before each provider effect, and records denied attempts without fallback. `src/work/session-adapter.ts` rejects submissions from replaced sessions. No E05 path grants owner operations to workers.
- **Persistence and SQL:** E05 queries in `src/work/work-runtime.ts`, `src/work/work-store.ts`, `src/work/budget-ledger.ts`, and `src/work/specialist-coordination.ts` use prepared statements with bound values; no attacker-controlled SQL interpolation was found.
- **Execution and secrets:** E05 source imports no `child_process`, network client, dynamic code execution, or credential-shaped literal. Provider tests use injected fakes; no network or live provider is opened.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the E05 local merge. This is a local security gate, not a production-readiness or scholarly-validity claim; remote CI and the separate `release-check` gate remain outside this local release.

## e14 security review — local implementation gate

- **Scope:** Current E14 workspace implementation landed on `main`, covering project-folder intake, project-local Pi runtime binding, trusted exact-version confirmation, source inspection and local viewer handoff, live work status/cancellation, keyboard maps, and access-path qualification.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high` reported `found 0 vulnerabilities`.
- **Authority and policy:** Workspace confirmation and cancellation delegate to existing E04/E05 owner-gated APIs. Forged, worker, chat and unbound paths are rejected by tests; no new authority source was introduced.
- **Path and process boundaries:** Intake rejects missing, non-directory, unreadable, symlink and escaping folders. Viewer handoff requires current source authorization, verified integrity, local destination, artifact-root containment, and argument-vector spawning with `shell: false`.
- **Isolation:** Pi state is bound to `<project>/.ganesh/pi`; the workspace does not mutate global `~/.pi` configuration. Runtime loading sets `noExtensions: true` and supplies only the inline Ganesh extension. Runtime and TUI dependencies are injected in tests, with no live provider spend.
- **Correction state:** The initial self-audit was superseded by independent reviews that identified reachable-status/keyboard wiring, duplicate command IDs, process lifecycle, project-extension trust and symlinked-parent gaps. The authorized correction cycle adds explicit non-conflicting Pi shortcuts and commands, stable confirmation IDs, process-exit cleanup, `noExtensions`, realpath containment for both project store and Pi state, and fail-closed access qualification.
- **Verdict:** Dual independent iteration-4 review PASS; no unresolved high-confidence security finding identified. This is a local implementation gate, not a production-readiness or scholarly-validity claim; remote CI, publishing, deployment and the separate `release-check` gate remain outside this local release.

## e07 security review — local build spot check

- **Scope:** E07 evidence items, claim records, citation verification, matrix/reassessment overlays, appraisal/synthesis persistence, additive schema initialization, public exports, and capability/project boundaries on `feat/e07-evidence-claims` at `fb3b7be`.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --omit=dev` reported `found 0 vulnerabilities`.
- **Authority and persistence:** E07 recording, inspection, linking, notice, appraisal, and synthesis paths require the existing owner/worker capability checks and project binding. Changed SQL uses prepared statements with bound values; schema DDL is developer-authored and additive.
- **Input and execution boundaries:** The changed E07 source imports no shell, network client, dynamic code execution, or unsafe deserializer. Credential-shaped literal scanning found no matches. The repository's documented CWE fixture-sync helper is absent, so that auxiliary preflight could not run; no high-confidence finding was identified by the local changed-file spot check.
- **Process limitation:** Independent `pi-fork` review was not run because the `pi-fork` executable/extension is unavailable in this session. This section is local security evidence only, not an independent review or release approval.

## e07 security review — final local release gate

- **Scope:** E07 branch `feat/e07-evidence-claims` at reviewed commit `7fd0116`, covering located evidence, citation identity/support separation, claim and evidence authority, matrix/source-notice reassessment, appraisal/synthesis, retry idempotency, schema guards and the fallback corrections.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --omit=dev --audit-level=high` reported `found 0 vulnerabilities`.
- **Boundary checks:** E07 changed source uses prepared SQL and imports no shell, network client, dynamic code execution or unsafe deserializer. Citation identity is derived only from persisted E06 bibliographic records; caller metadata is ignored. Worker-origin claims/appraisals remain `specialist-proposed`, and owner commitment APIs are not called.
- **Correction checks:** Source-notice reassessment overlays survive support recomputation; empty command IDs are rejected; appraisal/synthesis reads guard missing E07 schema; complete command payload conflicts reject changed retries. Regression tests cover each boundary.
- **Tooling limitation:** `scripts/verify-cwe-fixture-sync.sh` is absent from this checkout, so that auxiliary fixture-sync check could not run. This is not treated as a product security finding.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the reviewed local E07 merge. This is local security evidence only, not production-readiness or scholarly-validity approval; remote CI and the separate `release-check` gate remain outside this local release.

## e08 security review — final local release gate

- **Scope:** E08 literature protocol/query/landscape records, injected retrieval and coverage limits, snapshot replay, citation exploration, screening/amendments, gap/counter-search, E07 challenging-link integration, additive schema/disclosure changes, and authority boundaries on `feat/e08-literature-contribution` at reviewed commit `78c0f61`.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --omit=dev --audit-level=high` reported `found 0 vulnerabilities`.
- **Boundary checks:** The reviewed E08 paths use capability/project checks, prepared persistence, no network imports under `src/literature/**`, no `fetch`, `node:http`, `node:net`, or `node:dns`, no live retrieval SDK, and no commitment or scholarly-finding writes. Counter-search revalidates query scope and requires the capabilities needed to create E07 challenging links.
- **Correction checks:** Query/corpus retry hashes include requested IDs; query lineage is protocol-bound and complete in artifact content. Local-only retrieval and paywall results remain disclosure/coverage-limited, and no universal novelty or exhaustive coverage status is emitted.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the reviewed local E08 merge. This is local security evidence only, not production-readiness, scholarly-validity, universal-novelty or exhaustive-coverage approval; remote CI and the separate `release-check` gate remain outside this local release.

## e16 security review — final local release gate

- **Scope:** Current `feat/e16-operations-reliability` changes covering operational diagnostics, opt-in diagnostic export, provider admission/retry/cancellation, budget and retention limits, source-import diagnostics, additive schema, CLI validation, and local runbooks.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --omit=dev --audit-level=high` reported `found 0 vulnerabilities`.
- **Boundary checks:** Changed SQL uses bound parameters; provider calls remain capability- and policy-gated; diagnostics and source-import metadata are redacted at write and read boundaries; diagnostic export rejects unsafe paths, symlinks, and integrity mismatches; CLI numeric limits are fail-closed. No changed path introduces shell execution, network access, dynamic code evaluation, or unsafe deserialization.
- **Review evidence:** Independent whole-epic review passed after corrections. Full compiled tests passed 275/275, with lint, typecheck, build, preflight, and `git diff --check` passing. Preflight emitted only the documented `execution-mode` not-configured warning.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the E16 local merge. This is local security evidence only, not production-readiness, scholarly-validity, publishing, deployment, or remote-CI approval.

## e09 security review — local verification gate

- **Scope:** Complete E09 diff on `feat/e09-method-sensitive-design` from `main`, covering orientation, problem framing, research question alternatives, constructs, theoretical frameworks, positionality attribution, design comparison, sampling/instrument/pilot operationalization, method profiles, alignment audits, and analysis plans across `src/methodology/**`.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high` reported `found 0 vulnerabilities`. Pinned dependencies unchanged; no external packages added.
- **Authority and capability enforcement:**
  - Owner-only actions enforce `createOwnerCapability` validation (`recordOrientation`, `recordProblemFraming`, `recordResearchQuestionAlternative`, `recordConstruct`, `recordTheoreticalFramework`, `recordPositionality`, `recordDesignComparison`, `updateDesignComparison`, `recordSamplingPlan`, `recordInstrument`, `recordPilotPlan`, `bindMethodProfile`, `recordAlignmentAudit`, `recordAnalysisPlan`).
  - Worker capabilities require exact project matching, non-forged structures, and explicit operation grants (`methodology:frame`, `methodology:design`, `methodology:audit`, `methodology:inspect`). Forged, wrong-owner, wrong-project, and unprivileged worker tokens fail closed with `forbidden`.
  - Positionality attribution strictly prevents workers from asserting `human-stated` identity (`forbidden`), preserving human-stated stance as an owner-only authority; worker stance defaults to `agent-inferred`.
  - All mutating store entry points enforce `assertWritable(handle)` to guarantee read-only project handles fail closed before state mutation.
  - Inspection functions enforce `handle.assertCurrent()` and `assertMethodologyAccess(..., "methodology:inspect")`.
- **Input validation and referential integrity:**
  - `validateRqVersionIds` validates existence of referenced research question version IDs in the project database and enforces orientation consistency across multi-RQ inputs.
  - Framing IDs and supersession references (`supersedesId`) validate target record existence and orientation containment; cross-orientation references fail closed with `invalid-argument`.
  - Design comparisons validate that at least two designs are supplied, and that sampling plans, measurement instruments, and pilot plans reference valid comparisons and registered design option IDs within those comparisons.
  - Instruments validate that optional construct IDs exist in the project database.
  - Alignment audits and analysis plans validate comparison existence and question-chain orientation consistency.
- **Persistence and SQL safety:**
  - All SQLite operations use prepared statements with bound parameter vectors (`?` placeholders). No user input is interpolated into SQL queries or schema DDL.
  - Ordering across all inspect and list queries uses deterministic persisted tie-breaks (`ORDER BY created_at DESC, rowid DESC` for singular latest queries; `ORDER BY created_at ASC, rowid ASC` for collections).
  - Additive schema creation via `createE09Schema` is idempotent, does not increment marker version 1, and operates within the single project SQLite database without creating external files or auxiliary databases.
- **Execution and network boundaries:**
  - Sampling, instrument, and pilot plan records are purely declarative research designs. Non-execution is strictly enforced: actions matching `execute`, `recruit`, `contact`, `consent`, or `collect` fail closed with `recruitment-not-executed`.
  - Analysis plans enforce non-execution (`confirmatory` vs `exploratory` plan records without runtime dispatch or computation).
  - No E09 source file imports `child_process`, `node:http`, `node:https`, `node:net`, `node:dgram`, `fetch`, or live AI providers. No shell command execution or remote network communication exists.
- **Unavailable tooling / process limitations:**
  - `scripts/verify-cwe-fixture-sync.sh` is absent from this repository checkout.
  - `skills/enforce-first` and `skills/request-review` are unavailable in this solo-git build session where subagents, interactive forks, and external review worktrees are prohibited.
  - These are recorded as explicit process limitations, not fabricated as passes.
- **Verdict:** No unresolved HIGH-confidence security finding (confidence ≥8) identified for the E09 local build. Process limitations recorded; this is local security evidence only, not production-readiness, scholarly-validity, or release approval.

## e10 security review — local release gate (2026-09-15)

- **Scope:** Current `feat/e10-ethics-authorization` changes from local `main` at `6f03cda`, including the E10 ethics stores, additive schema, capability hardening, lifecycle authorization checks, work admission, and decision/readiness integrations.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high` reports `found 0 vulnerabilities`; no package or lockfile changes were introduced.
- **Authority and authorization:** Owner construction is factory-bound and owner instances are tracked with a private `WeakSet`; ethics writes and external authorization transitions require the current project's trusted owner capability. Worker access remains project-scoped and operation-scoped; workers cannot record owner attribution, owner origin, current guidance, consultation completion, or external grants. Named activity checks read the project-local registry and fail closed for absent, pending, unknown, expired, withdrawn, malformed, or out-of-scope authorization. Lifecycle and queued work bind activity and authorization context to persisted snapshots/contracts, preventing caller relabeling.
- **Persistence and SQL safety:** Changed SQLite queries use bound parameters. The only interpolated schema identifiers are developer-authored constants passed to `ensureE10Column`; no user-controlled value reaches SQL, shell, filesystem, template, or dynamic-code sinks. JSON parsing is limited to project-local persisted records and operation snapshots; malformed persisted authorization provenance is handled as denial.
- **Input and data boundaries:** Evidence references are checked against artifact versions in the same project. E10 records are metadata-only artifacts and do not add disclosure, deletion, diagnostic-purge, recruitment, contact, consent, collection, or analysis execution authority. Guidance records are owner-supplied and do not fetch live sites or bundled manuals. Data-management plans re-evaluate current E03 policy and cannot mint grants.
- **Credential, network, and sink checks:** Credential-pattern scan over `src`, `tests`, and `scripts` found no matches. Changed E10 paths import no shell, network client, unsafe deserializer, or dynamic code execution. No unresolved high-confidence vulnerability (confidence ≥8) was identified.
- **Process limitations:** The repository has no `scripts/verify-cwe-fixture-sync.sh`, `scripts/land-branch.sh`, or CI workflow helper; this release is explicitly local-only. These limitations are not treated as remote-CI, production-readiness, or institutional authorization approval.
- **Verdict:** PASS for the local security gate; no unresolved HIGH-confidence finding. This is local security evidence only and does not satisfy the separate production `release-check` gate.

## e12 security review — local release gate

- **Scope:** Current `feat/e12-study-progress` changes covering protocol progress, amendments, deviations, consultations, lifecycle/work admission, and additive schema persistence.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high` reports `found 0 vulnerabilities`; no dependencies changed.
- **Authority and data boundaries:** E12 reads and writes require capability and project checks. Owner-only protocol adoption requires an active E04 commitment; workers cannot bind protocols or authenticate reported prior commitments. Reported execution and prior commitments remain attributed evidence and cannot create commitments, grants, or analysis runs.
- **Persistence and currency controls:** Protocol, amendment, deviation, progress, and reported-prior history is append-only. Material scope flags are fail-closed, impact records retain direct protocol references and branch-local dependents, and protocol currency is rechecked at queue and lifecycle-resume boundaries. Dynamic impact table names are compile-time allowlisted; row values use bound parameters.
- **Credential, network, and sink checks:** Changed E12 paths introduce no shell, network, disclosure, or restricted-workspace paths, and no secrets or unsafe deserialization. The reviewed E12 verification reports 418 full tests passing, with build, typecheck, lint, preflight, and coverage gates passing.
- **Process limitations:** `scripts/land-branch.sh` and the CWE fixture-sync helper are absent; this is a local-only integration and does not claim remote CI or production readiness.
- **Verdict:** PASS for the local security gate; no unresolved HIGH-confidence finding (confidence ≥8). This is local security evidence only and does not satisfy the separate production `release-check` gate.

## e11 security review — local release gate (2026-09-17)

- **Scope:** Current E11 isolated-analysis changes on `feat/e11-isolated-analysis`, including execution-mode policy, guarded local command execution, provenance-recorded analysis runs, tool/package probing, method diagnostics, external-output reproduction, additive schema fields, and project integration.
- **Runtime and dependency evidence:** Node.js `v24.21.0`; `npm audit --audit-level=high` and `npm audit --omit=dev` both report `found 0 vulnerabilities`; no package or lockfile changes were introduced.
- **Authority and execution controls:** Owner capabilities are required for policy, command, installation, analysis, and reproduction mutations. Worker capabilities are restricted to metadata-only probes and redacted diagnostics; forged, wrong-owner, star-worker, unconfigured-mode, and escalation paths are denied before execution. Commands use `spawnSync` with `shell: false`, an explicit allowlist, project-scoped working directories, and bounded environment data.
- **Persistence and provenance:** Analysis inputs, scripts, parameters, environments, output digests, reported/reproduced state, and diagnostics remain project-scoped persisted records. Reproduction verifies artifact availability and integrity before comparison; failed, unavailable, cancelled, or unverified output cannot become a successful analysis claim. Changed SQL uses fixed statements or bound values; schema identifier interpolation is restricted to developer-authored constants.
- **Credential, network, and sink checks:** E11-specific changed source, tests, and tooling contain no credential-shaped literals. No E11 path imports a network client, unsafe deserializer, dynamic code execution, disclosure sink, or unrestricted shell execution. The repository-wide scan's matching strings are existing synthetic redaction/security fixtures outside the E11 change set.
- **Process limitations:** `scripts/land-branch.sh`, `scripts/verify-cwe-fixture-sync.sh`, and remote CI helpers are absent. This is a local-only security gate and does not claim remote CI, production readiness, institutional authorization, or scholarly validity.
- **Verdict:** PASS for the local security gate; no unresolved HIGH-confidence finding (confidence ≥8). This is local security evidence only and does not satisfy the separate production `release-check` gate.
