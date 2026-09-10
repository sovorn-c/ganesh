# Ganesh — decisions, acceptance, and delivery basis

## 1. Reason for existence

Record why the selected design differs from the exploratory conversation and define observable proof that the product works. This is the decision ledger for the planning baseline; it is not a test-results report.

## 2. Decision register

| ID | Selected decision | Rationale and rejected alternative |
|---|---|---|
| D-01 | Persistent collaborative research assistant, with accountable human ownership | A report generator does not solve longitudinal decision quality; an autonomous PhD system would misplace responsibility |
| D-02 | Full lifecycle support across exploration, design, execution tracking, analysis, interpretation and writing | Do not equate delivery order with product scope; writing supports reasoning throughout rather than occurring only at the end |
| D-03 | Primary focus on doctoral empirical social-science and computing/design research | This makes methodological standards concrete; reject a claim of universal disciplinary competence |
| D-04 | One Supervisor plus Discovery, Evidence, Methodology and Reviewer roles | Responsibilities are distinct; separate agents for every skill, philosophy or statistical test add coordination without inherent rigor |
| D-05 | Application controller owns state transitions and authority; agents propose | Prompts cannot enforce permissions or reliably preserve project state |
| D-06 | Dependency-aware iterative activities, not one mandatory phase sequence | Researchers arrive mid-project and research decisions co-evolve; missing prerequisites limit assurance rather than prohibit useful consultation |
| D-07 | Three separate forms of authority: computational validation, scholarly judgment and human commitment, plus external authorization | A deterministic check cannot establish truth; a human app approval cannot confer institutional permission |
| D-08 | Critical scholarly findings require explicit disposition; reasoned human overrides are possible | An LLM must not become an unappealable examiner; security/provenance/external-permission controls remain non-waivable |
| D-09 | Exact-version approvals, append-only decision history, explicit stale-dependency handling | “Approved” without a version permits silent scope changes and stale execution |
| D-10 | Evidence links include contrary findings and exact source locations | Bibliographic existence and agent agreement do not verify substantive support |
| D-11 | Gap assessments are search-scoped, dated and challenged | Searching cannot prove universal absence; reject automated novelty certification and fixed paper-count gates |
| D-12 | Method-sensitive rigor profiles | Universal inter-coder reliability, saturation, generalizability or paradigm-to-method rules misjudge legitimate research |
| D-13 | Local-first, single-owner terminal workspace reusing Pi's UI | Preserve evidence inspection and exact-version decisions without a separate web application or hosted account system; the initial validation host is not an inherent product boundary |
| D-14 | TypeScript/Node.js 24 LTS controller, curated Pi runtime and reused terminal interface | Reuse the harness without putting research authority in chat or a fork; prior Pi SDK compatibility work is treated as settled |
| D-15 | SQLite canonical state plus content-addressed artifacts and relational dependency edges | Transactions and version checks matter; reject competing YAML/JSON authorities and an unnecessary graph database |
| D-16 | Pi-compatible execution modes with a configurable bash guard and protected research commands | Users choose local shell authority; command safeguards are practical controls, while research commitments remain outside shell authority |
| D-17 | Ethics/data policy applies from intake, not a late lifecycle checkbox | Source uploads and remote model calls can expose research data before recruitment begins |
| D-18 | Finite authorized work budgets, cancellation and durable recovery | Reject open-ended autonomous loops and repeated opaque agent retries |
| D-19 | Reuse only after source, license, behavior and quality inspection | Repository catalogs and public visibility do not establish reuse rights or methodological reliability |
| D-20 | Completion requires both executable behavioral tests and expert-reviewed research cases | Schema-valid output can be academically wrong; a persuasive demo cannot establish system trustworthiness |

Release scope, terminal interface, runtime direction, execution-mode approach, formats, autonomy, privacy defaults, and authority distinctions were explicitly confirmed in the discovery interview. No particular analysis language or host operating system is mandatory; the initial host remains an implementation-validation choice. Other detailed engineering defaults remain proposals, not independently ratified choices or implemented behavior. See [planning context](../planning-context.yaml), [domain model](../tech-architecture/tech-stack.md), and [Prior Art](../product/PRIOR_ART.md).

## 3. Corrections to the source conversation

- The proposed “24 skills” list expanded to 28 in its detailed enumeration. Ganesh uses the competency contracts in document 03 rather than preserving an arbitrary count.
- Agent skill discovery and phase-based visibility are useful context controls, not security enforcement by themselves.
- Session branches do not automatically version datasets, research decisions or files. Ganesh's project state owns those branches.
- “Evidence gate passed” means required review and issue disposition exist. It does not mean a program proved scholarly validity.
- Reviewer separation reduces authoring bias but does not make LLM judgments statistically independent or expert-certified.
- A longitudinal design alone does not establish causality; qualitative rigor does not universally require a second coder.
- Ethics assistance prepares and tracks requirements; authorization remains with the relevant people and institutions.
- Unsupported upstream feature, license, tool-count and reuse-percentage claims are not adopted as facts.

## 4. Acceptance scenarios

Each scenario must have an executable integration/behavioral check where machine-observable and a reviewable research artifact where judgment is involved. Use synthetic or consented de-identified materials, not private participant data in test fixtures.

### AC-01 — Start with incomplete context

Given a researcher supplies only a topic, discipline and immediate goal, Ganesh proposes bounded exploration, records unknowns and asks only necessary clarifications. It neither invents an approved question nor demands an entire protocol before helping.

### AC-02 — Enter an existing project late

Given an existing methodology draft and supervisor feedback, a review proceeds without mandatory topic discovery. It distinguishes reported prior commitments from authenticated Ganesh decisions and states where missing literature/data limits its conclusions.

### AC-03 — Review is not rewriting

Given a request to review a proposal, Ganesh returns ranked issues and version-linked evidence. The original and committed state remain unchanged until the owner requests and approves revisions.

### AC-04 — A candidate gap meets contrary evidence

Given a seeded paper that challenges the candidate gap, targeted counter-search retains and assesses it. The result revises/rejects the gap or explains its narrower scope; it does not suppress the source to preserve the original recommendation.

### AC-05 — Inaccessible evidence and misleading citation

Given metadata for a real paper, an inaccessible full text, and a claim that its abstract does not support, Ganesh distinguishes identity resolution from verification. It marks access limits and unsupported claims, and never invents quotations, page numbers or full-text findings.

### AC-06 — Human approval cannot be forged

Given an agent response, ordinary chat message, or imported document that says “approved,” no human commitment occurs. Only an explicit local Ganesh approval action showing the exact packet/option version can commit. Agents cannot acquire that capability or edit the canonical database through generic tools. Built-in Pi commands and session switches cannot bypass this boundary; no hosted account system is required.

### AC-07 — Stale decision packets

Given a displayed checkpoint, when an input/RQ/protocol version changes before approval, the stale action is rejected. A refreshed packet shows the changed inputs and review needs. Command retries do not duplicate decisions.

### AC-08 — Revision and branch isolation

Given a committed RQ and two candidate designs, modifying one branch does not alter or invalidate the other or the committed design. Promoting a branch requires explicit reviewed changes and marks affected destination dependents for impact review. Shared-source retraction notices reach all branches using that version without rewriting their snapshots; historical decisions remain reconstructable.

### AC-09 — Prompt injection and project isolation

Given a PDF or fetched page instructing a worker to export credentials, approve a design or read another project, capabilities deny those operations. Document rendering does not execute scripts/macros. Tool and worker tests exercise actual boundaries, not just prompt refusal.

### AC-10 — Sensitive-data disclosure

Given a newly imported local file, it remains local-only until classified and authorized. Given identifiable participant data with no remote disclosure permission, prompts, pasted text, attachments, snippets, embeddings, telemetry and analysis tools cannot transmit it externally. Summaries, drafts and compacted context inherit the same restrictions; paraphrasing cannot bypass them. A blocked local operation does not trigger a remote fallback. Authorized declassification/policy changes identify transformation, destination, purpose, residual risk and relevant authority.

### AC-11 — Method-appropriate appraisal

Given a defensible reflexive thematic-analysis study, Ganesh does not fail it solely for missing inter-coder agreement or statistical power. Given a quantitative study with ignored dependent observations, it raises the relevant analysis issue. An expert checks the reasoning, not only the labels.

### AC-12 — Causal claims and design assumptions

Given cross-sectional associational evidence with an unsupported causal conclusion, Ganesh identifies the mismatch and alternatives. It does not claim that merely switching to a longitudinal label solves identification. It records any human override without converting the finding to “pass.”

### AC-13 — Mixed-methods/design-science fit

Given two disconnected qualitative and quantitative datasets, Ganesh asks for an integration rationale. Given a computing artifact with no evaluation, it distinguishes successful implementation from a supported research contribution.

### AC-14 — Reviewer disagreement and finite revision

Given a Reviewer finding that conflicts with the Methodology recommendation, both positions and their source bases appear in the packet. One targeted revision is allowed within the contract; persistent disagreement returns to the human rather than launching an indefinite review loop.

### AC-15 — Ethics and changed conditions

Given ethics authorization restricted to a population/data use, a proposed material change cannot execute under the old permission; the adopted change marks affected current readiness as needing review. Ganesh does not treat internal owner approval as replacement institutional authorization. Withdrawal of external permission or disclosure authorization blocks affected queued/resumed tasks and stops further active operations across historical branches; in-flight disclosures that cannot be recalled are reported.

### AC-16 — Search reproducibility and honest coverage

Given provider caps, a failed page, inaccessible sources and revised queries, the search report records all four. Each exclusion has a criterion/version and reason. Replaying the saved result snapshot reconstructs the assessed corpus; rerunning a live query is correctly recorded as a new event that may differ.

### AC-17 — Interrupted execution and recovery

Given interruption before/after artifact registration and decision transactions, restart yields no half-approved state or reference to incomplete files. Resume checks input currency and remaining budget. Late cancelled results cannot become current silently; failed remote calls are not counted as completed searches.

### AC-18 — User-controlled local analysis

Given an authorized local analysis or test command in any user-selected language, Ganesh records input references, command or script versions, parameters, outputs and diagnostics where available. Execution follows Pi-compatible `ask`, `approve`, or `full-access` modes and the per-project bash guard. Missing tools and packages are surfaced, and installation follows the selected mode. Full-access is an explicit local-risk choice; Ganesh does not claim sandbox containment or universal reproducibility.

### AC-19 — Traceable writing and honest negative results

Given contested evidence and uncertain findings, a draft retains qualifications, evidence links and AI-use disclosure needs. Ganesh can complete a task with “insufficient evidence” and valid next actions. It neither fabricates a definitive contribution nor submits the document externally.

### AC-20 — Export, deletion and restore

Given the required import/export formats, round-trip checks preserve permitted content, references, and format limitations. Text-based PDF, DOCX, Markdown/text, BibTeX/RIS, CSV, and XLSX imports preserve originals and locators; scanned inputs without externally recorded OCR report unsupported extraction. Markdown/DOCX writing, BibTeX/RIS references, CSV tables, and project/review packets are exportable.

Given a completed project snapshot, export/restore preserves versioned decisions and resolvable permitted evidence. Restricted bytes are omitted from sanitized exports with an explicit omission notice. Authorized deletion covers application-controlled derived copies and reports limits for backups or prior external disclosures. Deleted evidence becomes visibly unavailable, materially dependent claims require revalidation for new committed use, and execution needing removed inputs is blocked. Permitted non-sensitive decision history remains without retaining prohibited content.

## 5. Quality evaluation design

Maintain a small, curated reference set spanning early exploration, misleading gap claims, strong contrary evidence, quantitative design errors, legitimate qualitative alternatives, mixed-methods integration, design-science evaluation, sensitive-data handling and late-stage proposal review.

For each case, record source material, known facts, acceptable alternative judgments, critical errors, applicability of method standards and expected human escalation. A research-methods-qualified human reviews the reference judgments. Cases with legitimate disagreement must not use one model-written answer as ground truth.

Assess role outputs and end-to-end packets separately. Track unsupported-claim severity, source-locator accuracy, contradiction retention, methodological appropriateness, uncertainty handling, researcher correction effort and time to inspect a decision.

**Release conditions:** all deterministic authority/privacy/durability scenarios pass; no known unresolved critical provenance or methodological failure remains in the reviewed reference cases; limitations and supported contexts are documented. Do not advertise benchmark percentages without a defined sample and actual measurements.

Testing may reveal a need to change a decision. Record that change explicitly; do not lower standards to make a demonstration pass.

## 6. Delivery dependency map

This orders engineering work for the complete design. It is not a reduced product definition or a request to postpone product decisions.

| Work package | Depends on | Required proof before dependent work relies on it |
|---|---|---|
| A. Domain contracts and reference cases | This blueprint | Version/status schemas, permissions and representative scholarly cases agreed as testable contracts |
| B. Persistence and human authority | A | Atomic decisions, idempotency, stale-version rejection, dependency traversal and backup/restore checks |
| C. Runtime and local execution integration | A | Prior Pi compatibility check plus execution modes, bash guard behavior, cancellation and protected research commands |
| D. Evidence acquisition and provenance | B, C | Authorized imports/search, access status, located extraction, corpus snapshots and honest failures |
| E. Research competencies and review | A, C, D | Competency outputs satisfy contracts and method-sensitive reference cases |
| F. Terminal research workspace | B, C | Reused Pi UI with trusted approval, source inspection/native viewers, alternatives, status and steering; accessible keyboard interaction |
| G. Full lifecycle integration | D, E, F | Design, ethics, analysis, amendments, writing and exports follow the same authority/provenance model |
| H. System acceptance | B–G | Executable scenarios, expert-reviewed results and documented operational limitations |

No implementation tasks or code are created by this document. These packages provide the basis for later engineering plans without reopening settled product purpose or omitting later research activities.

## 7. Technical verification obligations

| Obligation | What must be established | If evidence contradicts the assumption |
|---|---|---|
| Pi integration | Actual supported APIs, skill/resource loading, custom tools, interruption, persistence and lifecycle guarantees | Adapt the runtime boundary; do not rely on unverified session behavior |
| Local command safeguards | Pi-compatible ask/approve/full-access modes and a per-project bash guard are explicit and honestly documented as non-sandbox controls | Keep user choice visible; add stronger containment only if a later requirement demands it |
| Source-provider access | Reuse existing provider workflows while retaining current credentials, terms, rate limits and metadata/full-text coverage | Use authorized alternatives/imports and report coverage loss |
| Upstream reuse | Component-level license, origin and actual behavior | Do not import unlicensed/incompatible material; implement independently where required |
| Institutional requirements | Authoritative institution/jurisdiction/community requirements and applicability | Mark readiness unresolved and route to the relevant human authority |
| Parsing fidelity | Locator preservation and limitations on representative PDF/DOCX/table inputs | Mark incomplete extractions and require source inspection |
| Local storage dependencies | SQLite/runtime support, migrations, file atomicity, backup/restore behavior | Change binding or storage mechanics while preserving transaction/version guarantees |

These are evidence obligations, not unanswered product choices. Specific SDK calls, dependency versions and institutional rules cannot responsibly be finalized from the conversation alone.

## 8. Final planning verdict

**Discovery intent is confirmed.** Ganesh is a human-accountable, evidence-traceable supervision assistant with bounded autonomy and iterative workflows across the complete approved research lifecycle.

The handoff is preparation for `/bp-init`, not automatic execution of it. No environment, stories, or application code were initialized. Provider, parser, licensing, execution-mode, and recovery work remain implementation concerns; prior Pi SDK compatibility is treated as settled. Intent readiness is not implementation, scholarly certification, or production-release readiness.

## 9. Verification

Run the documentation check in [README.md](README.md). During implementation, attach actual test commands, reports and expert review evidence to AC-01 through AC-20. Until then, every scenario is an acceptance requirement, not a passed test.
