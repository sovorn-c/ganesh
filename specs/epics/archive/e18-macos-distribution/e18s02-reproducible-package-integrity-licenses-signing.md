# e18s02 — Reproducible Package Integrity, Licenses and Signing Applicability

## 1. Identity

- **Story ID:** e18s02
- **Epic:** e18 — Installable maintained local release
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a release operator, I want a reproducible tarball with a digest, third-party license inventory and an honest signing-applicability record, so that I can verify the chosen channel without claiming Apple notarization or inventing a Ganesh SPDX license.

## 3. Context

`npm pack` currently has no `files` whitelist. `docs/dependencies.md` lists direct packages and is stale relative to E06 parser packages. `biblatex-csl-converter` is LGPL-3.0; E06 tagged it `[SUS]` and deferred redistribution notices to E18. README states no open-source license has been declared. `node:crypto` can hash the tarball. Apple codesign does not apply to an npm tarball.

## 4. Problem

An unbounded pack can include secrets, tests, or omit LGPL notices. Claiming codesign or MIT without an owner SPDX choice would be false.

## 5. Goal

`buildPackageArtifact` produces an npm tarball whose `files` whitelist, SHA-256 digest, lockfile integrity, third-party license inventory (including LGPL-3.0 notices and source-link for `biblatex-csl-converter`), and signing-applicability record verify. Missing digest, incomplete inventory, claimed Apple codesign, or an invented Ganesh SPDX license fail closed.

## 6. Non-Goals

- Support-matrix smoke; e18s01 owns that and this story consumes its pack helper.
- Upgrade and uninstall; e18s03.
- Guide inventory completeness; e18s04.
- Publication and R18 gate; e18s05.
- Choosing a Ganesh SPDX license.
- Adding sigstore, cosign, or npm provenance packages.
- Hosted CI.

## 7. Stakeholders

- Operators verifying artifact integrity (B05).
- Recipients of LGPL-3.0 notices.
- Reviewers checking slopcheck (no new production packages).

## 8. Dependencies

- e18s01 pack-and-smoke helper.
- Existing lockfile and `docs/dependencies.md`.
- `[OK] node:crypto` for SHA-256; `[OK]` npm CLI pack; no new packages.
- SC-e18s02-P0-01 through SC-e18s02-P1-04.

## 9. Assumptions

- `package.json` `files` whitelist includes `dist/src/**`, `docs/**`, `README.md`, `NOTICE` (or equivalent LGPL notice file), license inventory, and support matrix. It excludes `.ganesh/`, `.env`, tests, and agent transcripts.
- Product license field is omitted or `UNLICENSED`. Tests fail if a SPDX id such as MIT appears without an owner-supplied pin in epic `plan_pins`.
- Signing-applicability JSON records `artifactDigest: sha256`, `lockfileIntegrity: true`, `appleCodesign: not-applicable`, `npmProvenance: not-applicable-until-authorized-registry-publication`.
- `npm run pack` is `npm pack` plus writing `specs/distribution/package-manifest.json` with name, version, digest and file list.

## 10. Constraints

- No new production npm packages.
- Must not set `private: false`.
- Must not call `npm publish`.
- Must not claim Apple codesign or npm provenance.
- Must not invent a Ganesh SPDX license.
- Pack output must not include secrets or participant fixtures copied from user home.

## 11. Domain Model

- **Package artifact:** npm tarball plus manifest (file list and SHA-256).
- **Signing applicability:** recorded controls that apply to this channel, including explicit not-applicable rows.
- Distinct from E15 project snapshots and E16 diagnostic bundles.

## 12. Requirements

### ADDED: Reproducible pack and digest

`buildPackageArtifact(root)` MUST run pack with the `files` whitelist, compute SHA-256 of the tarball with `node:crypto`, and persist a manifest. A missing digest fails closed.

### ADDED: Third-party license inventory and LGPL notices

`validateLicenseInventory(root)` MUST list every `package.json` direct dependency with name, version, license and notice pointer. `biblatex-csl-converter` MUST have an LGPL-3.0 notice and source-link. An invented Ganesh SPDX license fails closed.

### ADDED: Signing applicability

`validateSigningApplicability(root)` MUST accept digest plus lockfile integrity for npm-pack-tarball and MUST reject `appleCodesign` other than `not-applicable` for this channel.

## 13. Non-Functional Requirements

- **Integrity:** digest mismatch fails closed.
- **Honesty:** signing not-applicable rows are recorded, not skipped.
- **Legal:** LGPL notices ship with the artifact.
- **Supply chain:** no new packages; reuse Node 24 and npm CLI.

## 14. Contracts

### New contracts

- `buildPackageArtifact(root): PackageArtifactReport`
- `validateLicenseInventory(root): LicenseInventoryReport`
- `validateSigningApplicability(root): SigningApplicabilityReport`
- `npm run pack`
- `NOTICE` (or `docs/third-party-notices.md`) for LGPL text and source-link
- `specs/distribution/signing-applicability.json`

### Existing contracts preserved

- `package.json` `private: true`, engines, bin path
- Direct dependency versions
- e18s01 smoke helper

## 15. Reason for Depth and Zoom-Out

**Purpose of `package.json`:** manifest, bin, engines, scripts. **Callers:** npm, preflight, qualify, tests. **Contracts:** `private`, `bin.ganesh`, engines Node 24, existing scripts.

Reason for depth: license inventory and signing applicability are fail-closed catalogs, not README bullets. Do not add a signing library.

## 16. Implementation Steps

1. Add files whitelist, pack manifest and SHA-256 digest → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s02.*(pack|files|whitelist|digest|sha256|manifest)' dist/tests/*/*.test.js`
2. Verify third-party inventory including LGPL notices and refuse an invented Ganesh SPDX license → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s02.*(license|LGPL|biblatex|SPDX|undeclared|inventory)' dist/tests/*/*.test.js`
3. Record signing applicability and fail closed on missing digest or claimed codesign, with no new security findings in the pack path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s02.*(signing|codesign|not-applicable|lockfile|fail)' dist/tests/*/*.test.js`
4. Keep released behavior passing with no new production packages → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e18s02-P0-01: Pack manifest and digest verify

```gherkin
Given the files whitelist and a packed tarball
When buildPackageArtifact runs
Then the manifest lists only whitelisted paths
And the SHA-256 of the tarball matches the manifest digest
And .env and .ganesh are absent from the tarball
```

### Scenario SC-e18s02-P0-02: License inventory and LGPL notices

```gherkin
Given the lockfile and direct dependencies including biblatex-csl-converter
When validateLicenseInventory runs
Then every direct dependency has license and notice pointer
And the LGPL-3.0 notice and source-link are present
And a Ganesh SPDX MIT claim without an owner pin fails
```

### Scenario SC-e18s02-P0-03: Signing applicability is honest

```gherkin
Given channel npm-pack-tarball
When validateSigningApplicability runs
Then artifact digest and lockfile integrity are recorded
And appleCodesign is not-applicable
And a record claiming codesign fails
```

### Scenario SC-e18s02-P1-04: Missing digest fails closed

```gherkin
Given a manifest with an empty or wrong digest
When validation runs
Then the result is not pass
```

## 18. Verification Script (Step-by-Step)

1. Run `npm run pack` (or the test helper) and inspect the manifest digest.
2. Confirm NOTICE includes LGPL text and a source-link for biblatex-csl-converter.
3. Confirm signing-applicability has Apple codesign not-applicable.
4. Break the digest; confirm fail closed.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **License wash:** inventory is generated from package metadata, not guessed.
- **Secret packing:** whitelist plus tests for `.env` / `.ganesh`.
- **Signing theater:** not-applicable is an explicit field.

## 20. Traceability

- Scope outcome: R18 criterion 2
- Epic acceptance scenarios: AC-20
- Test scenarios: SC-e18s02-P0-01, SC-e18s02-P0-02, SC-e18s02-P0-03, SC-e18s02-P1-04
- Domain contracts: package artifact, signing applicability
- Language: Package artifact
- Security: T-E18-03, T-E18-04, T-E18-05, T-E18-06
- Slopcheck: `node:crypto` [OK]; npm CLI [OK]; no new packages
