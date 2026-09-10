# Ganesh — product definition

## 1. Reason for existence

Researchers spend time collecting papers, reconciling feedback, checking methodological choices, and recovering why earlier decisions were made. Generic chat tools produce fluent answers but do not reliably preserve the distinction between evidence, interpretation, recommendation, and approved project direction.

**Ganesh helps a researcher make, justify, revisit, and carry out research decisions without outsourcing responsibility for those decisions.** Its unit of progress is a resolved research issue or a useful verified artifact—not a long report, a paper count, or a number of agent calls.

## 2. Users and supported research contexts

**Primary user:** a PhD researcher who owns a project and works with a real academic supervisor. Early-career researchers and master's thesis students use the same project model. Research assistants can prepare material; supervisors can review exported packets and return feedback.

**Accountability:** one designated human project owner commits decisions in Ganesh. Feedback from other people is recorded with attribution and its verification status. Imported feedback is not automatically an authenticated approval. Multi-user institutional administration and shared live editing are outside this product definition.

**Research focus:** empirical social science, Information Systems, HCI, education, and computing/design-science projects. Support quantitative, qualitative, mixed-methods, and artifact-evaluation studies through explicit method profiles. General evidence work is usable elsewhere, but specialist methodological advice outside supported profiles must be labeled outside competence and referred for expert review.

**NZ context:** support institution-specific requirements, Māori research considerations, Te Tiriti obligations where applicable, cultural consultation, and data sovereignty. Do not claim a generic checklist represents UoA, AUT, every discipline, or every Māori community. Relevant requirements must be supplied or retrieved from identified authoritative sources and reviewed with appropriate people.

## 3. Product boundary

### Included

- Topic and problem exploration; research questions and contribution reasoning.
- Literature search planning, retrieval through authorized providers, screening, and citation exploration.
- Paper reading, source-grounded extraction, appraisal, synthesis, and gap challenge.
- Philosophy, theory, methodology, study design, sampling, measurement, and analysis planning.
- Ethics-risk preparation, data-management planning, and tracking external approval conditions.
- Protocol and study-progress tracking; planning amendments and deviations.
- Analysis of approved inputs through permitted deterministic tools and reviewed scripts.
- Interpretation, claim qualification, proposal/chapter drafting, citation checking, and review-response support.
- Decision records, version history, branching alternatives, project status, and human checkpoints throughout.

### Excluded

- Acting as the official supervisor, examiner, ethics committee, statistician of record, or legal adviser.
- Certifying novelty, guaranteeing publication, or declaring a thesis academically correct.
- Recruiting or contacting participants, obtaining consent on behalf of the researcher, or autonomously collecting participant data.
- Running physical experiments, making clinical decisions, or controlling laboratory equipment.
- Automatically submitting ethics applications, papers, grant applications, or institutional records.
- Evading paywalls, harvesting restricted services, or assuming institution access implies redistribution rights.
- Training or fine-tuning a model, building a general scientific-agent platform, or supporting every discipline through generic prompts.

Writing belongs throughout research: notes, protocols, proposals, memos, and drafts support thinking. Only finalized claims and committed outputs require final review. Writing is not postponed until the end of a rigid pipeline.

## 4. Use cases and outcomes

| Use case | Inputs needed for substantive work | Outcomes | Human commitment |
|---|---|---|---|
| Explore a topic | Topic, discipline, current objective | Concepts, candidate problems, preliminary literature map, uncertainties | Select direction and scope |
| Plan a review | Topic/RQs, review purpose, access and time constraints | Review type, reproducible query strategy, eligibility criteria, extraction plan | Approve formal review protocol where required |
| Investigate a gap | Candidate problem/gap, corpus or search permission | Scoped gap assessment, supporting and contrary evidence, counter-search history | Accept, revise, or reject the contribution premise |
| Formulate RQs | Problem, evidence context, candidate contribution | RQ alternatives, definitions, evidence requirements, feasibility implications | Adopt RQ version |
| Select methodology | RQs, assumptions, constraints, researcher position | Compared approaches, rationale, tensions, limits | Adopt philosophical/design commitments |
| Design a study | Chosen direction and available resources | Sampling, instruments, procedure, analysis and quality plans | Approve protocol; obtain external permissions |
| Prepare ethics | Protocol, data categories, institution/community requirements | Risks, consent/data-management drafts, outstanding consultation and approval requirements | Researcher handles submissions and external authorization |
| Track study execution | Approved protocol, researcher-reported progress/deviations | Progress summary, deviation assessment, amendment proposals | Approve amendments and meet external conditions |
| Analyze data | Authorized dataset, provenance, analysis plan | Reproducible analysis outputs, diagnostics, departures from plan, uncertainty | Authorize execution and consequential plan changes |
| Interpret results | Results, RQs, methods, source evidence | Claim–evidence map, alternative interpretations, generalization limits | Accept interpretations for committed use |
| Draft or review research writing | Relevant project artifacts and intended audience | Traceable draft, unsupported-claim flags, structured critique | Author accepts final content and disclosures |
| Respond to feedback | Attributed feedback and affected artifacts | Issue list, impact assessment, revision options, response record | Decide revisions rather than silently rewrite |
| Prepare supervision | Current project state and changes since last meeting | Decision packet, unresolved questions, evidence links, next actions | Real supervisor/researcher discussion |

Missing inputs do not prevent consultation. Ganesh identifies which conclusions cannot yet be supported and either requests the minimum necessary information or performs explicitly provisional work.

## 5. Intake and context

Start with four questions, accepting answers already present in supplied material:

1. What are you researching, and in which discipline?
2. What do you want help deciding or producing now?
3. What materials and prior decisions already exist?
4. What constraints or sensitive information should govern this work?

Infer project stage provisionally and let the researcher correct it. Do not require a complete methodology form before exploration.

Capture context progressively: institution, jurisdiction, deadlines, budget, access to participants and literature, researcher expertise, study type, philosophical position, existing approvals, and AI-use requirements. Unknown values remain unknown; they are not filled with plausible defaults.

Required imports are Markdown/text, text-based PDF, DOCX, BibTeX/RIS, CSV, and XLSX. Feedback, analysis scripts, and prior outputs retain their original representations and provenance. Preserve originals and source locations. Built-in OCR is not required: scanned PDFs are reported as unsupported for extraction unless externally OCR-processed with provenance. Unsupported or unreadable inputs are reported rather than silently skipped.

New local imports remain local-only until classified and authorized for a destination and purpose. Batch classification is supported; derived material inherits restrictions. File location is not permission for cloud disclosure.

Imported statements such as “RQ approved” become reported prior commitments with attribution, not newly authenticated Ganesh approvals. The owner confirms their working status; external approval evidence remains distinct.

## 6. Human interaction model

**Selected interface:** a local terminal workspace reusing Pi's SDK and existing terminal UI through a curated Ganesh launcher. It provides one Ganesh Supervisor conversation, source/evidence inspection, project status, and explicit decision-packet interactions. Source inspection and comparing alternatives remain central activities. Native local viewers handle full PDFs, plots, and complex documents; no separate Ganesh web application is required. The initial validation host may be macOS, but the terminal/local-folder workflow is not inherently macOS-specific.

Local-first means local ownership of project records, not mandatory offline AI. Researcher-configured remote providers are allowed only for authorized material. Saved project records remain inspectable offline. The application does not bundle model weights or require a fully offline reasoning mode.

Local analysis and test execution is language-agnostic. Researchers may use Python, R, JavaScript, shell, or other tools available on their machine. Ganesh reuses Pi-compatible `ask`, `approve`, and `full-access` modes plus a per-project bash guard; full-access is an explicit local-risk choice, not a sandbox guarantee. Missing tools and packages are surfaced, and installation follows the selected mode.

Ganesh supports three work intents, using the same project state:

- **Explore:** investigate alternatives without changing commitments.
- **Review:** assess supplied material without rewriting or approving it.
- **Advance:** prepare the artifacts and decisions needed for a specified research objective.

These are task intents, not separate products or permission bypasses. A user can ask for concise expert feedback or explanatory teaching; presentation depth does not change evidence standards.

Before substantive delegated work, show a brief work plan: objective, scope, allowed sources/data, deliverables, budget, and expected checkpoint. Once authorized, bounded work proceeds without repeated “continue?” requests. Existing standing permissions can authorize routine work within their scope.

During work, show meaningful milestones, current blockers, and budget consumption. The researcher can pause, cancel, narrow, or redirect. A material change to approved scope creates a change proposal; steering text does not silently amend a protocol.

Every completed cycle provides:

- What was done and what was not possible.
- Inspectable artifacts and source evidence.
- Findings separated from interpretations and recommendations.
- Unresolved issues and their consequences.
- A concrete next action or a decision packet when commitment is needed.

## 7. Decision packets

A checkpoint must state the decision question, affected artifact versions, alternatives including retaining the current position, recommendation and rationale, evidence and counterevidence, uncertainties, reviewer findings, practical consequences, and any blocking requirements.

Actions are: approve an identified option, revise, request more evidence, explore an alternative, reject, or defer. Editing an option changes its version and reruns affected checks before approval. Only an explicit local Ganesh approval action commits exact versions; ordinary chat text, agent output, and imported feedback cannot approve them.

Approval records the historical commitment. Current readiness is reassessed after adopted dependency changes, permission changes, or evidence loss. Scholarly objections permit a reasoned human override without becoming a pass; safety and external permissions remain mandatory.

“Approve” means the human adopts an exact proposal for this project. It does not mean a claim became objectively true or an institution approved the study.

## 8. Success and non-success

Ganesh succeeds when a researcher can explain what was decided, why, from which evidence, under which limitations, and what remains to do. Useful outcomes include rejecting a weak gap, reducing claim strength, or concluding that evidence is insufficient.

Measure:

- Time to prepare and review a decision, including correction effort.
- Rate and severity of unsupported or incorrectly attributed claims in inspected outputs.
- Human ability to find sources and reconstruct a decision rationale.
- Detection of seeded methodological contradictions and contradictory evidence.
- Preservation of commitments and accurate identification of stale dependencies.
- Successful pause/resume and reproducibility of analysis and search records.
- Permitted Markdown/DOCX writing exports, BibTeX/RIS references, CSV analysis tables, and versioned project/review packets.

Do not optimize for approval rate, agreeable recommendations, report length, or the number of papers retrieved. Acceptance is defined in [05-decisions-and-acceptance.md](05-decisions-and-acceptance.md).
