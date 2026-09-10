# Ganesh — research model and workflow

## 1. Reason for existence

Define how research work becomes durable evidence and human decisions without making the LLM responsible for remembering or enforcing the process. Product scope is defined in [01-product.md](01-product.md); enforcement is defined in [04-system-architecture.md](04-system-architecture.md).

## 2. First-class research objects

All objects have a stable ID, project ID, version, origin, creation time, and links to their dependencies. Changes create new versions; they do not erase the basis of earlier decisions.

| Object | Meaning and required distinctions |
|---|---|
| Project | Owner, objectives, context, constraints, applicable requirements, current work and standing permissions |
| Source artifact | Original paper, document, dataset, script, or result; content hash, acquisition origin, access rights, sensitivity, and extraction status |
| Search plan/run | Purpose, provider, exact query/filter/version, time, pagination/limits, results, errors, and discovery links |
| Corpus record | Normalized bibliographic identity, source versions, retrieval status, duplicates/corrections/retractions |
| Screening decision | Paper, criterion/protocol version, include/exclude/uncertain, source basis, assessor, and review status |
| Evidence item | Located observation, quotation, measurement, or result; source/version, exact locator, context, extraction provenance, verification status |
| Claim | Proposition, scope, type, origin, evidence links, challenges, qualifications, and assessment status |
| Research artifact | Problem, gap, RQ, framework, design, protocol, instrument, analysis plan, synthesis, draft, or analysis output |
| Issue | Specific deficiency/question, affected versions, impact, severity, supporting rationale, resolution and owner |
| Task/run | Bounded work request, authorized capabilities, input snapshot, execution history, result and status |
| Decision packet | Versioned decision question, exact candidates, reviews, dependencies and available human actions; a checkpoint is its human interaction |
| Decision record | Human action, actor, rationale, selected version, evidence snapshot, applicable conditions and supersession links; approval creates a commitment |
| Research branch | Named alternative with parent snapshot, candidate changes and comparison results; never a Pi conversation branch or implicit commitment |

An evidence item is not a whole paper summary. A claim is not evidence merely because an author or agent states it. A citation verifies bibliographic identity only; support requires inspecting the relevant source content.

Typical dependency chain:

```text
source → located evidence → scoped claim → gap/problem → RQ
                                                   ↓
framework/assumptions → design → protocol → data → analysis → interpretation
                                                   ↓
                                reviewed candidates → human decision
```

Edges carry meanings such as supports, challenges, derived-from, motivated-by, constrained-by, and approved-as. A graph database is not required to represent these relationships.

## 3. Status is multidimensional

Do not put everything in a single “approved” field.

- **Artifact lifecycle:** candidate, committed, superseded, archived.
- **Assessment:** unassessed, supported, qualified, contested, unsupported, insufficient evidence, not applicable with rationale.
- **Currency:** current, needs revalidation.
- **Action readiness:** unassessed, ready, needs review, blocked.
- **Source availability:** available, partial, inaccessible, deleted; separate from scholarly assessment.
- **Task execution:** queued, running, waiting for human, blocked, succeeded, failed, cancelled.
- **External authorization:** not required with basis, unknown, pending, documented approved, expired, withdrawn.

A committed interpretation may remain contested. A previously approved design may need revalidation. A technically successful extraction can still contain unverified evidence. The interface must preserve these distinctions.

## 4. Work contract

Every substantive task records:

- The current research question or practical issue it addresses.
- Input versions, branch, dependencies, assumptions, and missing information.
- Assigned role and applicable skill/method profile.
- Requested language/tool, selected Pi execution mode (`ask`, `approve`, or `full-access`), per-project bash guard, allowed data classes, provider destinations, and write scope.
- Expected outputs and their structural and scholarly checks.
- Finite time/token/call/search/iteration limits and stop conditions, with a spend cap where provider pricing is known.
- Unknown pricing disclosed explicitly; it is not counted as zero cost.
- Whether it is exploration, review, or advancement; which commitments it may propose.
- Who must decide next if the result requires commitment.

The Supervisor proposes this contract. The controller checks permissions, prerequisites, the selected execution mode, and the project bash guard, then executes authorized work without repeated delegation confirmations. Specialists cannot enlarge their own scope or delegate recursively. Scope or budget expansion requires renewed authorization; retries consume cumulative limits rather than creating fresh budgets.

On completion, validate structure, verify source links, assess research quality, and register findings as candidate artifacts. A result does not become committed because a run finished successfully.

## 5. Research lifecycle as linked activities

There is no mandatory global sequence. The table describes dependencies for substantive commitments; exploratory work can proceed with missing dependencies visibly marked.

| Activity | Work and outputs | Commitment/readiness condition |
|---|---|---|
| Intake and orientation | Context, source inventory, reported commitments, requirements and risk triage | Owner confirms material scope and data-use permissions |
| Problem exploration | Landscape, significance, candidate problems, boundaries | Direction and problem adopted by human |
| Review planning and discovery | Review purpose/type, query plan, eligibility criteria, corpus and coverage report | Formal review protocol approved before treating results as protocol-compliant |
| Evidence and appraisal | Located extractions, claim links, study-specific quality assessments | No automatic human checkpoint per paper; uncertain/high-risk exclusions and key evidence are escalated |
| Synthesis and gap challenge | Themes, disagreements, candidate contribution, targeted counter-search | Human accepts a scoped gap/contribution rationale; limitations remain attached |
| Question and framework design | RQ alternatives, construct definitions, theory/assumptions and evidence requirements | Human adopts RQs and relevant conceptual commitments |
| Methodology and study design | Compared designs, sampling, instruments, procedure, analysis and quality plan | Method-sensitive alignment review and human protocol decision |
| Ethics and execution readiness | Risk/data plan, consultation, external approval evidence, conditions and feasibility | Required external authorization documented; owner authorizes the specified activity |
| Study tracking | Researcher-supplied progress, dataset versions, deviations, amendments | Material amendments reviewed before treating changed work as approved protocol execution |
| Analysis | Approved dataset snapshot, reproducible script/tool run, diagnostics, deviations | Execution permissions and plan compatibility; departures recorded as exploratory or amended |
| Interpretation | Result–claim links, counterinterpretations, limitations, contribution reassessment | Human adopts claims for committed use |
| Writing and dissemination preparation | Drafts throughout, evidence checks, disclosure and response records | Human accepts final artifact; external submission remains outside automation |

A bounded proposal review does not require Ganesh to recreate the literature review first. It reports the limits of its review. A user with completed data collection enters at analysis, with retrospective gaps recorded honestly rather than inventing prior approval.

## 6. The supervision loop

1. Read current project state, selected branch, request, and outstanding issues.
2. Identify the next research uncertainty or deliverable, not merely the next numbered phase.
3. Propose bounded work or explain why a decision/input is needed first.
4. Execute deterministic operations and delegate reasoning to the appropriate specialist.
5. Validate and review returned artifacts against their task contract.
6. Consolidate evidence and disagreement without hiding dissent.
7. Present results, request a meaningful decision when needed, or continue within standing authorization.
8. Record the human action and new artifact versions; recalculate affected dependencies.

Research can stop with a useful negative result. Exhausted searches, failed extraction, and unresolved disagreements are reportable outcomes, not reasons to manufacture a completed answer.

## 7. Gate classes and authority

| Gate | What it establishes | Who evaluates | Effect |
|---|---|---|---|
| Structural | Required fields, references, versions, capabilities, source availability, recorded required actions | Deterministic controller | Reject malformed or unauthorized operation |
| Scholarly | Evidential support, methodological fit, coverage, plausibility, interpretation limits | Specialist/Reviewer assessment, with human judgment | Findings and explicit issues; critical unresolved findings block ordinary commitment |
| Human decision | Informed adoption of identified alternatives and trade-offs | Project owner through trusted UI | Commit exact candidate version if applicable gates permit |
| External authorization | An external body/community/authority granted required permission under stated conditions | Recorded evidence reviewed by human | Enables only activities covered by that authorization |

The controller verifies that scholarly review exists and that required issues have a recorded disposition. It cannot prove the review is correct.

**Non-waivable controls:** identity/authorization, privacy permissions, missing or fabricated required provenance, stale approval payloads, cross-project isolation, and required external permissions. The owner can change project/data policy explicitly where lawful and appropriate, but cannot bypass the current policy by approving an unrelated packet.

**Contestable scholarly findings:** the owner may resolve through revision, evidence, expert advice, or a reasoned override. Overrides remain visible, attribute responsibility, preserve the original finding, and never relabel it as an agent “pass.” This prevents a mistaken LLM judgment from becoming an unappealable authority.

## 8. Review protocol and search coverage

Distinguish exploratory landscape work, narrative review, scoping review, and systematic review. Their required rigor and reporting differ. Do not describe an opportunistic search as systematic.

A search plan declares concepts, providers, dates/languages/types, query strategy, retrieval limits, screening rules, and stopping basis. Record query and criterion amendments with their timing and impact. Material changes in a formal protocol require human review and identify records needing rescreening.

Coverage reports include inaccessible databases/full texts, provider failures, result caps, unsearched terminology, and the basis for stopping. Diminishing retrieval is a useful signal, not proof of completeness or novelty. Formal review requirements override convenience-based stopping.

High-stakes gap claims require a targeted attempt to find work that would defeat or qualify the gap. A failed search supports only a claim bounded by that search's coverage and date.

## 9. Methodological alignment

Check question ↔ evidence needed ↔ assumptions/framework ↔ design ↔ sampling/data production ↔ analysis ↔ claim. These are relationships to justify, not a rigid mapping from paradigm to permitted methods.

Use study-appropriate reasoning: qualitative work need not adopt statistical generalizability; reflexive thematic analysis need not use inter-coder agreement; sampling adequacy need not always mean power analysis or saturation. “Not applicable” requires a methodological reason.

Associational data do not automatically justify causal claims. Conversely, a design label alone does not settle causal identification: examine assumptions, temporal structure, confounding, estimand, and identification strategy. Do not prescribe a longitudinal study as sufficient by itself to solve causality.

## 10. Revision, branches, and revalidation

A change proposal identifies the old version, candidate version, rationale, new evidence, affected dependencies, and requested decisions. Candidate edits mark dependents for impact review within their branch only; proposing an alternative does not invalidate the current committed project. Adopting a change marks affected direct and transitive dependents in the destination branch for impact review. Deterministic traversal finds potentially affected records; scholarly review determines the substantive consequences.

Examples:

- New counterevidence may affect a gap, dependent RQs, and contribution argument without invalidating every instrument.
- Changing a population can affect search coverage, sampling, consent, and interpretation.
- Correcting source pagination may repair a locator without reopening an unchanged methodology decision; the correction is still logged.

Previously committed versions remain readable. A stale commitment cannot authorize new dependent execution until revalidated. Users may continue read-only review or provisional exploration while it is stale.

Branches inherit a fixed research snapshot, not frozen permissions. They can compare alternative questions, theories, or designs. Promoting a branch means selecting explicit changes through normal review and approval; there is no automatic merge of contradictory research commitments.

A shared-source correction, retraction, integrity failure or loss of access creates a notice in every branch using that source version without rewriting its snapshot. Material findings mark affected uses for revalidation across those branches. Current privacy restrictions and external authorization status always override historical task/branch permissions; a branch cannot preserve permission that has been withdrawn.

Approving a packet while its inputs changed must fail with a refreshed packet request. Late results from cancelled or superseded work are quarantined as non-current candidates, never applied silently.

## 11. Stop and recovery rules

Stop the affected task when authorization is pending, a required input is missing, data disclosure is prohibited, external permission is unresolved, a hard limit is reached, or required evidence cannot be retrieved. Return the exact blocker and valid next actions.

Allow one targeted revision after a failed scholarly review within the authorized task budget. If the same blocker remains, return the disagreement to the human rather than loop among agents. New work requires an explicit extension of authorization.

Pause and resume preserve input versions, completed steps, unresolved issues, and budget usage. Resume never assumes an interrupted external action succeeded; reconcile its recorded status first. Search reruns are new search events, not replacements for historical evidence.

## 12. Verification

Canonical vocabulary is defined in [the glossary](../UBIQUITOUS_LANGUAGE_LATEST.md); legal transitions and concurrency contracts are defined in [the domain model](../tech-architecture/tech-stack.md).

Behavior is exercised through acceptance scenarios AC-01 through AC-20 in [05-decisions-and-acceptance.md](05-decisions-and-acceptance.md). In particular, test late entry, stale approvals, counterevidence, branch promotion, and interrupted execution; a linear happy-path demonstration is insufficient.
