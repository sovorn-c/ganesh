# e18s04 — Shipped Guides, Examples, Limitations, Release Notes and Support

## 1. Identity

- **Story ID:** e18s04
- **Epic:** e18 — Installable maintained local release
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 3
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher or operator, I want user, developer, accessibility, privacy and local-execution guides plus examples, limitations, release notes and support procedures inside the package, so that I can operate Ganesh without a hidden wiki.

## 3. Context

`README.md` is a development overview. `docs/setup-and-recovery.md` covers the e01 baseline. `docs/runbooks/` and `listRunbooks()` already cover provider-outage, credential-rotation, disk-exhaustion, recovery, incident-response, vulnerability-reporting and performance-budgets. User, accessibility, privacy and local-execution guides, examples, limitations and release notes do not yet ship as a required inventory.

## 4. Problem

Packaging without a required-id inventory can omit accessibility or privacy guidance while still producing a tarball.

## 5. Goal

`validateGuideInventory` requires ids `user`, `developer`, `accessibility`, `privacy`, `local-execution`, `examples`, `limitations`, `release-notes` and `support`. E16 runbooks are included by reuse of `listRunbooks`, not rewritten. Missing ids fail closed. Guides omit secrets and participant content. Limitations refuse production-ready and sandbox claims.

## 6. Non-Goals

- Rewriting E16 runbook bodies except to add a pointer from the support index.
- TUI help text; E14 contextual help stays.
- Publication authorization; e18s05.
- Hosted support portals.

## 7. Stakeholders

- Researchers reading shipped docs.
- Operators following support procedures.
- Accessibility reviewers.

## 8. Dependencies

- e18s02 files whitelist so docs ship in the tarball.
- `listRunbooks()` from `src/operations/runbooks.ts`.
- SC-e18s04-P0-01 through SC-e18s04-P1-04.

## 9. Assumptions

- New markdown lives under `docs/guides/` with those ids as filenames, plus `docs/RELEASE_NOTES.md` (or `docs/guides/release-notes.md`) and `docs/guides/examples.md`.
- Inventory JSON at `specs/distribution/guide-inventory.json` maps id → path.
- Validation reads files from the packed artifact list or from the repo paths that the whitelist includes.
- Examples use fictional project folders such as `/tmp/ganesh-example-project`.

## 10. Constraints

- MUST NOT include live credentials or participant quotations.
- MUST NOT claim sandbox containment or production-ready.
- MUST NOT rewrite E16 runbook ids.
- `src/workspace/**` stays frozen.

## 11. Domain Model

- **Guide inventory:** required shipped operating documents. Distinct from E16 **Runbook** (operational incident procedures) and from E17 qualification catalogs.

## 12. Requirements

### ADDED: Required guide inventory

`validateGuideInventory(root)` MUST require user, developer, accessibility, privacy, local-execution, examples, limitations, release-notes and support. Support MAY be satisfied by an index that lists `listRunbooks()` ids.

### ADDED: Packed completeness

A required id missing from the packed file list MUST fail closed.

### ADDED: Honesty and privacy in guides

Limitations MUST state that a local qualify pass is not production-ready and that full-access is not a sandbox. Guides MUST NOT contain `token=` credential shapes or participant emails from fixtures.

## 13. Non-Functional Requirements

- **Accessibility:** a dedicated guide exists; this story does not claim WCAG certification.
- **Privacy:** no secrets in shipped docs.
- **Honesty:** limitations refuse over-claim.

## 14. Contracts

### New contracts

- `validateGuideInventory(root): GuideInventoryReport`
- `docs/guides/*` required files
- `specs/distribution/guide-inventory.json`

### Existing contracts preserved

- `listRunbooks()` ids
- E14 help command

## 15. Reason for Depth and Zoom-Out

**Purpose of `src/operations/runbooks.ts`:** list local operational runbooks. **Callers:** tests, diagnostics docs. **Contracts:** the seven markdown ids under `docs/runbooks/`.

Reason for depth: a small inventory validator proves the package contains the R18 docs. Do not fold guides into qualification catalogs.

## 16. Implementation Steps

1. Add guide inventory for the required ids → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s04.*(inventory|user|developer|accessibility|privacy|local-execution)' dist/tests/*/*.test.js`
2. Fail closed when a required id is missing from the packed artifact and include E16 runbooks → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s04.*(missing|fail|runbook|packed|required)' dist/tests/*/*.test.js`
3. Prove guides omit secrets and limitations refuse production-ready and sandbox claims, with no new security findings in the docs path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s04.*(secret|participant|production-ready|sandbox|limitation)' dist/tests/*/*.test.js`
4. Keep released runbook listing and Node.js 24 checks passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e18s04-P0-01: Required ids present

```gherkin
Given the guide inventory and docs tree
When validateGuideInventory runs
Then user, developer, accessibility, privacy, local-execution, examples, limitations, release-notes and support all pass
And E16 runbook ids remain listed
```

### Scenario SC-e18s04-P0-02: Missing packed guide fails

```gherkin
Given a pack file list that omits docs/guides/privacy.md
When packed completeness is checked
Then the inventory result is not pass
```

### Scenario SC-e18s04-P0-03: Limitations refuse over-claim

```gherkin
Given the limitations guide
When it is scanned
Then it states that qualify pass is not production-ready
And it states that full-access is not a sandbox
```

### Scenario SC-e18s04-P1-04: Guides omit secrets

```gherkin
Given the shipped guide files
When they are scanned for token= and participant@example.test
Then those strings are absent
```

## 18. Verification Script (Step-by-Step)

1. Open each required guide path; confirm non-empty title.
2. Remove privacy.md in a fixture pack list; confirm fail closed.
3. Read limitations; confirm production-ready and sandbox refusals.
4. Grep guides for credential shapes.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Docs drift from pack whitelist:** completeness uses the pack file list.
- **Runbook rewrite:** tests assert E16 ids unchanged.

## 20. Traceability

- Scope outcome: R18 criterion 3
- Epic acceptance scenarios: AC-20
- Test scenarios: SC-e18s04-P0-01, SC-e18s04-P0-02, SC-e18s04-P0-03, SC-e18s04-P1-04
- Domain contracts: guide inventory versus runbook
- Language: Guide inventory
- Security: T-E18-09
