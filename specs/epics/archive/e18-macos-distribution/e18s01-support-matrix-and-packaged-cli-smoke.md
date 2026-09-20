# e18s01 — Support Matrix and Packaged CLI Smoke

## 1. Identity

- **Story ID:** e18s01
- **Epic:** e18 — Installable maintained local release
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher on a documented supported environment, I want to install the packaged `ganesh` CLI and pass smoke checks, so that I can launch a local project without cloning a development tree as the only path.

## 3. Context

Today `package.json` declares `"bin": { "ganesh": "dist/src/cli.js" }` and `"private": true`. Launch is `npm run dev` or the bin after a local build. README says macOS is the current product target. SCOPE says macOS is not an inherent product boundary. No support-matrix catalog exists. `ganesh --print-launch` already skips the TUI and is the smoke seam.

## 4. Problem

Without a verified-versus-unverified matrix, packaging can claim macOS support, Linux support, or universal support from prose. A green development `npm test` does not prove a packed CLI launches.

## 5. Goal

`loadSupportMatrix` and `runPackagedSmoke` make the npm-pack-tarball channel observable. A verified OS/arch/Node 24 combination packs, installs into an isolated prefix, runs `ganesh --print-launch`, and runs packaged preflight. Unverified combinations stay unverified. Operator docs point at the matrix.

## 6. Non-Goals

- Files whitelist, license inventory and signing applicability; e18s02 owns those.
- Upgrade, rollback and uninstall; e18s03 owns those.
- User guides and release notes; e18s04 owns those.
- Publication authorization and R18 gate change; e18s05 owns those.
- Homebrew, Apple .pkg, notarization, hosted CI.
- Unfreezing `src/workspace/**` or adding TUI commands.

## 7. Stakeholders

- Researchers installing on a verified host.
- Reviewers checking B05 (channel, signing, support matrix).
- Later stories that consume a pack-and-smoke helper.

## 8. Dependencies

- Existing `src/cli.ts` `--print-launch` and `src/preflight-cli.ts`.
- Node.js 24 `npm pack` / `npm install --prefix`.
- SC-e18s01-P0-01 through SC-e18s01-P1-04.
- No new package.

## 9. Assumptions

- Chosen channel is npm-pack-tarball, pinned in epic `plan_pins`.
- The current planning host is Linux; implementation records the actual `process.platform` and `process.arch` of the Node.js 24 smoke host. Darwin rows stay `unverified` unless a later verified run on that combination exists.
- Smoke uses `--print-launch` so tests do not need a TTY or Pi TUI.
- Isolated prefix is a test temp directory, never `$HOME` or a user global prefix.
- `npm run pack` may be added in s02; s01 may invoke `npm pack` directly from the test helper.

## 10. Constraints

- Must not mark a combination `verified` without a passing smoke on that combination.
- Must not change preflight check ids.
- Must not call `runWorkspace` from a new distribution CLI.
- `src/workspace/**` stays frozen.
- Schema marker stays 1.
- Reports omit secrets.

## 11. Domain Model

- **Support matrix:** catalog of OS, CPU architecture, Node.js and npm combinations with `verified` or `unverified` status and an evidence pointer.
- Distinct from qualification catalogs and from a research project.

## 12. Requirements

### ADDED: Support matrix catalog

`loadSupportMatrix(root)` MUST read `specs/distribution/support-matrix.json`. Each combination MUST include `os`, `arch`, `nodeMajor`, `status` (`verified` | `unverified`) and `evidencePointer`. Runtime Node major MUST be 24 for a `verified` row.

### ADDED: Packaged CLI smoke

`runPackagedSmoke(options)` MUST pack the current tree, install the tarball into `options.prefix`, execute `ganesh --print-launch` against a temp project folder, and execute packaged preflight. Success requires exit 0 from both and a support-matrix row matching the smoke host marked `verified`.

### MODIFIED: Platform target language in operator docs

**Before:** README stated macOS is the current product target and broader platform support has not been verified.

**After:** README and `docs/setup-and-recovery.md` point at the support matrix. Verified combinations are listed with evidence. Unverified combinations stay unverified. macOS is not an inherent product boundary.

## 13. Non-Functional Requirements

- **Honesty:** unverified platforms are not claimed as supported.
- **Isolation:** smoke installs never write the user global npm prefix.
- **Privacy:** smoke output omits secrets and participant content.
- **Compatibility:** preflight check ids unchanged; TUI frozen.

## 14. Contracts

### New contracts

- `loadSupportMatrix(root): SupportMatrix`
- `runPackagedSmoke(options): PackagedSmokeReport`
- `src/distribution/` responsibility folder
- `tests/distribution/support-matrix.test.ts` and helpers in `tests/support/distribution-fixtures.ts`

### Existing contracts preserved

- `src/cli.ts` `--print-launch`
- `runPreflight` check ids and exit codes
- `ganesh` bin path
- `runWorkspace` callers unchanged

## 15. Reason for Depth and Zoom-Out

**Purpose of `src/cli.ts`:** product launcher. **Callers:** `ganesh` bin. **Contracts:** `--print-launch` and `runWorkspace`. Do not fold distribution into the TUI.

Distribution belongs in `src/distribution/` with a tiny CLI later if needed, matching preflight/qualify. Reason for depth: support-matrix honesty is a fail-closed catalog, not inline README prose.

## 16. Implementation Steps

1. Add distribution types and support-matrix load with verified/unverified checks → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s01.*(matrix|verified|unverified|combination|catalog)' dist/tests/*/*.test.js`
2. Pack, install into an isolated prefix, and pass `--print-launch` plus preflight smoke → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s01.*(pack|smoke|print-launch|preflight|prefix)' dist/tests/*/*.test.js`
3. Fail closed on invented verified rows and retarget operator docs at the matrix, with no new security findings in the pack/install path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s01.*(invent|unverified|fail|macos|docs|matrix)' dist/tests/*/*.test.js`
4. Keep released behavior passing under Node.js 24 → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e18s01-P0-01: Matrix loads verified and unverified rows

```gherkin
Given a support-matrix catalog with one verified Node 24 combination and one unverified combination
When loadSupportMatrix runs
Then both rows are listed
And only the verified row has status verified
And scholarlyCertification is not inferred
```

### Scenario SC-e18s01-P0-02: Packaged CLI smoke passes on a verified host

```gherkin
Given a Node.js 24 host whose matrix row is verified
When runPackagedSmoke packs and installs into an isolated prefix
Then ganesh --print-launch exits 0
And packaged preflight exits 0
And the install prefix is not the user global prefix
```

### Scenario SC-e18s01-P0-03: Invented verified rows fail closed

```gherkin
Given a matrix row marked verified for an OS/arch that has no smoke evidence
When loadSupportMatrix or runPackagedSmoke validates the catalog
Then the result is not pass
And the combination remains unverified
```

### Scenario SC-e18s01-P1-04: Operator docs follow the matrix

```gherkin
Given README and setup-and-recovery after this story
When they are inspected
Then they point at the support matrix
And they do not state that macOS is an inherent product boundary
```

## 18. Verification Script (Step-by-Step)

1. Run the matrix catalog test; confirm verified and unverified rows.
2. Run packaged smoke in an isolated prefix; confirm `--print-launch` and preflight.
3. Insert a fake darwin-arm64 verified row without evidence; confirm fail closed.
4. Open README; confirm it points at the matrix.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Invented macOS pass:** matrix validation requires smoke evidence for `verified`.
- **Global prefix pollution:** tests pass `--prefix` temp dirs only.
- **TUI hang:** smoke uses `--print-launch` only.

## 20. Traceability

- Scope outcome: R18 criterion 1 (launch and smoke)
- Epic acceptance scenarios: AC-20
- Test scenarios: SC-e18s01-P0-01, SC-e18s01-P0-02, SC-e18s01-P0-03, SC-e18s01-P1-04
- Domain contracts: support matrix; ADR 0002 focused commands
- Language: Support matrix, Package artifact
- Security: T-E18-01, T-E18-02
