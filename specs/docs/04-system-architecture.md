# Ganesh — system architecture and trust boundaries

## 1. Reason for existence

Translate the research rules into enforceable application boundaries. This is a selected architecture, not implemented behavior. Prior Pi SDK compatibility work supports UI/runtime reuse; Ganesh-specific wiring remains to be built. See [Prior Art](../product/PRIOR_ART.md) for inspected evidence and remaining obligations.

## 2. Architecture decision

Build a **local-first, single-owner terminal application** with Pi's existing terminal UI, a TypeScript/Node.js 24 LTS controller, a curated Pi SDK runtime adapter, SQLite authoritative state, and a project-owned artifact store. The initial validation host may be macOS, but the terminal/local-folder workflow is not inherently macOS-specific.

```text
Pi terminal UI — conversation / evidence inspection / decision packets / status
        │ explicit local owner actions; native viewers for full documents
        ▼
Ganesh application controller
  commands • authorization • work contracts • gates • version checks • events
        │                     │                         │
        ▼                     ▼                         ▼
SQLite project store     Artifact store             Job coordinator
                                                        │
                                             Pi runtime adapter
                                                        │
                                        bounded agent-role workers
                                                        │
                                          scoped capability broker
                                                        │
                                retrieval / parsing / analysis adapters
```

Pi is the selected reasoning runtime target. Ganesh owns research semantics and policy outside it. Do not fork Pi to encode methodology or make a session transcript the research database.

Use one deployable application rather than microservices, an external workflow platform, a distributed queue, or a graph database. Separate processes are justified for Pi worker lifecycle or explicit command execution needs, not as a language-specific analysis sandbox or for every domain module.

## 3. Authority boundary

Explicit local UI actions send owner commands. Agent tools send **proposals or scoped capability requests**. They never impersonate the human command path. The local OS user is trusted; no hosted account/password system is introduced. An agent message or ordinary chat approval cannot invoke commitment authority.

Examples of human commands: authorize work, approve an exact checkpoint version, reject/revise a proposal, change a data-use policy, pause/cancel, and export reviewed material.

Examples of agent capabilities: read a scoped project snapshot, search an authorized provider, inspect a source, return evidence/candidate artifacts, propose a task, and request a checkpoint.

There is no agent capability to approve decisions, modify committed records, or edit application policy through the research command path. Shell and filesystem execution follows the user's Pi-compatible `ask`, `approve`, or `full-access` mode rather than a Ganesh-specific sandbox. A per-project bash guard can deny or require approval for configured commands. Full-access is an explicit local-risk choice; it does not claim containment.

Shell safeguards and research authority are separate. A command mode can permit local work, but it never grants the agent authority to commit research decisions or bypass current data-use rules through Ganesh's protected command path. The bash guard is a practical policy control, not a complete security boundary; aliases, scripts, and shell composition can evade simple command matching.

Imported PDFs, web pages, skill content, transcripts, and reviewer feedback are untrusted data. Instructions embedded in them cannot authorize tools, change roles, approve decisions, or alter policy.

## 4. Domain commands and permissions

A command checks actor, project, branch, work contract, expected input versions, capability, data classification, operation limits, and gate state before action. All canonical mutations use this path regardless of which agent proposed them.

Read capabilities are limited to the selected project's relevant inputs by Ganesh tools. Local shell execution may be broader when the user selects `full-access`; the selected mode and bash guard are shown as part of the work contract. Write capabilities register candidate results in the run's branch. Worker responses are schema-validated and their source/version references checked before acceptance.

Permissions are checked against current policy at dispatch, each brokered operation, result acceptance and resume—not only when the work contract was created. Revocation or external-approval withdrawal blocks affected queued work, stops further disclosures/actions by active work, and cancels affected workers where possible. Returned outputs are quarantined pending current-policy review. Record operations already in flight and disclosures that cannot be recalled. Resumption requires renewed applicable authorization; historical snapshots cannot restore revoked capabilities.

The human approval route accepts a checkpoint ID/version and explicit action. It resolves the affected artifact and dependency versions from trusted state rather than accepting worker-supplied replacements.

No application web server or localhost approval endpoint is required. Ganesh owns a distinct trusted approval capability in its terminal interaction. Reused built-in commands, pasted input, attachments, session changes, exports, and model-request paths must obey the same policy as custom research tools. Disable or adapt any upstream path that bypasses this boundary; retaining it unchanged is not a requirement. A compromised OS or malicious machine owner is outside the protection claim.

## 5. Durable storage

**SQLite is authoritative** for objects, versions, dependency edges, decisions, tasks, checkpoints and events. Store validated structured payloads with indexed identifiers/status fields and explicit relationships. Do not create parallel authoritative YAML and JSON state files.

**Artifact files** contain original documents, normalized text, datasets, scripts, plots and exports. Files use content hashes and recorded media types; metadata points to exact bytes. Original source bytes are preserved unless an authorized retention/deletion operation removes them.

Use relational edges for evidence/decision navigation. A graph view is a projection over these edges, not another database. Full-text indexing can assist retrieval, but search indexes are disposable and never authoritative evidence.

Human-readable Markdown/DOCX, JSON project manifests, CSV tables, and BibTeX/RIS exports are derived views with version/provenance references. Imported edits become new candidates; editing an exported file does not silently mutate commitments.

Conversation history is stored separately and linked to tasks/decisions where useful. It is a convenience for interaction and audit context, not the only place a rationale or approval exists.

## 6. Versioning, transactions and audit

All committed changes create new versions and audit events. A decision references exact object versions and an evidence snapshot. Use optimistic version checks to reject stale approvals and stale worker results.

Commit a decision, its approved versions, checkpoint resolution, dependency updates and audit event in one database transaction. Unique command IDs make human-command retries idempotent. Concurrent human actions cannot create two conflicting current commitments accidentally.

Artifact storage precedes transactional registration: write to a temporary path, hash/validate, atomically place the completed file, then register its reference. Unregistered files after a crash are recoverable or collectible; committed records must not point to incomplete bytes.

Audit events include actor/role, command, versions, authorization basis, time, run/model/skill/tool versions and outcome. Store concise rationale and decision evidence, not hidden chain-of-thought. Sensitive contents and credentials do not belong in routine logs.

“Immutable decisions” means append-only through the application under normal operation. It does not mean a local machine owner cannot tamper with files. Hashes detect accidental mismatch; stronger independent tamper evidence is not claimed.

## 7. Task orchestration

Use a durable task queue in the project store and a single coordinating writer. Begin with a finite default of two concurrent reasoning workers per project and one analysis execution per project; the owner may adjust limits within the host's resource policy. This is a resource default, not a scholarly quality threshold.

Each run stores its contract, input snapshot, current step, completed outputs, provider request outcomes, attempts, budget usage and cancellation state. The UI can inspect these without depending on a live model stream.

Transient read-only provider calls may receive at most two retries after the initial attempt, within the run budget, respecting provider backoff/Retry-After. Non-idempotent operations require reconciliation or an explicit idempotency mechanism before retry.

On cancellation, stop further dispatch, signal active work, and prevent cancelled outputs from updating current candidates. A provider call may already have received data and may not be retractable; report that limitation. Record partial artifacts without mislabeling the run complete.

On restart, inspect unfinished runs, reconcile persisted outputs, and resume only valid authorized steps. Never infer success from missing error logs. Budget consumption persists across restart.

## 8. Pi integration contract

The adapter must provide or mediate:

- Role-specific instructions, available skills, model selection and scoped tools.
- Bounded task/session creation with relevant context scoped to the work contract.
- Progress/result events, interruption/cancellation and explicit terminal status.
- Persistence/resume references where supported; Ganesh's durable task state remains independent.
- Context reduction without losing the authoritative research state, source references or decisions.
- Structured outputs validated by Ganesh regardless of model formatting.

The prior compatibility check covers the inspected local SDK's `InteractiveMode(runtime, options)` and session-runtime factories under `@earendil-works/pi-coding-agent`. Remaining implementation work includes licensing, cancellation, curated resource loading, session rebinding, persistence guarantees, and Ganesh-specific policy coverage before wiring real project data.

Do not assume reference subagent examples are a built-in production service. Ganesh's coordinator owns worker lifecycle and permissions even if Pi provides useful session primitives.

A Pi conversation branch can aid reasoning, but only Ganesh's explicit project snapshot/branch model carries research-state boundaries. Compacting or navigating a conversation must not change a committed research decision.

## 9. Literature and document adapters

Reuse the established provider workflows and skills already used for discovery and identity metadata, with OpenAlex and Crossref as initial targets and Semantic Scholar or discipline-specific providers supported when authorized. Provider integration is an adapter concern, not a reason to add a new provider architecture; current access, terms, rate limits, and coverage remain recorded at runtime.

Authorized user-supplied papers and bibliographic imports are first-class inputs. A missing API key or unavailable provider is a recorded coverage limitation, not grounds for fabricating retrieval or substituting an unapproved web scrape.

Provider responses retain retrieval context and source identity. Normalize deterministically where possible; ambiguous deduplication becomes a reviewable proposal. Full-text access and redistribution permissions are checked separately from metadata access.

Required imports are text-based PDF, DOCX, Markdown/text, BibTeX/RIS, CSV, and XLSX. Built-in OCR is not required; report scanned inputs as unsupported for extraction unless externally processed with recorded provenance. Treat parsing as potentially lossy. Retain originals and page/paragraph/cell mappings, report unrecovered tables or mathematics, and support source inspection. Parsing never executes document macros or embedded content.

## 10. Data policy, privacy and ethics

Every input receives a sensitivity class: public, restricted/licensed, confidential research, or identifiable/sensitive participant data. New local imports are local-only until classified and authorized for a destination/purpose. Unknown classification defaults to no external disclosure until clarified. Typed/pasted text and attachments are also policy-governed inputs, not disclosure bypasses.

Derived content—including summaries, evidence records, drafts, model results and compacted context—inherits the most restrictive sensitivity of its inputs plus all applicable license, purpose and destination constraints. Combining inputs intersects allowed uses; it never broadens permission. De-identification or paraphrasing does not automatically declassify content. Lowering restrictions requires a separate human-reviewed transformation with a recorded basis, applicable authority, residual-risk assessment and resulting policy; the original remains restricted.

Public scholarly metadata and openly accessible sources may use providers authorized in the work contract. Restricted or confidential materials require explicit destination-specific permission. Sensitive participant data is local-only by default; using a remote model requires documented authority, applicable institutional/consent compatibility, and explicit policy change—not a generic “continue.”

Before a model/tool request leaves the application, the capability broker checks data class, destination, purpose and permission. Apply the same rules to prompts, attachments, retrieval snippets, embeddings, logs and telemetry. The application must not silently fall back to a remote provider when local processing fails.

Store secrets in an OS credential facility or equivalent protected host configuration, never project artifacts or prompts. Workers obtain only the brokered operation, not raw provider credentials. Backups and exports inherit the data policy.

Supply a retention/deletion operation covering originals, extracted text, caches, indexes, chat attachments and backups under application control. Redact or tombstone sensitive content in audit records while retaining non-sensitive decision history where permitted. Report data already disclosed to providers and retention outside Ganesh's control; do not promise retroactive deletion there.

Deletion leaves a non-sensitive tombstone identifying the removed source/version and availability status where retention is permitted; even identifiers/hashes are removed or minimized when policy requires. Dependent evidence displays unavailable, never verified-accessible. Historical decisions remain recorded but claims relying materially on deleted evidence require revalidation before new committed use. Dependent execution requiring the missing input is blocked until an authorized substitute is reviewed. Revalidation does not demand unlawful retention or imply that the historical conclusion was necessarily false.

Ethics readiness references actual requirements, documents, scope, conditions and expiry. Changed recruitment, population, instruments or data use triggers impact review. A human click inside Ganesh cannot stand in for required institutional/community authorization.

## 11. Analysis and local execution

Support researcher-selected languages and tools rather than mandating Python, R, or another runtime. The Methodology role specifies analysis and proposes scripts or commands; execution follows Pi-compatible `ask`, `approve`, or `full-access` modes and the project's bash guard. Full-access is an explicit local-risk choice, not a sandbox guarantee.

Record dataset hash, command or script version, parameters, environment details when available, outputs, warnings and diagnostics. Distinguish recorded provenance from repeatability under a particular environment and from scientific reproducibility. When a tool or package is missing, surface it and allow installation only under the selected execution mode.

The user may run arbitrary local analysis or tests in the language required by the field. Ganesh does not bundle a runtime or promise containment of user-authorized commands. A configured bash guard can deny or request approval for selected commands, but it is not a substitute for a security sandbox.

Exploratory analyses are permitted and labeled as such. An analysis inconsistent with the committed plan either runs as authorized exploration with a recorded deviation or awaits an amendment. Never retroactively present it as preregistered or confirmatory.

When Ganesh cannot execute a requested local command, it produces the plan or script for user-controlled execution and imports results with honest provenance. It does not fabricate successful execution or silently change the user's selected permission mode.

## 12. Backup, portability and operation

Provide a consistent project backup of the database plus referenced artifacts, with a manifest of hashes and schema version. Restore validates referential/file integrity before declaring the project usable. Migrations back up data and must not reinterpret historical approvals silently.

Required exports include source-linked Markdown/DOCX writing, BibTeX/RIS references, CSV analysis tables, and versioned project/review packets with structured manifests. Sanitized exports omit restricted material and identify omitted evidence. Portability means a researcher can reconstruct decisions without Ganesh, not that every licensed source can be redistributed.

Operational events expose task status, provider failures, budget usage and recovery actions. Content telemetry is off by default. Diagnostic exports require inspection/redaction and owner authorization.

## 13. Verification

AC-06 through AC-10 and AC-15 through AC-20 in [05-decisions-and-acceptance.md](05-decisions-and-acceptance.md) define the principal architectural checks. Failures of authorization, provenance, durability or privacy block release even if the conversational demonstration looks convincing.
