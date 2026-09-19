# e18s05 — Explicit-Authorization SemVer Procedure and Evidence-Backed R18 Gate

## 1. Identity

- **Story ID:** e18s05
- **Epic:** e18 — Installable maintained local release
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 3
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a release operator, I want a local SemVer procedure that consumes `npm run qualify` and packaging evidence, stays unpublished unless I explicitly authorize, and lets R18 pass only on real evidence, so that shipment cannot be invented and hosted CI is not introduced.

## 3. Context

`runReleaseQualification` currently hardcodes R18 to `blocked` even if the catalog claims passed. `humanEvaluation.hasQualifiedHumanCoverage` is false until B06 records exist, so shipment stays blocked. `qualify-cli.ts` is a focused CLI like preflight. No release-procedure command exists. `package.json` is `private: true` at 0.1.0.

## 4. Problem

Leaving the R18 hardcoded block forever would make E18 evidence invisible. Trusting a catalog `passed` row without artifacts would invent R18. Auto-publish would violate explicit authorization.

## 5. Goal

`runReleaseProcedure` consumes qualify, `validatePackagingEvidence` (matrix, manifest, licenses, signing, guides, lifecycle record) and Conventional Commits to propose a SemVer bump. Publication is `not-authorized` unless `--i-authorize-publication` is passed. The procedure does not `npm publish`, push, tag, or set `hostedCi` / `productionReady`. R18 becomes `passed` only when packaging evidence validates. Invented catalog rows fail closed. Shipment stays blocked without B06 coverage.

## 6. Non-Goals

- Completing B06 named humans.
- Hosted CI, coverage SaaS, GitHub Actions.
- Actually publishing to npm or changing `private` to false in the default path.
- Setting production-ready.
- Unfreezing the TUI.

## 7. Stakeholders

- Operators running a local release.
- E17 qualify consumers who need an evidence-backed R18 row.
- Reviewers checking shipment versus local qualification.

## 8. Dependencies

- e18s01–e18s04 validators.
- `runReleaseQualification` and `src/qualify-cli.ts`.
- SC-e18s05-P0-01 through SC-e18s05-P1-04.
- Existing e17s05 tests that currently assert R18 blocked against repo root; those oracles MUST move to fixtures so "no invented pass" remains and evidence-backed pass is allowed.

## 9. Assumptions

- `npm run release-procedure` is `npm run build && node dist/src/release-cli.ts` with `--json` and optional `--i-authorize-publication`.
- Conventional Commits since the last git tag (or first commit if untagged) map feat → minor, fix → patch, breaking → major. The procedure proposes; it does not write the tag.
- `validatePackagingEvidence` is the conjunction of s01–s04 validators plus a lifecycle record from s03 tests/docs.
- `ReleaseQualificationReport.hostedCi` and `productionReady` stay typed `false`.
- After evidence exists, `specs/qualification/outcome-evidence.json` R18 may be `passed` with pointer `specs/verifications/e18-verify.yaml` (written at verify-work, not at plan time).

## 10. Constraints

- MUST NOT call `npm publish`, `git push`, or `git tag`.
- MUST NOT set hosted-ci or production-ready.
- MUST NOT launch `runWorkspace`.
- MUST keep shipment blocked when `hasQualifiedHumanCoverage` is false.
- Schema marker stays 1.

## 11. Domain Model

- **Publication authorization:** explicit operator flag recorded on a local release packet. Distinct from qualify local pass and from production-ready.
- **Packaging evidence:** the s01–s04 records that may unblock R18.

## 12. Requirements

### ADDED: Local release procedure

`runReleaseProcedure(root, options)` MUST compose qualify, packaging evidence and a SemVer proposal. Default `publication` is `not-authorized`.

### ADDED: Explicit publication flag

Only `--i-authorize-publication` may set `publication: authorized-local`. The procedure still MUST NOT spawn `npm publish`. Missing flag keeps `not-authorized`.

### MODIFIED: Qualification gate R18 outcome

**Before:** `runReleaseQualification` always emitted R18 status `blocked` and never read packaging evidence.

**After:** R18 is `passed` only when `validatePackagingEvidence` accepts the matrix, package manifest, license inventory, signing-applicability record, guide inventory and lifecycle record. A catalog `passed` row without those artifacts is rejected as invented evidence and R18 stays `blocked`. Shipment stays `blocked` while B06 qualified-human coverage is absent, a critical safety defect is open, or any outcome is blocked or unimplemented.

## 13. Non-Functional Requirements

- **Honesty:** two verdicts remain (`localQualification` vs `shipment`); publication is a third field on the procedure report, not a qualify flag.
- **Automation:** non-interactive CLI, exit non-zero on block.
- **Authority:** publication requires explicit operator language.

## 14. Contracts

### New contracts

- `runReleaseProcedure(root, options?): ReleaseProcedureReport`
- `validatePackagingEvidence(root): PackagingEvidenceReport`
- `src/release-cli.ts` plus `package.json` script `release-procedure`

### Existing contracts preserved

- `runReleaseQualification` section shape, forbidden flags, qualify CLI arguments except that R18 may pass with evidence
- `ganesh` bin still launches the workspace
- preflight check ids

## 15. Reason for Depth and Zoom-Out

**Purpose of `src/qualification/release-gate.ts`:** compose E17 catalogs and shipment blockers. **Callers:** `qualify-cli.ts`, tests. **Contracts:** two verdicts, R01–R18 list, forbidden flags, no TUI.

Reason for depth: replace the R18 hardcoded block with evidence validation inside the existing gate rather than a second qualify. Release-procedure stays a focused CLI (ADR 0002).

## 16. Implementation Steps

1. Add release procedure composing qualify, packaging evidence and SemVer proposal with publication not-authorized by default → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s05.*(procedure|semver|conventional|not-authorized|qualify)' dist/tests/*/*.test.js`
2. Require explicit authorization flag; never publish, push, tag, or set hosted-ci or production-ready → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s05.*(authorize|publication|publish|hosted|production-ready|flag)' dist/tests/*/*.test.js`
3. Pass R18 only on validating packaging evidence; reject invented rows; keep shipment blocked without B06; no new security findings in the CLI path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s05.*(R18|packaging-evidence|invent|shipment|human|B06)' dist/tests/*/*.test.js`
4. Keep qualify, preflight and Node.js 24 checks passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && npm run preflight && npm run qualify`

## 17. Acceptance Criteria

### Scenario SC-e18s05-P0-01: Procedure composes qualify and evidence

```gherkin
Given fixture catalogs where qualify local-qualification can pass and packaging evidence is valid
When runReleaseProcedure runs without the authorization flag
Then the report includes qualify, packagingEvidence and a semverProposal
And publication is not-authorized
```

### Scenario SC-e18s05-P0-02: Authorization flag does not publish

```gherkin
Given the same valid fixtures
When runReleaseProcedure runs with --i-authorize-publication
Then publication is authorized-local
And hostedCi is false
And productionReady is false
And npm publish was not spawned
```

### Scenario SC-e18s05-P0-03: R18 requires packaging evidence

```gherkin
Given outcome-evidence.json with R18 status passed and no packaging evidence files
When runReleaseQualification runs
Then R18 is blocked
And the reason names invented evidence
```

### Scenario SC-e18s05-P1-04: B06 still blocks shipment

```gherkin
Given valid packaging evidence and R18 passed
And human evaluation lacks qualified-human coverage
When the gate runs
Then shipment is blocked
```

## 18. Verification Script (Step-by-Step)

1. Run release-procedure `--json` on a fixture root; confirm `not-authorized`.
2. Pass `--i-authorize-publication`; confirm authorized-local and no publish spawn.
3. Set catalog R18 passed without evidence files; confirm blocked.
4. Confirm shipment blocked without B06.
5. Run typecheck, lint, build, test, preflight and qualify under Node.js 24.

## 19. Risks and Mitigations

- **E17 repo-root test still asserts R18 blocked:** move that oracle to a fixture; keep "no invented pass".
- **Verdict collapse:** qualify keeps two fields; procedure adds `publication` separately.
- **Accidental publish:** no spawn of npm publish in source.

## 20. Traceability

- Scope outcome: R18 criterion 4
- Epic acceptance scenarios: AC-20
- Test scenarios: SC-e18s05-P0-01, SC-e18s05-P0-02, SC-e18s05-P0-03, SC-e18s05-P1-04
- Domain contracts: qualification gate R18; publication authorization
- Language: Publication authorization, Qualification gate
- Security: T-E18-10, T-E18-11, T-E18-12
