# e19s03 — Executable Competency Subset with Provenance and Escalation

## 1. Identity

- **Story ID:** e19s03
- **Epic:** e19 — Researcher-facing workspace polish and continuous verification
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher using the five selected competencies, I want each affordance to show provenance, uncertainty, unsupported context, and escalation, so that catalog metadata is not mistaken for twenty-two implemented skills.

## 3. Context

`specs/qualification/competency-inventory.json` holds 22 metadata rows. `validateCompetencyInventory` already refuses certification claims. e19s02 adds command entry points. The selected executable subset is comp-01, comp-02, comp-05, comp-08, and comp-22. Specialist coordination stays an entry point, not a sixth competency file.

## 4. Problem

Without a runtime distinction, help or inventory text can imply every catalog row is an implemented skill. Unsupported contexts and uncertainty can disappear behind a successful store write.

## 5. Goal

`presentCompetencyAffordance` wraps the five entry points with inventory fields: provenance, uncertainty, unsupported contexts, and human escalation. Non-selected rows stay `metadata-only`. Tests fail if a 22-file skill tree appears.

## 6. Non-Goals

- Implementing the other 17 competencies as runtime commands.
- Completing B06 named human reviews.
- Changing inventory JSON required qualification fields except honesty flags consumed by the workspace.
- Execution-mode auto-selection; e19s04 owns mode guidance.

## 7. Stakeholders

- Researchers judging whether a competency is actually runnable.
- Qualification reviewers who must still treat the inventory as metadata, not certification.

## 8. Dependencies

- e19s02 entry points.
- Existing `loadCompetencyInventory` / `validateCompetencyInventory`.
- Method-profile `outside-competence` handling in `profile-store.ts` as the escalation pattern to reuse, not rewrite.
- SC-e19s03-P0-01 through SC-e19s03-P1-04.
- No new package.

## 9. Assumptions

- Executable means inspectable runtime affordance over an existing store, not a new Pi skill file.
- Unsupported context is taken from inventory `unsupportedContexts` plus current method-profile competence when a profile is bound.
- Human escalation is required when context is outside competence or required inputs are missing. Silent success is a fail.
- Skill-file explosion is detected by counting new files under `skills/` and `.ganesh/pi` skill trees in tests; production must not add those files.

## 10. Constraints

- Do not claim scholarly certification from inventory pass.
- Do not write 22 skill files or a second catalog format.
- Preserve inventory validation used by `npm run qualify`.
- Specialist command remains available from e19s02 without a competency id.

## 11. Domain Model

- **Competency affordance:** runtime view of one selected inventory row plus store-backed output, provenance, uncertainty, unsupported-context, and escalation.
- Distinct from **Competency inventory** metadata and from a Pi skill file.

## 12. Requirements

### ADDED: Executable competency subset

`presentCompetencyAffordance(session, competencyId)` MUST succeed for comp-01, comp-02, comp-05, comp-08, and comp-22. Each result MUST include provenance, uncertainty, unsupported-context, and an escalation field when required. Other inventory ids MUST return `metadata-only` and MUST NOT claim implementation.

### MODIFIED: Competency inventory as metadata-only qualification artifact

**Before:** The inventory was a qualification metadata catalog. The workspace had no executable subset and no metadata-versus-runtime distinction.

**After:** Workspace affordances mark only the five selected competencies executable. `validateCompetencyInventory` still must not infer certification. A claim that all 22 rows are implemented skills fails closed.

## 13. Non-Functional Requirements

- **Honesty:** metadata-only rows cannot be reported as implemented skills.
- **Provenance:** outputs keep observation/inference/recommendation separation already required by inventory `outputProvenance`.
- **Escalation:** out-of-competence paths require a human-escalation marker.

## 14. Contracts

### New contracts

- `presentCompetencyAffordance(session, competencyId): AffordanceView`
- `src/workspace/competency-affordances.ts`
- `tests/workspace/competency-affordances.test.ts`

### Existing contracts preserved

- `validateCompetencyInventory` field requirements and certification refusal
- e19s02 command names and store calls
- E09 outside-competence profile binding

## 15. Reason for Depth and Zoom-Out

**Purpose of `validateCompetencyInventory`:** fail-closed metadata checks for qualification. **Callers:** `runReleaseQualification`. **Contracts:** 22 rows, worked failures, licenses, provenance, no certification flags.

Reason for depth: the affordance layer is a presenter that consumes inventory metadata and existing stores. Folding it into `competency-inventory.ts` would mix qualification catalogs with workspace UX.

## 16. Implementation Steps

1. Add affordance views for the five selected competency ids over e19s02 entry points → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s03.*(comp-01|comp-02|comp-05|comp-08|comp-22|affordance)' dist/tests/*/*.test.js`
2. Surface provenance, uncertainty, and unsupported-context on those views → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s03.*(provenance|uncertainty|unsupported)' dist/tests/*/*.test.js`
3. Keep non-selected rows metadata-only, require human escalation outside competence, refuse a 22-file skill tree, and record no new security findings → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s03.*(metadata-only|escalat|skill.file|22)' dist/tests/*/*.test.js`
4. Keep released E01-E18 behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e19s03-P0-01: Five competencies are inspectable affordances

```gherkin
Given a project with owner capability
When presentCompetencyAffordance is called for comp-01, comp-02, comp-05, comp-08, and comp-22
Then each result status is executable
And each result names the backing store from plan_pins
```

### Scenario SC-e19s03-P0-02: Provenance, uncertainty and unsupported context stay visible

```gherkin
Given an executable affordance result
When the view is rendered
Then provenance fields are present
And uncertainty is stated
And inventory unsupportedContexts are listed
```

### Scenario SC-e19s03-P0-03: Catalog remainder stays metadata and no skill-file tree is added

```gherkin
Given the 22-row competency inventory
When a non-selected id is presented
Then the result is metadata-only
And it does not claim the competency is implemented
And the workspace adds no 22-file skill catalog
```

### Scenario SC-e19s03-P1-04: Outside competence requires human escalation

```gherkin
Given a selected competency invoked in an unsupported or outside-competence context
When the affordance is presented
Then escalation is required
And the result is not a silent in-competence success
```

## 18. Verification Script (Step-by-Step)

1. Present each of the five ids; confirm executable.
2. Read provenance, uncertainty, and unsupported-context fields.
3. Present a non-selected id; confirm metadata-only.
4. Bind an outside-competence profile; confirm escalation.
5. Assert no 22-file skill tree; run typecheck, lint, build and test.

## 19. Risks and Mitigations

- **Catalog over-claim:** explicit metadata-only status; T-E19-05.
- **Silent incompetence:** escalation required; reuse E09 competence, do not invent a new engine.
- **Skill-file sprawl:** test counts skill files.

## 20. Traceability

- Scope outcome: R19 criterion 3
- Epic acceptance: five executable competencies with honesty
- Test scenarios: SC-e19s03-P0-01, SC-e19s03-P0-02, SC-e19s03-P0-03, SC-e19s03-P1-04
- Domain contracts: Competency, Competency inventory
- Language: Competency, Competency inventory
- Security: T-E19-05, T-E19-06
