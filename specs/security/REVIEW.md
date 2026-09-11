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
