# Ganesh — Technical Context and Research Domain

## Implementation and organization

Use [../execution-status.yaml](../execution-status.yaml) for delivery status and [../state.yaml](../state.yaml) for the next action. The domain model below defines invariants; it does not prove that every target capability exists.

The current implementation uses TypeScript, Node.js 24, SQLite project state, and local artifact files. Source entrypoints remain at `src/`; implementation modules now live in responsibility folders. Tests now live under `tests/` in matching responsibility folders and use behavior-based names.

The owner-approved organization refactor is implemented, verified, and reviewed on `main`. Public exports, executable entrypoints, SQLite contracts, and observable behavior remain unchanged. E01–E08 and E14 are complete local releases. The E15 plan revision `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2` is owner-approved; implementation starts only on `/bp-build`.

## Repository organization contract

Follow [../../CONVENTIONS.md](../../CONVENTIONS.md) for naming, module boundaries, test placement, and document ownership. Organize by domain or runtime responsibility, never by release epic.

Tests should mirror source responsibilities under `tests/`, with behavior-based names. Use integration tests for cross-boundary behavior. Keep story IDs in supported traceability metadata rather than filenames.

The approved refactor plan mapped existing files to responsibilities, inspected dependencies, and specified import boundaries. Future moves or new responsibility folders still require an approved plan; do not create speculative modules.

Preserve public APIs, runtime behavior, stored data, authority enforcement, and existing test coverage. Update active verification paths, test discovery, and tooling in the same migration; keep historical evidence truthful.

## Planning signals

- Start E15 implementation only from `/bp-build` against owner-approved plan revision `sha256:d59814789d82d38207eb239c3f97fcacafb99a9909ece606788eb0cc73bde5e2`.
- Reuse the existing manifest, lockfile, and Node.js 24 commands.
- Run applicable checks in the foreground under Node.js 24, not the host Node.js 26.
- Keep work in the current workspace; use an authorized branch and no automatic commits or pushes.
- Treat placement and dependency review as required review checks, not as an already implemented automated gate.

## Approved target architecture (not observed)

TypeScript/Node.js 24 LTS, Pi SDK with reused Pi terminal UI, SQLite canonical state, local artifact files, bounded specialist sessions, and user-controlled language-agnostic local execution through Pi-compatible permission modes.
This target is a planning decision, not an implementation finding; prior Pi SDK compatibility work is treated as settled.

This document also owns domain relationships, invariants, and legal transitions.
The canonical glossary lives in `../UBIQUITOUS_LANGUAGE_LATEST.md`; the product glossary file points to it.
Selected interface decisions live in [DESIGN_PLAN_LATEST.md](DESIGN_PLAN_LATEST.md) and [ADR 0002](../adr/0002-focused-authority-separated-commands.md).
Technical deployment proposals remain in `../docs/04-system-architecture.md`.
Human commitments, data-use permissions, and work contracts/runs are logical responsibilities in one application, not services.
No measured code-deepening opportunity applies to the released E01 runtime baseline; e02 domain modules are not implemented yet.

## Language

**Human commitment**: The project owner's recorded adoption of exact research artifact versions.

**Readiness**: The current eligibility of a specified research action under dependencies, policy, evidence availability, and external conditions.

**Research branch**: An alternative set of research artifact versions and dependencies within a project.

**Impact review**: An assessment of how an adopted change affects dependent work.

## Relationships

- One human commitment references one exact decision-packet version and its selected artifact versions.
- One artifact version has zero or more exact dependency versions.
- One adopted change can require impact review for multiple dependent artifacts.
- A research branch owns its current references; its alternatives do not mutate another branch's commitments.

## Confirmed invariants

- Historical approval remains recorded when current dependencies change.
- Approval history does not confer permanent readiness to execute.
- Adopted dependency changes mark affected current dependents for impact review.
- Mere exploration in another branch does not invalidate current commitments.
- Current permission revocation applies across branches and cannot be reversed by selecting an old snapshot.

## State transitions: readiness

Readiness is assessed per intended action, not as a universal project stage.

| From | Trigger | To |
|---|---|---|
| Unassessed | Required inputs and conditions checked | Ready, needs review, or blocked |
| Ready | An adopted dependency changes | Needs review |
| Any state | Required permission withdrawn, input deleted, or execution protection unavailable | Blocked |
| Needs review | Impact resolved and all current requirements satisfied | Ready |
| Blocked | Blocking condition corrected and current requirements rechecked | Ready or needs review |

## Human authority

The owner confirmed that an explicit local Ganesh approval action creates a human commitment.
Ordinary chat, imported feedback, and agent messages never approve a proposal.
The action displays the exact option and packet version and validates current dependencies at commitment time.
The local OS user is trusted; no hosted account system is introduced.
Malicious agents and imported material are inside the threat model; a compromised OS or malicious machine owner is not.

## Core relationships

- A project has one designated owner and zero or more research branches.
- A source identity can have multiple immutable acquired source versions.
- A corpus record links bibliographic identity to discovery or screening history and optional acquired source versions.
- A corpus snapshot is the dated set of records considered in a specified search event.
- A gap assessment is search-scoped, dated, and cannot claim universal novelty.
- An evidence item references an exact source version and locator.
- A claim can have multiple supporting and challenging evidence links.
- A research artifact can have multiple candidate or committed versions.
- A decision packet presents exact candidates, dependencies, reviews, and permitted human actions.
- A decision record captures a human disposition; an approving disposition creates a commitment.
- A work contract has a versioned scope and authorization basis; multiple runs consume its cumulative budget.
- A run belongs to one authorized contract version and one input snapshot.
- An external authorization applies to specific activities, conditions, populations, or data uses.
- A data-use permission constrains destination and purpose independently of scholarly approval.

## State transitions: artifact versions

| From | Trigger | To |
|---|---|---|
| Candidate | Exact-version human approval passes current checks | Committed |
| Committed | An approved replacement is adopted in the same branch | Superseded |
| Candidate, committed, or superseded | Owner archives the version | Archived |

Content edits always create new versions; committed bytes are not rewritten.
Archiving changes visibility, not evidence availability, policy, or historical approval.
Restoring an archived item to current use requires normal validation and, where necessary, a new commitment.
Scholarly assessment, currency, availability, and action readiness are separate dimensions.
A committed claim can remain contested after a reasoned human override.
Deletion leaves only the history permitted by retention policy and blocks uses requiring removed evidence.

## State transitions: decision packets

| From | Trigger | To |
|---|---|---|
| Open | Owner approves a displayed option and all non-waivable checks pass | Approved |
| Open | Owner rejects the proposal | Rejected |
| Open | Owner defers the question | Deferred |
| Open or deferred | Referenced candidate or dependency changes | Stale |
| Deferred | Owner reopens it and all versions remain current | Open |
| Open | Owner requests revision or additional evidence | Superseded by a new packet when prepared |

Approved and rejected dispositions remain historical records.
A changed option requires a new version and affected checks before approval.
A stale packet cannot approve anything; present a refreshed packet instead.
Rejecting or deferring a packet does not silently remove current commitments.

## State transitions: work and execution

| From | Trigger | To |
|---|---|---|
| Proposed contract | Owner action or applicable standing permission authorizes exact scope | Authorized contract |
| Authorized contract | Scope or budget expansion requested | New proposed contract version |
| Queued run | Current policy, input, budget, and prerequisites pass | Running |
| Queued or running | A missing permission or prerequisite prevents further work | Blocked |
| Running | Owner pauses, a limit is reached, or human disposition is required | Waiting for human |
| Waiting for human or blocked | Current requirements rechecked and authorization permits continuation | Queued |
| Running | Required outputs registered and contract completion checks pass | Succeeded |
| Running | Nonrecoverable execution failure | Failed |
| Queued, running, waiting for human, or blocked | Cancellation accepted | Cancelled |

Failed and cancelled attempts remain terminal; retries use new run records under the cumulative contract budget.
Cancellation prevents dispatch and current-result acceptance immediately; stopping remote computation can take longer or fail.
Late outputs are non-current and quarantined until current-policy review permits retention or use.
A succeeded run does not create a human commitment.
Pausing, retrying, branching, or restarting never resets spent budget or restores withdrawn permissions.

## State transitions: external authorization

- Unknown → pending when an external request is reported with provenance.
- Pending → documented approved only when the owner records and reviews evidence of the external decision.
- Documented approved → expired or withdrawn when its governing conditions require it.
- Expired or withdrawn → a new authorization record, never a rewrite of the historical grant.
- Not required needs a recorded applicability basis and is reassessed when scope changes.

Internal approval cannot produce external authorization.
A grant covers only its stated activities and conditions.

## Global invariants

1. Only an explicit owner action commits exact versions; no agent capability can invoke that authority.
2. Every claim-evidence link identifies source content and assessment, not merely a bibliographic citation.
3. Derived content inherits all applicable restrictions; combining inputs never broadens permitted uses.
4. New imports remain local-only until classified and authorized; typed or pasted material cannot bypass disclosure checks.
5. Current policy applies at dispatch, each external operation, result acceptance, and resume across all branches.
6. Reasoned scholarly overrides preserve objections; privacy, provenance, execution safety, and external permissions remain mandatory.
7. Missing evidence permits qualified consultation, not fabricated verification or unauthorized execution.
8. Budget limits are finite and cumulative; unknown provider prices remain unknown.
9. Local analysis and test execution follows the user's selected Pi-compatible permission mode and approved-input policy; Ganesh does not claim sandbox containment.
10. Ordinary conversation navigation never rolls back research state.
11. Project export/restore preserves permitted history; deletion does not promise recall of external disclosures.

## Concurrency

There is no e02 domain application code yet; these are required synchronization contracts, not findings about existing globals.

| Shared mutable location | Readers and writers | Required synchronization | Race consequence |
|---|---|---|---|
| Current artifact/branch references and packet resolution | Owner commands, coordinator, worker-result acceptance | One coordinating writer; transactional expected-version checks and unique command IDs | Critical: stale or duplicate commitment |
| Permissions and external authorization status | Owner commands and every brokered operation | Current-policy checks ordered with dispatch; revoke future capabilities and record in-flight calls | Critical: unauthorized disclosure |
| Run status and contract budget | Coordinator, cancellation, provider completions | Atomic reservation/accounting; reject terminal or superseded result acceptance | High: overspend or cancelled output becoming current |
| Artifact registration and deletion | Import/output registration, deletion, export, restore | Finalized bytes before transactional registration; serialized references and deletion eligibility | Critical: broken provenance or retained prohibited bytes |
| Backup snapshot and migrations | Owner operation and coordinator | Consistent database/artifact manifest; exclude concurrent destructive changes | High: incomplete restore |

Protect the same project against concurrent Ganesh processes; a single writer inside one process is insufficient by itself.
The exact locking and isolation primitives remain engineering verification obligations.

## Example dialogue

> **Researcher:** I changed the RQ in an alternative branch. Did my current plan lose approval?
> **Ganesh:** No. Adopting that change triggers impact review; exploring it does not change your current commitment.
>
> **Researcher:** I adopted it. Can the old analysis run continue?
> **Ganesh:** Only after its current readiness is reassessed against the changed dependency and permissions.
>
> **Researcher:** The reviewer disagrees, but I have a methodological reason to proceed.
> **Ganesh:** Record that reason through the approval action; the objection remains visible, and safety controls still apply.

## Flagged ambiguities

- Approved versus ready: resolved as historical commitment versus current action eligibility.
- Branch: research branches are not Pi conversation branches.
- Supervisor: the Ganesh coordination role is not the researcher's academic supervisor.
- Decision versus commitment: rejection and deferral are decisions but do not adopt research artifacts.
- Checkpoint versus decision packet: checkpoint names the interaction; decision packet names the versioned object.
- Verified: use a specific assessment; bibliographic identity, computational validity, and scholarly support are distinct.
- Local-first: local ownership with authorized provider use, not guaranteed offline AI.
