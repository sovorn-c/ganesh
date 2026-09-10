# Ubiquitous Language

Canonical domain vocabulary for Ganesh's confirmed complete production-release intent.
Relationships and legal transitions are defined in [the domain model](tech-architecture/tech-stack.md).

## People and authority

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Project owner** | The single designated researcher responsible for a project's commitments and permissions. | Account, administrator, autonomous owner |
| **Academic supervisor** | The real human academic providing supervision outside Ganesh's software authority. | Supervisor agent |
| **Ganesh Supervisor** | The coordinating agent role that proposes bounded research work and presents its results. | Official supervisor, examiner |
| **Specialist role** | A bounded agent responsibility for discovery, evidence, methodology, or review. | Independent authority, autonomous researcher |
| **Competency** | A defined research capability with inputs, outputs, limits, and assessment criteria. | Agent, prompt file |
| **Human commitment** | The owner's recorded adoption of exact research artifact versions through an explicit approval action. | Chat approval, truth, readiness |
| **Decision record** | The durable record of an owner's approval, rejection, deferral, or other explicit disposition. | Approval, agent recommendation |
| **External authorization** | A documented permission from the relevant external authority for specified activities and conditions. | Internal approval, ethics pass |
| **Reasoned override** | An owner's justified disposition that permits commitment despite a retained scholarly objection. | Reviewer pass, safety bypass |

## Research and evidence

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Project** | A locally owned body of research objectives, context, evidence, commitments, and permissions. | Conversation, folder contents alone |
| **Source artifact** | Acquired original material with recorded origin, rights, sensitivity, and byte identity. | Claim, evidence conclusion |
| **Source version** | An exact acquired version of source material used to locate and assess evidence. | Latest source, mutable paper |
| **Corpus record** | A bibliographic identity linked to acquired source versions and discovery or screening history. | Full text, verified finding |
| **Corpus snapshot** | The dated set of records and versions actually considered in a specified research activity. | Complete literature, live search |
| **Evidence item** | A located observation, quotation, measurement, or result tied to an exact source version. | Paper summary, citation alone |
| **Source locator** | A reference to the page, paragraph, cell, section, or other position supporting an evidence item. | DOI alone |
| **Claim** | A scoped proposition with an origin, supporting or challenging evidence, and stated qualifications. | Fact, evidence item |
| **Counterevidence** | Evidence that challenges or narrows a particular claim or contribution premise. | Irrelevant result, reviewer disagreement |
| **Research artifact** | A versioned research work product such as an RQ, design, protocol, synthesis, script, or draft. | Chat response, source alone |
| **Research question (RQ)** | The explicit question that defines the evidence a study seeks to produce or interpret. | Topic, hypothesis |
| **Gap assessment** | A dated, search-scoped evaluation of a proposed absence, limitation, or unresolved research need. | Novelty certification |
| **Method profile** | The study-appropriate assumptions and appraisal criteria governing methodological guidance. | Universal checklist, fixed paradigm mapping |
| **Protocol** | The specified research procedures and conditions against which execution and amendments are assessed. | Work contract, software workflow |
| **Amendment** | An explicitly reviewed change to a previously adopted protocol or plan. | Silent edit, retroactive preregistration |
| **Deviation** | A recorded departure from a specified plan during research activity. | Automatically approved amendment |
| **Scholarly assessment** | A reasoned judgment of evidential or methodological quality with stated limits. | Deterministic validation, certification |
| **Issue** | A specific unresolved question or deficiency linked to affected versions and its consequences. | Generic warning, automatic rejection |

## Decisions and research alternatives

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Decision packet** | A versioned presentation of a decision question, exact options, evidence, reviews, and permitted human actions. | Unversioned recommendation, chat message |
| **Checkpoint** | The interaction at which the owner reviews and disposes of a decision packet. | Separate approval database object |
| **Candidate** | An artifact version proposed for review or use without adoption as a commitment. | Approved artifact |
| **Committed version** | An exact artifact version adopted through a human commitment. | Correct version, permanently executable version |
| **Readiness** | The current eligibility of a specified action under dependencies, policy, evidence availability, and external conditions. | Approval, research stage |
| **Impact review** | An assessment of how an adopted change or material source notice affects dependent work. | Automatic rejection, entire-project reset |
| **Research branch** | An alternative set of research artifact versions and dependencies within a project. | Pi conversation branch |
| **Branch promotion** | The explicit adoption of reviewed changes from a research branch into a destination branch. | Automatic merge, chat navigation |
| **Reported prior commitment** | An attributed statement about an earlier decision whose working status requires owner confirmation. | Authenticated Ganesh approval |

## Work and data governance

| Term | Definition | Aliases to avoid |
|---|---|---|
| **Work contract** | The versioned objective, scope, inputs, capabilities, outputs, limits, and authorization basis for bounded work. | Research protocol, unlimited task |
| **Run** | One recorded execution attempt under a particular authorized work contract and input snapshot. | Commitment, fresh budget |
| **Standing permission** | An owner's continuing authorization for a defined class of work within specified conditions and limits. | Blanket approval, permanent permission |
| **Data classification** | The recorded sensitivity category of material before its permitted uses are evaluated. | Automatic disclosure permission |
| **Data-use permission** | Authorization for specified material, destination, purpose, and applicable conditions. | Public label, generic continue |
| **Declassification** | A separately reviewed reduction in derived material's restrictions with recorded basis, authority, and residual risk. | Paraphrasing, automatic anonymization |
| **Revocation** | Withdrawal of permission for further affected operations under current policy across all research branches. | Recall of already disclosed bytes |
| **Review packet** | A permitted export of artifacts, evidence references, and questions for external human feedback. | Live collaboration, authenticated approval |
| **Project snapshot** | A consistent saved set of permitted project records and referenced artifacts with an integrity manifest. | Conversation backup alone |
| **Evidence tombstone** | The permitted non-sensitive record that source material was removed or became unavailable. | Retained source copy, verified-accessible evidence |
| **Local-first** | Local ownership of authoritative project state with external processing only under applicable permissions. | Mandatory offline AI, automatic cloud sync |

## Relationships

- A **Project** has one **Project owner** and zero or more **Research branches**.
- A **Source artifact** has acquired **Source versions**; an **Evidence item** identifies one exact version and **Source locator**.
- A **Claim** can have multiple supporting **Evidence items** and multiple **Counterevidence** links.
- A **Decision packet** references exact **Candidate** versions and dependencies.
- A **Decision record** captures the owner's disposition; approval creates a **Human commitment**.
- A **Human commitment** does not imply current **Readiness** or confer **External authorization**.
- A **Work contract** can have multiple **Runs**, all subject to its cumulative limits and current **Data-use permissions**.
- An **Academic supervisor** can return feedback on a **Review packet**, but the **Project owner** records its disposition.

## Example dialogue

> **Dev:** Is a valid DOI enough to mark a claim supported?
> **Researcher:** No. The evidence item needs a source version, locator, and assessment of what that content supports.
>
> **Dev:** The run succeeded. Is its draft committed?
> **Researcher:** No. Run success registers a candidate; an explicit owner approval creates the commitment.
>
> **Dev:** The protocol was approved last month. Can we execute it now?
> **Researcher:** Check readiness against current dependencies, data-use permissions, and external authorization.
>
> **Dev:** Does switching to an older research branch restore a revoked permission?
> **Researcher:** No. A branch preserves research alternatives, not past permission to disclose data.
>
> **Dev:** The academic supervisor wrote “approved” in an imported review packet.
> **Researcher:** Record attributed feedback. It is not a new authenticated Ganesh commitment or institutional authorization.

## Flagged ambiguities

- **Supervisor:** distinguish the human academic from Ganesh's coordinating role.
- **Approved:** name the human commitment or external authorization; neither means objective scholarly truth.
- **Verified:** identify the actual check—identity, source location, computation, or scholarly support.
- **Decision:** include rejection and deferral; use commitment only for adoption.
- **Branch:** qualify research branch versus Pi conversation branch.
- **Task:** use work contract for authorized scope and run for an execution attempt.
- **Artifact:** distinguish acquired source material from research work products.
- **Checkpoint:** use it for the interaction, not a second object duplicating the decision packet.
- **Immutable:** append-only through normal application operations, subject to lawful deletion; not protection against the machine owner.
- **Complete release:** the approved full capability boundary, not universal methodological expertise or a claim of implementation completion.
