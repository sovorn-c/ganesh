# Ganesh release interface design

## Status and applicability

Selected for blueprinting under the owner's instruction to decide and continue.
These are Ganesh contracts, not implemented behavior. Prior Pi SDK compatibility work is treated as settled; Ganesh-specific policy wiring is not yet verified.
`deepen-architecture` found no implementation to refactor; measured Module Depth scores, churn analysis, and import-boundary changes are not applicable.
The churn command reported an unborn Git branch. Three independent design explorations informed this comparison.

## Forcing functions

Human commitments, data-use permissions, and work contracts/runs are logical responsibilities within one local application, not separate services or the entire architecture.
Deleting their centralized checks would distribute authority, policy, and accounting rules across terminal actions and workers.
Callers are the trusted owner interaction, coordinator, restricted specialist tools, and behavioral tests.
SQLite and artifact files are local dependencies; model/search providers are external dependencies; local execution uses researcher-selected languages and tools under Pi-compatible permission modes.
Production plus deterministic test adapters justify external seams. No generic plugin framework is required.

## A — Minimal dispatcher

Illustrative signature: `query(readCapability, request)`, `command(workCapability, mutation)`, `ownerAction(ownerCapability, confirmation, mutation)`.
Example: the agent requests a run through `command`; a local confirmation invokes `ownerAction` for a displayed packet.
Hides version validation, transactions, permission checks, and budget reservations.
Few entry points are compact, but the discriminated command vocabulary remains large. Generic dispatch makes allowed actions harder to discover and audit.
The owner entry point must still be unavailable to agents; an `actor: owner` argument proves nothing.

## B — Persisted event-driven workflow

Illustrative signature: `proposeSteps(run, steps)`, `admitOperation(request)`, `settleOperation(id, outcome)` plus a separate owner interface.
Example: contrary evidence creates a durable counter-search step within the current authorized contract.
Hides queue admission, journal/outbox coordination, deduplication, recovery, and cumulative accounting.
Flexible branching supports many workflows but adds workflow schemas, event consumers, and ordering obligations. It risks making the interface nearly as complex as the implementation.
No external effect can be assumed exactly-once. Historical events cannot substitute for current policy.

## C — Focused use-case commands (selected)

Illustrative owner interface:
- `disposePacket(packetVersion, option, disposition, confirmation, commandId)`
- `classifyMaterial(version, basis)` and `grantDataUse(scope, destination, purpose, basis)`
- `revokeDataUse(permission, reason)`
- `authorizeContract(contractVersion, confirmation)`
- `pauseRun(run)`, `cancelRun(run)`, `resumeRun(run)`

Illustrative coordinator interface:
- `preparePacket(candidates, dependencyVersions, reviews)`
- `assessReadiness(action, inputVersions)`
- `proposeContract(scope, inputs, finiteLimits)`
- `queueRun(authorizedContractVersion, snapshot)`
- `acceptSubmission(assignment, submission)`

Illustrative restricted worker interface:
- `readAssignedInput(reference, locator)`
- `requestPermittedOperation(purpose, inputReferences)`
- `executeAuthorizedCommand(command, inputs, parameters)`
- `submitCandidates(outputs, provenance, diagnostics)`

Example: coordinator prepares packet P3; the owner inspects option B and confirms exact versions locally. The coordinator then queues work under a separately authorized contract. Worker outputs remain candidates. Revoking input permission blocks subsequent operations even if the run began before revocation.

## Comparison and synthesis

C has more names than A but makes common actions and forbidden authority visible. Grouped terminal actions provide discoverability without requiring users to memorize every command.
B offers the most extensibility but imposes a general workflow model before it is needed. C allows iterative research without enforcing a fixed stage pipeline.
All three need transactional checks; fewer public methods do not reduce those obligations. Short local transactions and indexed queries permit efficient internals without retaining a database lock during provider calls.
C provides locality through shared internal validation and accounting, with higher misuse resistance at each caller's interface. Its cost is more named operations and schemas.
Adopt C with A's shared mutation envelope (command ID and expected versions). Use durable run records and decision history, not B's general event engine.

## Required behavior hidden behind the interface

- Trusted owner authority comes from local interaction wiring, never role fields, prompts, imported text, or tool arguments.
- Expected versions and command IDs make mutations atomic and idempotent; payload changes under a reused ID fail.
- Approval resolves immutable packet references from storage; stale options fail without partial commitment.
- Readiness is informational, not a cached execution authorization.
- Current policy is checked at dispatch, each disclosure, result acceptance, and resume.
- Derived material inherits restrictions; unclassified pasted/imported content remains local-only.
- Budget admission atomically reserves cumulative usage; uncertain provider outcomes retain conservative reservations until reconciled.
- Cancellation fences dispatch and result acceptance; remote termination remains best effort.
- Retry creates a new run without resetting spent budget. Revised contracts cannot silently create fresh allowance.
- Workers cannot mutate canonical state, acquire owner authority, or access provider credentials through protected research commands. Shell and network access follows the user's selected Pi mode and per-project bash guard; full-access is an explicit local-risk choice.
- Missing local tools or packages are reported; Ganesh does not promise sandbox containment or silently change the selected execution mode.
- Errors distinguish stale versions, policy denial, missing evidence, exhausted budgets, unavailable prerequisites, and invalid transitions.
- Query results, diagnostics, logs, export, and compaction are governed disclosure paths.

## Verification obligations and release constraints

Pi reuse must verify policy coverage across built-in commands, attachments, resource loading, model changes, and session replacement/rebinding.
Failure to enforce the seam blocks affected delivery; do not quietly weaken security or replace Pi without an explicit architectural revision.
Behavioral checks must exercise forged approval, stale packets, duplicate commands, concurrent budget admission, revocation races, restart uncertainty, cancellation/late output, and old snapshots.
Recovery must reconcile finalized artifact bytes and database records without partial approval or silent data loss.
The exact SDK bindings, SQLite binding, execution-mode contract, bash-guard behavior, and distribution support matrix remain technical selections owned by release epics, not validated facts. Prior Pi SDK compatibility is treated as settled.
