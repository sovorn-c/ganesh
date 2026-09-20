# e19s05 — Honest Release States and GitHub Actions Continuous Verification

## 1. Identity

- **Story ID:** e19s05
- **Epic:** e19 — Researcher-facing workspace polish and continuous verification
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher or reviewer, I want product copy and qualify output to name the real release state, and I want GitHub Actions to run the same Node.js 24 local gates on push and pull request, so that a green workflow is not mistaken for publication, Darwin support, B06, or production readiness.

## 3. Context

E18 ships npm-pack-tarball evidence, a support matrix, and qualify flags `hostedCi: false` and `productionReady: false`. README still talks about development status. No `.github/workflows` exist. `npm run qualify` exits 0 iff `localQualification === "pass"`; shipment blocked does not fail that exit. R18 remains a special-cased qualify outcome. The bundled bigpowers "Test Build Release" workflow includes a release job and is the wrong template.

## 4. Problem

Researchers cannot distinguish a maintained local tarball from private/unpublished from shipment-blocked. Without a verifier workflow, push and PR do not run the local gates. A generic release workflow would publish or claim hosted-ci.

## 5. Goal

`presentReleaseStates` names three states. Qualify render lists R19 and keeps hostedCi/productionReady false. `.github/workflows/local-gates.yml` runs the pinned local commands on `ubuntu-latest` with Node.js 24 for push and pull_request. Tests parse the workflow; they do not require a hosted run.

## 6. Non-Goals

- Completing B06, npm publish, git push, tagging, or deploy.
- Marking Darwin or Windows verified.
- Setting qualify `hostedCi: true`.
- Using the bundled Test Build Release workflow.
- Reopening E18 packaging, signing, or uninstall contracts.

## 7. Stakeholders

- Researchers reading README and qualify output.
- Reviewers checking CI honesty.
- Later `release-check` / production gates, which remain separate.

## 8. Dependencies

- e19s01–e19s04 behaviors so R19 evidence pointers can exist.
- Existing `runReleaseQualification`, support matrix, guide inventory.
- GitHub Actions `actions/checkout` and `actions/setup-node` (workflow-only, not npm packages).
- SC-e19s05-P0-01 through SC-e19s05-P1-04.
- No new production npm package.

## 9. Assumptions

- Workflow name is not "Test Build Release". Permissions stay `contents: read`.
- `npm run qualify` remains the local-qualification command. CI must use the same exit contract. Shipment blocked is not a CI failure.
- R19 is added to qualify metadata and outcome-evidence together in this story, with verification pointers to E19 tests. Invented R19 passed without those pointers fails closed.
- R18 catalog handling stays as E18 left it.
- Local tests parse YAML; they do not run `act` unless already available. Absence of `act` is not a skip of the contract tests.

## 10. Constraints

- Do not expand the support matrix.
- Do not spawn `npm publish`, `git push`, or tag commands from the workflow or from `presentReleaseStates`.
- Do not claim CI passing is B06 or scholarly certification.
- Do not store GitHub secrets for publishing.

## 11. Domain Model

- **Release state:** one of maintained-local-tarball, private-unpublished, shipment-blocked. Production-ready is not a fourth claim this story can set.
- **Continuous verification:** GitHub Actions running existing local commands. Distinct from qualify `hostedCi`.

## 12. Requirements

### ADDED: Honest release states and GitHub Actions verifier

`presentReleaseStates()` MUST distinguish maintained local npm tarball, private/unpublished distribution, and shipment blocked by B06, publication authorization, or production-readiness. `.github/workflows/local-gates.yml` MUST trigger on push and pull_request, set Node.js 24, and run `npm run preflight`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run qualify`. The workflow MUST NOT publish, tag, deploy, or mark Darwin/Windows/B06/production-ready.

### MODIFIED: Hosted CI exclusion from E18 distribution freeze

**Before:** E18 excluded hosted CI and froze `src/workspace/**`. Qualify `hostedCi` and `productionReady` stayed false. Qualify rendered Scope Outcomes R01–R18.

**After:** E19 adds GitHub Actions as a verifier of existing local commands only. `hostedCi` and `productionReady` remain false. R19 is listed in qualify output. Workspace polish from e19s01–e19s04 remains in force. Support matrix and packaging contracts stay as E18 left them.

## 13. Non-Functional Requirements

- **Honesty:** CI pass ≠ production-ready, B06, or extra OS support.
- **Integrity:** workflow commands match package.json scripts.
- **Privacy:** workflow does not upload research artifacts or `.ganesh`.

## 14. Contracts

### New contracts

- `presentReleaseStates(): ReleaseStateView`
- `loadContinuousVerificationWorkflow(root): WorkflowReport`
- `src/distribution/release-messaging.ts`
- `src/distribution/continuous-verification.ts`
- `.github/workflows/local-gates.yml`
- `tests/distribution/release-messaging.test.ts`
- `tests/distribution/continuous-verification.test.ts`

### Existing contracts preserved

- `hostedCi: false`, `productionReady: false`, `scholarlyCertification: "not-inferred"`
- Support matrix verified/unverified rules
- `npm run qualify` exit 0 iff localQualification pass
- E18 packaging evidence validator

## 15. Reason for Depth and Zoom-Out

**Purpose of `runReleaseQualification`:** compose local qualification and keep shipment flags honest. **Callers:** `src/qualify-cli.ts`. **Contracts:** hostedCi/productionReady false; R18 special case; shipment blocked without B06.

Reason for depth: release-state copy and workflow validation belong in `src/distribution/`, not in the TUI. A second qualify implementation inside GitHub Actions YAML would drift.

## 16. Implementation Steps

1. Add release-state presenter and product/qualify copy for tarball, unpublished, and shipment-blocked → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s05.*(tarball|unpublished|shipment-blocked|B06)' dist/tests/*/*.test.js`
2. Add the GitHub Actions workflow and a parser that requires push/PR, Node 24, ubuntu-latest, and the pinned local commands → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s05.*(workflow|push|pull_request|node-version|preflight|qualify)' dist/tests/*/*.test.js`
3. Refuse Darwin/Windows/B06/production-ready/publish claims, keep hostedCi and productionReady false, list R19 honestly, and record no new security findings → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e19s05.*(darwin|windows|production-ready|hostedCi|publish|R19)' dist/tests/*/*.test.js`
4. Keep released E01-E18 behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e19s05-P0-01: Three release states are distinct

```gherkin
Given presentReleaseStates and qualify render after this story
When a researcher reads them
Then maintained local npm tarball, private/unpublished, and shipment-blocked are named separately
And production-ready is not asserted
```

### Scenario SC-e19s05-P0-02: Workflow runs the local Node 24 gates on push and PR

```gherkin
Given .github/workflows/local-gates.yml
When loadContinuousVerificationWorkflow parses it
Then on includes push and pull_request
And node-version is 24
And runs-on is ubuntu-latest
And the job runs npm run preflight, npm test, npm run typecheck, npm run lint, npm run build, and npm run qualify
```

### Scenario SC-e19s05-P0-03: Workflow and copy refuse extra claims and publish

```gherkin
Given the workflow and release-state copy
When they are validated
Then they do not mark Darwin or Windows verified
And they do not claim B06 complete
And they do not spawn npm publish, git push, or tag
```

### Scenario SC-e19s05-P1-04: Qualify flags stay false and R19 is listed honestly

```gherkin
Given runReleaseQualification after this story
When the report is rendered
Then hostedCi is false
And productionReady is false
And R19 is listed
And an invented R19 passed row without E19 verification pointers is rejected
```

## 18. Verification Script (Step-by-Step)

1. Read release-state presenter and README/qualify text for the three states.
2. Parse the workflow; confirm triggers, Node 24, and commands.
3. Confirm no publish/tag/Darwin/B06/production-ready claims.
4. Run qualify against a fixture; confirm hostedCi/productionReady false and R19 listed.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **CI as release authority:** hostedCi stays false; T-E19-09.
- **Support-matrix creep:** workflow runner is ubuntu-latest only; matrix unchanged.
- **Qualify always red:** do not fail CI on shipment-blocked; keep existing localQualification exit contract.
- **Bundled release template:** custom local-gates.yml; not Test Build Release.

## 20. Traceability

- Scope outcome: R19 criteria 5 and 6
- Epic acceptance: honest release messaging and GitHub Actions verifier
- Test scenarios: SC-e19s05-P0-01, SC-e19s05-P0-02, SC-e19s05-P0-03, SC-e19s05-P1-04
- Domain contracts: Support matrix; Release qualification
- Language: Competency inventory; shipment blocked
- Security: T-E19-09, T-E19-10
