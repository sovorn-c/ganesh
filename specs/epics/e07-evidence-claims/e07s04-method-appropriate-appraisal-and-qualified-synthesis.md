# e07s04 — Method-Appropriate Appraisal and Qualified Synthesis

## 1. Identity

- **Story ID:** e07s04
- **Epic:** e07 — Located evidence and accountable claims
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 4
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want method-appropriate appraisal of a source and a qualified synthesis of the current evidence matrix so that a reflexive thematic-analysis study is not failed for missing inter-coder agreement, ignored clustering in a quantitative study is raised, and labels are never treated as scholarly validity.

## 3. Context

e07s03 provides a matrix that retains disagreement. AC-11 requires method-appropriate appraisal. E09 later owns method design and richer method profiles; this slice ships a bounded method-kind vocabulary sufficient for AC-11 software behavior. E17 later owns expert review of the reasoning, not only the labels.

## 4. Problem

A universal checklist that fails qualitative work for missing kappa or power, or a synthesis that declares the corpus settled because every row has a label, would fake rigor and hide disagreement.

## 5. Goal

Record an appraisal keyed to a method kind with applicable/not-applicable checks; synthesize the current matrix into a durable record that retains disagreements, limitations and qualifications; keep E04 scholarly findings and human commitments as separate objects.

## 6. Non-Goals

- Designing the researcher's own study, RQ alternatives or full method profiles; E09 owns those.
- Causal-identification coaching beyond recording the quantitative clustering issue; AC-12 remains E09/E17.
- Expert-human grading of appraisal rationale; E17 owns that qualification.
- Literature gap/contribution challenge; E08 owns those.
- Replacing E04 `scholarly_findings` or converting an override into a pass.
- TUI synthesis reports.

## 7. Stakeholders

- Researchers appraising acquired studies as evidence.
- E09/E17 later consumers of method-kind and appraisal records.
- Reviewers who must still see retained dissent in E04 packets.

## 8. Dependencies

- e07s01–e07s03 items, claims, matrix and reassessment overlay.
- E04 `recordScholarlyFinding` / `listScholarlyFindings` as an optional link target, not a writer by default.
- `specs/docs/05-decisions-and-acceptance.md` AC-11.
- `specs/tech-architecture/e07-TEST_PLAN_LATEST.md` SC-e07s04-P0-01 through SC-e07s04-P1-04.

## 9. Assumptions

- Bounded method kinds for this epic: `reflexive-thematic-analysis`, `quantitative-dependent-observations`, and `unspecified`.
- For `reflexive-thematic-analysis`, checks named `inter-coder-agreement` and `statistical-power` are `not-applicable`. Missing those values MUST NOT produce appraisal result `fail`.
- For `quantitative-dependent-observations`, check `dependent-observations-addressed` is applicable. When the recorded analysis ignores clustering/repeated measures, appraisal MUST include an `analysis-issue` finding. Relabeling the design as longitudinal MUST NOT by itself clear that finding.
- Synthesis reads the current matrix, including `needs-reassessment` overlays, and stores qualifications plus disagreement/limitation lists. It never sets claim support to `substantively-supported`.
- Specialist-origin appraisals are `specialist-proposed`. They are not scholarly validity and not commitments.

## 10. Constraints

- `recordAppraisal` requires owner identity or worker `evidence:appraise` and a real source version ID.
- Appraisal findings are structured `{ dimension, applicability, result, rationale }` rows. `not-applicable` dimensions MUST NOT fail the appraisal.
- `synthesizeClaims` requires `claim:inspect` and MUST copy matrix disagreement and limitation cells into the synthesis record. Empty disagreement because the builder dropped cells is a defect.
- Optional `scholarlyFindingId` on an appraisal MAY reference an existing E04 finding. This story MUST NOT insert into `scholarly_findings` unless the caller explicitly uses the E04 API.
- Schema validation of appraisal JSON is software correctness, not scholarly validity.

## 11. Domain Model

- **Appraisal record:** method kind plus dimension findings for one source version.
- **Applicability:** `applicable` or `not-applicable` for a named dimension under that method kind.
- **Synthesis record:** durable qualified summary of named claims with retained disagreements, limitations and reassessment flags.
- **Scholarly validity:** out of band; not a field this story is allowed to set to true.

## 12. Requirements

### ADDED: Method-appropriate appraisal

Given a defensible reflexive thematic-analysis study, appraisal MUST NOT fail it solely for missing inter-coder agreement or statistical power.

### ADDED: Quantitative dependent-observation issue

Given a quantitative study with ignored dependent observations, appraisal MUST raise the relevant analysis issue. Changing only a design label MUST NOT clear it.

### ADDED: Qualified synthesis

`synthesizeClaims` MUST retain disagreements, limitations, corrections/reassessment flags and access limits from the matrix. It MUST NOT claim universal support or exhaustive coverage.

### ADDED: Separate from commitments and E04 findings

Appraisal and synthesis MUST NOT create human commitments. E04 scholarly findings remain reviewer findings for decision packets.

## 13. Non-Functional Requirements

- **Honesty:** labels and schema success are not scholarly validity.
- **Integrity:** appraisal and synthesis reconstruct after reopen.
- **Compatibility:** E04 override and commitment tests remain passing.
- **Scope:** method design stays in E09; expert review stays in E17.

## 14. Contracts

### New contracts

- `recordAppraisal(handle, capability, request): AppraisalRecord`
- `getAppraisal(handle, capability, appraisalId): AppraisalRecord`
- `synthesizeClaims(handle, capability, request): SynthesisRecord`
- `getSynthesis(handle, capability, synthesisId): SynthesisRecord`

### Existing contracts preserved

- Evidence matrix builder remains the source of disagreement/limitation cells.
- `listScholarlyFindings` / `recordScholarlyFinding` remain E04 APIs.
- `listCommitments` remains empty unless E04 owner confirmation occurred.

## 15. Reason for Depth and Zoom-Out

`src/evidence/appraisal.ts` owns method-kind rules and synthesis persistence so claim-store does not embed checklist policy. Reason for depth: AC-11 rules would otherwise leak into claim verification. No generic rules-engine package.

Planned tests: `tests/evidence/appraisal-synthesis.test.ts`.

## 16. Implementation Steps

1. Record thematic-analysis appraisal that does not fail for missing kappa or power → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s04.*(thematic|kappa|inter-coder|power|not.fail)' dist/tests/*/*.test.js`
2. Raise ignored dependent observations for the quantitative method kind → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s04.*(quantitative|dependent observation|cluster|analysis issue)' dist/tests/*/*.test.js`
3. Synthesize the current matrix with retained disagreement, limitation and qualification fields and no validity claim → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s04.*(synthesis|disagreement|limitation|qualification|validity)' dist/tests/*/*.test.js`
4. Keep E04 findings and commitments separate and keep the quality gate passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e07s04.*(scholarly finding|commitment|specialist|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e07s04-P0-01: Thematic analysis is not failed for kappa or power

```gherkin
Given a source appraised as reflexive-thematic-analysis with no inter-coder agreement or statistical power reported
When appraisal is recorded
Then those dimensions are not-applicable
And the appraisal result is not fail solely for their absence
```

### Scenario SC-e07s04-P0-02: Quantitative ignored clustering is raised

```gherkin
Given a quantitative source whose recorded analysis ignores dependent observations
When appraisal is recorded
Then an applicable analysis-issue finding is present
And relabeling the design as longitudinal without addressing dependence does not clear it
```

### Scenario SC-e07s04-P0-03: Synthesis retains dissent

```gherkin
Given a matrix with supporting and challenging links, limitations and a needs-reassessment claim
When synthesis runs
Then disagreements, limitations and reassessment flags are stored on the synthesis record
And the record does not claim universal support or scholarly validity
```

### Scenario SC-e07s04-P1-04: Labels are not commitments or E04 findings

```gherkin
Given a completed appraisal and synthesis, including a specialist-proposed appraisal
When the owner lists commitments and scholarly findings
Then no new commitment exists
And no scholarly_findings row was inserted by the appraisal API
```

## 18. Verification Script (Step-by-Step)

1. Appraise a thematic-analysis fixture missing kappa and power; assert not-applicable rather than fail.
2. Appraise a quantitative fixture with ignored clustering; assert analysis-issue; relabel and re-appraise without clearing it.
3. Synthesize a matrix that includes challenge cells and a reassessment overlay.
4. Confirm `listCommitments` is empty and `listScholarlyFindings` is unchanged.
5. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Universal checklist:** method-kind table drives applicability; tests lock AC-11.
- **Validity inflation:** synthesis type has no `valid`/`passed` field; tests reject those strings in stored qualifications.
- **E04 collision:** appraisal table is separate; optional ID is a reference only.
- **E09 overlap:** method kinds here appraise acquired sources, they do not design the owner's study.

## 20. Traceability

- Scope outcome: R07
- Epic acceptance scenarios: AC-11
- Test scenarios: SC-e07s04-P0-01, SC-e07s04-P0-02, SC-e07s04-P0-03, SC-e07s04-P1-04
- Language: Claim, Evidence item, Counterevidence, Method profile (bounded kind only)
- Acceptance: `specs/docs/05-decisions-and-acceptance.md` AC-11
