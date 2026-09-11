# e05s02 — Specialist Roles Return Versioned Candidates and Disagreements

## 1. Identity

- **Story ID:** e05s02
- **Epic:** e05 — Bounded autonomous work and specialist coordination
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want Supervisor, Discovery, Evidence, Methodology and Reviewer runs to keep separate snapshots and preserve disagreements so that coordination does not hide dissent or invent extra authority.

## 3. Context

e05s01 proves one authorized Supervisor run. This slice adds the remaining specialist roles as bounded session configurations, role-specific snapshots, structured diagnostics and disagreement records. Research-competency quality remains later epics.

## 4. Problem

A single mixed context lets a reviewer see the supervisor's preferred answer, lets specialists call each other, or collapses conflicting findings into one fluent summary. AC-14 requires both positions to remain visible and forbids an indefinite review loop.

## 5. Goal

Dispatch each of the five roles with a distinct least-privilege snapshot, register versioned candidates and diagnostics, persist disagreements with source bases, allow one targeted revision inside the contract, and return persistent conflict to the owner.

## 6. Non-Goals

- Contract authorization, standing permissions and the first Supervisor tracer path; e05s01 owns these.
- Spend caps and concurrent budget races; e05s03 owns these.
- Cancellation and late-output quarantine; e05s04 owns these.
- Provider retry and session rebind; e05s05 owns these.
- Evidence appraisal, literature search quality, method design, writing review, terminal UX.

## 7. Stakeholders

- Owners inspecting specialist disagreement instead of a single synthesized pass.
- Later E07-E13 consumers of role-tagged candidates.
- Reviewers who must not be instructed to endorse the Supervisor recommendation.

## 8. Dependencies

- e05s01 work contracts, runs, snapshots, reservation and candidate registration.
- `specs/docs/03-agents-and-skills.md` role table and reviewer independence rules.
- `specs/docs/05-decisions-and-acceptance.md` AC-14.
- `specs/tech-architecture/e05-TEST_PLAN_LATEST.md` SC-e05s02-P0-01 through SC-e05s02-P1-04.

## 9. Assumptions

- Role IDs are `supervisor`, `discovery`, `evidence`, `methodology` and `reviewer`.
- Parallelism is allowed only for independent assigned work. Synthesis waits for its evidence inputs; the runtime records that wait as `waiting-for-human` or blocked when inputs are missing, and does not invent them.
- One targeted revision means one additional Reviewer or Methodology run under the same contract version after a recorded disagreement. A second unresolved conflict stops specialist dispatch for that question.
- Specialist output is schema-validated structured content from the SessionPort, not a claim of scholarly correctness.

## 10. Constraints

- Each run names exactly one role from the contract's permitted role set.
- A Reviewer snapshot includes the candidate artifact, declared rationale, review question and applicable standards. It MUST NOT include an instruction to endorse the Supervisor recommendation.
- Specialists cannot grant standing permissions, authorize contracts, dispatch other specialists, or call owner operations.
- Disagreement records store both role IDs, candidate version IDs and the stated source bases. They are append-only for that contract version.
- Diagnostics omit unassigned source bytes, credentials and conversation transcripts.

## 11. Domain Model

- **Specialist role:** a bounded session configuration with allowed tools and output schema.
- **Role snapshot:** assigned versions plus role-specific packet fields; not the project conversation.
- **Disagreement record:** two or more role-tagged candidates for one question with retained source bases.
- **Targeted revision:** one additional run permitted after the first disagreement inside remaining contract limits.
- **Human return:** a terminal run outcome that requires owner disposition rather than another specialist loop.

## 12. Requirements

### ADDED: Five role configurations

The runtime MUST accept Supervisor, Discovery, Evidence, Methodology and Reviewer runs under an authorized contract that lists those roles. Each run MUST receive a distinct assigned snapshot.

### ADDED: Versioned candidates, diagnostics and disagreements

Each successful role run MUST register a versioned candidate and bounded diagnostics. Conflicting Reviewer and Methodology (or other role) findings MUST persist both positions and source bases.

### ADDED: Finite revision, no recursive authority

After one recorded disagreement, at most one targeted revision run is admitted. A further conflict MUST return to the owner. Specialists MUST NOT enlarge scope, grant capabilities or dispatch other specialists.

## 13. Non-Functional Requirements

- **Integrity:** disagreement records survive reopen and are not rewritten into a single pass.
- **Security:** role snapshots cannot confer owner authority or unassigned reads.
- **Privacy:** diagnostics contain no restricted excerpts.
- **Compatibility:** e05s01 contracts and released E01-E04/E06 tests remain passing.

## 14. Contracts

### New contracts

- `queueRoleRun(handle, capability, request): RunRecord` where `request.role` is one of the five roles.
- `readRoleSnapshot(handle, workerCapability, runId): RoleSnapshot`
- `recordDisagreement(handle, capability, request): DisagreementRecord`
- `listDisagreements(handle, contractVersionId): readonly DisagreementRecord[]`
- `requestTargetedRevision(handle, capability, disagreementId): RunRecord | HumanReturn`

### Existing contracts preserved

- e05s01 authorize/dispatch/accept and E03 lifecycle checkpoints.
- E04 still owns human disposition of the resulting packet; this story only preserves material for that packet.

## 15. Reason for Depth and Zoom-Out

`src/work/specialist-coordination.ts` owns role snapshot construction, disagreement persistence and the one-revision gate. It calls `work-runtime.ts` rather than duplicating reservation or policy. A generic multi-agent framework is rejected because five named roles are a closed set.

## 16. Implementation Steps

1. Add the five role IDs, role snapshots and independent-run admission on authorized contracts → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s02.*(role|snapshot|supervisor|discovery|evidence|methodology|reviewer)' dist/tests/*/*.test.js`
2. Persist versioned candidates, diagnostics and disagreements with source bases after reopen → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s02.*(candidate|diagnostic|disagreement|reopen)' dist/tests/*/*.test.js`
3. Allow one targeted revision and return a second conflict to the owner; deny recursive specialist dispatch and capability grants → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s02.*(revision|loop|recursive|grant|dispatch other)' dist/tests/*/*.test.js`
4. Prove snapshot omission of conversation/unassigned sources, redacted diagnostics and released regressions with no new security findings in affected paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e05s02.*(omit|conversation|unassigned|redact|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e05s02-P0-01: Five roles, distinct snapshots

```gherkin
Given an authorized contract that permits all five roles
When each role is dispatched with its assigned versions
Then each run records a distinct snapshot and a versioned candidate with diagnostics
```

### Scenario SC-e05s02-P0-02: Disagreement is retained (AC-14)

```gherkin
Given a Methodology candidate and a conflicting Reviewer finding
When the conflict is recorded
Then both positions and source bases remain inspectable after reopen
And a second unresolved conflict returns to the owner instead of another specialist loop
```

### Scenario SC-e05s02-P0-03: No recursive authority

```gherkin
Given a specialist worker capability
When it attempts to authorize a contract, grant a standing permission or queue another specialist
Then the operation is denied
```

### Scenario SC-e05s02-P1-04: Snapshots stay least privilege

```gherkin
Given conversation history and an unassigned source version in the project
When a role snapshot is built
Then those materials are omitted
And diagnostics contain no restricted excerpts
```

## 18. Verification Script (Step-by-Step)

1. Authorize a multi-role contract and dispatch five fake-port runs with distinct assigned versions.
2. Submit a Methodology candidate and a conflicting Reviewer finding; inspect both after reopen.
3. Request one targeted revision, then a second conflict, and confirm human return.
4. Attempt specialist-granted authorization and unassigned snapshot inclusion; confirm denial.
5. Run the full inherited suite under Node.js 24.

## 19. Risks and Mitigations

- **Hidden dissent:** disagreements are first-class rows, not a summary field that can drop a side.
- **Reviewer contamination:** snapshot builder strips endorsement instructions and Supervisor-preferred answers unless they are the artifact under review.
- **Infinite loops:** a counter on the contract version gates the second revision.

## 20. Traceability

- Scope outcome: R05
- Epic acceptance scenarios: AC-14, AC-09
- Test scenarios: SC-e05s02-P0-01, SC-e05s02-P0-02, SC-e05s02-P0-03, SC-e05s02-P1-04
- Domain contracts: ubiquitous language for Ganesh Supervisor versus Academic supervisor; `specs/docs/03-agents-and-skills.md` §§2, 9
