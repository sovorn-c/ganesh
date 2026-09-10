# Ganesh — agents, skills, and scholarly standards

## 1. Reason for existence

Assign clear reasoning responsibilities without multiplying agents for every research noun. Define reusable competencies and the standards their outputs must meet. Workflow authority remains with the controller described in [04-system-architecture.md](04-system-architecture.md).

## 2. Selected agent architecture

```text
Human researcher ↔ Supervisor ↔ Deterministic controller
                                     │
             ┌───────────────┬───────┴──────────┬──────────────┐
             ▼               ▼                  ▼              ▼
         Discovery        Evidence         Methodology      Reviewer
             └───────────────┴──────────────────┴──────────────┘
                                     │
                        candidate artifacts and issues
                                     │
                        reviewed human decision packet
```

The diagram shows reasoning flow, not approval authority. Explicit human approval goes directly through the trusted Ganesh command path, never through an agent.

There are five roles: one Ganesh Supervisor and four specialist roles. Roles are configurations and responsibility boundaries, not five always-running processes. A specialist receives a bounded input snapshot and produces a structured result.

Synthesis is a competency used by Evidence and Supervisor. Analysis is owned by Methodology, executed through user-controlled local tools in Pi-compatible permission modes, and reviewed independently. Integrity is a cross-cutting requirement plus Reviewer checks. These responsibilities do not require separate permanent agents.

| Role | Owns | Does not own |
|---|---|---|
| Supervisor | Understanding intent/context, work proposals, delegation, consolidating results, explaining trade-offs, preparing packets | Human approval, direct canonical-state mutation, unbounded research, substituting fluent synthesis for evidence |
| Discovery | Search strategy, authorized retrieval, citation exploration, corpus coverage, preliminary screening proposals | Accepting gaps/RQs, declaring comprehensive coverage without basis, bypassing access restrictions |
| Evidence | Located extraction, claim/evidence distinction, appraisal, verification, cross-paper synthesis and counterevidence | Fabricating unavailable details, converting abstracts into full-text verification, accepting contribution claims |
| Methodology | Problem/RQ alternatives, frameworks, philosophy, study design, sampling, instruments, analysis, quality and ethics preparation | Institutional approval, imposing one paradigm, authorizing participant contact, executing arbitrary code without permission |
| Reviewer | Targeted critique of submitted artifacts and underlying evidence; methodological/integrity/statistical/domain lenses | Rewriting the artifact it evaluates, approving the project, pretending independence guarantees truth |

The Supervisor may reason conversationally without delegation for simple explanation or clarification. Source-heavy extraction, substantive design proposals, and consequential review use bounded specialist tasks. Parallelism is for independent work only; synthesis must wait for its evidence inputs.

## 3. Specialist task and result contracts

Each specialist receives the objective, inputs with versions, relevant project decisions, method profile, applicable constraints, permitted tools, output schema, and finite budget. It receives relevant sources—not the entire conversation by default.

Every result contains:

- Task/run ID and exact input versions.
- Produced artifacts with provenance links.
- Observations separated from inference and recommendations.
- Contrary evidence, limitations, inaccessible inputs, and unresolved issues.
- Checks performed and their results; checks not performed.
- Proposed next action and whether human judgment is required.

Specialists can request clarification or additional capabilities through the controller. They cannot grant those capabilities to themselves or call other agents. The Supervisor reconciles outputs; disagreement is preserved in the packet.

## 4. Competency catalog

This is the decided functional coverage, not a promise to copy the prior conversation's inconsistent skill counts. Package recognizable research competencies; helper operations such as DOI normalization and field extraction remain tools or steps.

| Skill | Primary role | Inputs → required output | Essential quality condition |
|---|---|---|---|
| Research orientation and problem framing | Methodology | Topic/context → problem alternatives, significance, assumptions, boundaries | Distinguish practical problem from researchable knowledge problem |
| Research landscape mapping | Discovery | Topic/seeds → concepts, strands, terminology, landmark/recent work, unknowns | Every field-level assertion has a stated evidence basis |
| Review protocol and query design | Discovery | Purpose/RQs → review type, queries, eligibility and extraction plan | Database syntax and protocol amendments are explicit |
| Literature discovery and citation exploration | Discovery | Search plan/seeds → corpus additions and search records | Retrieval limits, failures and discovery paths retained |
| Corpus screening and coverage assessment | Discovery | Records/criteria → decisions, uncertainty queue, coverage report | No silent exclusion; no universal paper-count threshold |
| Structured paper reading | Evidence | Source text → research problem, methods, findings and limitations | Unreported fields remain unreported; source locators required |
| Claim and evidence extraction | Evidence | Source → scoped claims and separately located evidence | Author claim, measured result and agent inference distinguished |
| Critical appraisal | Evidence | Study and method profile → dimension-specific quality findings | Relevance is separate from quality; criteria fit the method |
| Claim and citation verification | Evidence | Claim/citations → support status, qualifications, counterevidence | Identity resolution alone is not substantive verification |
| Evidence matrix and synthesis | Evidence | Extracted/appraised corpus → comparison matrix, themes, disagreements | Every synthesis unit links to contributing and challenging evidence |
| Gap and contribution challenge | Evidence | Problem/corpus → candidate gaps, counter-search, scoped contribution rationale | Attempt to defeat each consequential gap; no novelty guarantee |
| Research-question and framework design | Methodology | Problem/evidence → RQ alternatives, constructs, theoretical relationships | Scope, answerability, feasibility and required evidence explicit |
| Philosophy and positionality alignment | Methodology | Aim/context/researcher position → assumption options and implications | Elicit human position; never invent identity or beliefs |
| Methodology comparison and study design | Methodology | RQs/constraints → compared designs and coherent protocol proposal | Explain fit and trade-offs without a magic aggregate score |
| Sampling and recruitment planning | Methodology | Population/design/resources → strategy, adequacy rationale and recruitment plan | Distinguish target/access populations; planning is not recruitment |
| Measurement and instrument design | Methodology | Constructs/information needs → instruments/prompts, validity and pilot plan | Check instrument rights and fit; do not claim validation by generation |
| Analysis planning and execution guidance | Methodology | RQs/design/data → plan, permitted computation, diagnostics and limitations | Separate confirmatory from exploratory work and preserve executable provenance |
| Methodology alignment audit | Methodology | Problem through intended claims → relationship-level findings and remedies | Method-sensitive judgments; critical findings require disposition |
| Ethics, cultural responsibility and data planning | Methodology | Study/context/data → risk register, consultation, data plan and external requirements | Institution/community authority is not replaced by an agent checklist |
| Study progress and amendment assessment | Methodology | Protocol/progress/deviations → consequences, amendment proposal and readiness update | Retrospective changes remain labeled retrospective |
| Interpretation and research writing | Supervisor | Reviewed evidence/results → claim map, qualified interpretation, traceable draft | Unsupported text flagged; human authorship responsibility and disclosure retained |
| Research review and feedback resolution | Reviewer | Versioned packet/feedback → ranked issues, alternatives and review record | Critique underlying evidence, not just wording; unresolved dissent retained |

Methods requiring distinct expertise are profiles within these competencies, not a separate agent per test or paradigm. A profile specifies applicability, required inputs, appraisal standards, analysis constraints, and escalation boundaries.

## 5. Skill contract

A skill has a human-readable procedure and machine-validated metadata:

- Stable name/version, purpose, trigger and owning role.
- Applicable research types and unsupported contexts.
- Required and optional input types; output schema.
- Procedure and permitted tool capabilities.
- Source/provenance and methodological quality requirements.
- Failure, uncertainty and escalation conditions.
- Human decision implications and relevant gate types.
- Worked examples, including failure and disagreement cases.
- Original authorship or upstream origin, license evidence and adaptation record.

The application owns the authoritative capability policy. Skill metadata can request capabilities but cannot grant them. Instructions saying “human approval required” supplement—not replace—controller enforcement.

Use Pi-compatible skill packaging where supported, with Ganesh's metadata validated by its own loader. Whether custom metadata belongs in frontmatter or an adjacent manifest is an SDK compatibility detail to verify; the contract above is fixed independently of that binding.

## 6. Tool boundary

Examples of deterministic tools: retrieve provider results, normalize metadata, identify potential duplicates, extract PDF text, query the project store, validate record schemas, resolve source locations, execute an authorized local command or analysis, and register candidate output.

Tools do not decide that a methodology is philosophically correct or a gap is novel. Fuzzy matching proposes duplicate merges; it must not automatically conflate a preprint, corrected paper, conference paper, and extended journal article without an identity basis.

All tools return errors and partial completion explicitly. An empty search result, a failed request, and a successful search finding no eligible work are different outcomes.

## 7. Evidence discipline

1. Record the exact source version and location for extracted material: PDF page/section/table, document paragraph, dataset row/column or query, analysis output reference, or equivalent stable locator.
2. Preserve context needed to interpret the excerpt, including population, design, conditions, uncertainty and source limitations.
3. Mark accessibility level: metadata only, abstract only, full text, or partial/unreliable extraction. Do not imply stronger access than obtained.
4. Separate author-reported information, agent inference, and human interpretation. Missing reporting is not evidence that the procedure was not performed.
5. Preserve supporting and challenging links. A withdrawn/retracted/corrected source triggers reassessment of dependent uses; retain its history.
6. Qualify “consistent,” “effective,” “causes,” “no research,” and comparable strong claims to match evidence and search scope.
7. Label model confidence as an assessment, not a calibrated probability. Use reasoned categories and explicit uncertainties unless calibration evidence exists.
8. Protect participant quotations and restricted full text during display, export and model use. Provenance does not grant redistribution rights.

## 8. Method-specific rigor

- **Quantitative:** estimand, experimental unit, dependency structure, measurement, identification, power/precision where appropriate, missingness, multiplicity, assumptions, uncertainty and robustness.
- **Qualitative:** epistemological coherence, context, recruitment rationale, information adequacy appropriate to the approach, reflexivity/positionality, analytic transparency, interpretive grounding and ethical representation. Do not impose inter-coder agreement on reflexive analysis.
- **Mixed methods:** why mixing is necessary, sequencing, priority, where integration occurs, handling divergent findings, and the basis of combined inference. Two separate datasets alone are not a coherent mixed-methods design.
- **Design science/computing:** problem relevance, artifact requirements, design rationale, appropriate baselines, evaluation context, dataset leakage, reproducibility, utility and contribution beyond implementation.
- **Evidence synthesis:** review type, search and selection transparency, method-appropriate appraisal, heterogeneity, missing evidence, and limits of cross-study inference. Meta-analysis requires suitable data and assumptions, not merely multiple numeric results.

Institutional/community profiles supplement these standards. They cannot silently replace study-specific reasoning or claim cultural legitimacy without engagement.

## 9. Reviewer independence and escalation

The Reviewer gets the candidate artifact, its evidence and declared rationale, the review question, and the applicable standards in a fresh task context. It does not receive instructions to endorse the Supervisor's recommendation. It can inspect original sources through scoped read capabilities.

“Independent review” means separation of task context and authoring role—not statistically independent model errors. Multiple model personas are not multiple human experts. Use another model only when its data policy and actual review value justify it, not to manufacture consensus.

Run review at consequential checkpoints: gap/contribution acceptance, design/protocol adoption, interpretation, and final committed writing. Use targeted review after minor changes according to impact. Do not dispatch a panel for every routine extraction.

Findings identify an affected claim/artifact, evidence, severity, consequence and remedy. Critical unresolved issues block ordinary commitment; reasoned human dispositions follow document 02. Reviewers cannot create an infinite retry loop.

## 10. Existing skill reuse

Reuse procedures, parsers, providers and statistical libraries when they meet the contract. Do not import whole suites or accept their quality claims on name recognition.

For every adopted component, inspect the actual source, pin the revision, verify the license and any bundled material's terms, record attribution, check tool/data behavior, and evaluate representative success/failure cases. Public availability is not permission to copy. Unlicensed text is not imported.

Rewrite procedures from independently established methodological requirements where reuse rights or quality are unclear. Do not promise percentages of reusable code or skill coverage before inspection.

## 11. Verification

Use AC-04, AC-05, AC-11 through AC-14, and AC-19 in [05-decisions-and-acceptance.md](05-decisions-and-acceptance.md) to evaluate these contracts. The catalog is coverage for planning; implementation must supply executable checks and expert-reviewed examples rather than treating the existence of skill files as completion.
