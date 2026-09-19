# e18s03 — Upgrade, Rollback and Uninstall Preserve Research Data

## 1. Identity

- **Story ID:** e18s03
- **Epic:** e18 — Installable maintained local release
- **Type:** feat
- **Risk:** P0
- **Context:** domain/infra
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want upgrade, documented rollback and product uninstall to leave my `.ganesh` research data in place, so that removing the CLI is not silent deletion of my study.

## 3. Context

E02 stores canonical state in `.ganesh/project.sqlite` and artifacts. E15 owns backup, restore, migrations and controlled deletion of derived research content. E16 owns diagnostic purge. Product uninstall is explicitly E18. No installer currently writes outside the project folder except `node_modules` in a developer clone.

## 4. Problem

A naive uninstall script that deletes `.ganesh`, or an upgrade that re-inits the schema, would destroy research data. Building a second restore engine would fork E15.

## 5. Goal

`runProductLifecycle` covers upgrade (install newer tarball, reopen project, schema ready, artifacts hashed), uninstall (remove prefix bin and package files, leave project `.ganesh`), and rollback (previous tarball plus E15 backup/restore). Unknown-future schema stays honest. Product uninstall is not E15 `deleteDerived`.

## 6. Non-Goals

- Changing `PROJECT_SCHEMA_VERSION` or `migrateSchema` signatures.
- Replacing E15 backup/restore or deletion.
- OS-level secure erase, Time Machine, or copies outside `.ganesh`.
- TUI uninstall command.
- Hosted auto-update.

## 7. Stakeholders

- Owners who installed from a tarball and later remove it.
- E15 reviewers confirming deletion APIs stay untouched.

## 8. Dependencies

- e18s01 smoke prefix helper and e18s02 artifact.
- `openProject`, schema status from E02.
- E15 `backup` / `restore` for the rollback path.
- SC-e18s03-P0-01 through SC-e18s03-P1-04.

## 9. Assumptions

- Tests install two tarballs into isolated prefixes (A then B) and reopen the same temp project folder.
- Uninstall is `npm uninstall --prefix <temp> ganesh` (or equivalent file removal of the prefix package). It MUST NOT take a project folder argument that deletes `.ganesh`.
- Rollback documentation names E15 backup then previous tarball then restore. Tests call existing E15 APIs, not a new restore.
- Schema marker remains 1. Unknown-future remains inspect-only.

## 10. Constraints

- MUST NOT delete `.ganesh` during product uninstall.
- MUST NOT add `OWNER_OPERATIONS` for uninstall.
- MUST NOT change E15 deletion signatures.
- `src/workspace/**` stays frozen.
- No new packages.

## 11. Domain Model

- **Product uninstall:** removal of the Ganesh CLI install. Distinct from **Evidence tombstone** / E15 deletion and from diagnostic purge.
- **Upgrade:** replacing the CLI bits while reopening the same project folder.

## 12. Requirements

### ADDED: Upgrade preserves research data

Installing a newer package into the prefix and reopening the project MUST report schema `supported` / ready for marker 1 and MUST keep artifact bytes and hashes.

### ADDED: Product uninstall preserves research data

Uninstall MUST remove the prefix package and MUST leave `<project>/.ganesh/project.sqlite` and artifact files. It MUST NOT call E15 deletion.

### ADDED: Rollback uses E15

Documented rollback MUST use E15 backup/restore plus reinstall of the previous tarball. A second restore engine is forbidden.

## 13. Non-Functional Requirements

- **Durability:** research data survives CLI removal.
- **Honesty:** unknown-future schema is not reported as ready.
- **Authority:** uninstall is not an owner research-deletion command.

## 14. Contracts

### New contracts

- `runProductLifecycle({ action: "upgrade" | "uninstall" | "rollback-check", prefix, projectFolder })`
- `tests/distribution/install-lifecycle.test.ts`

### Existing contracts preserved

- E15 deletion and restore APIs
- E02 `openProject` schema statuses
- PacketKind and schema marker

## 15. Reason for Depth and Zoom-Out

**Purpose of `src/portability/deletion-store.ts`:** owner-controlled research deletion with tombstones. **Callers:** owner deletion tests, restore monotonicity. **Contracts:** tombstones, not-recalled disclosures, no recall claim.

Reason for depth: lifecycle checks belong in `src/distribution/lifecycle.ts` so uninstall cannot be implemented by calling deletion. Do not split deletion-store.

## 16. Implementation Steps

1. Upgrade packed CLI and reopen the project with research data intact → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s03.*(upgrade|reopen|schema|research-data|intact)' dist/tests/*/*.test.js`
2. Uninstall the product and prove `.ganesh` remains; uninstall is not E15 deletion → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s03.*(uninstall|preserve|.ganesh|deletion|not-e15)' dist/tests/*/*.test.js`
3. Exercise rollback via previous tarball plus E15 backup/restore and keep unknown-future honest, with no new security findings on the project-folder path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e18s03.*(rollback|restore|backup|unknown-future|migration)' dist/tests/*/*.test.js`
4. Keep released E15 and E02 behavior passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test`

## 17. Acceptance Criteria

### Scenario SC-e18s03-P0-01: Upgrade keeps the project

```gherkin
Given a temp project with sqlite and one artifact
When a newer tarball is installed into the prefix and openProject runs
Then schema status is supported
And the artifact hash matches
```

### Scenario SC-e18s03-P0-02: Uninstall leaves research data

```gherkin
Given a prefix install and a project folder with .ganesh
When product uninstall runs against the prefix
Then ganesh is gone from the prefix
And project.sqlite and artifacts still exist
And no E15 deletion event is recorded
```

### Scenario SC-e18s03-P0-03: Rollback uses E15

```gherkin
Given an E15 backup of the project
When the previous tarball is installed and restore runs
Then the project reopens
And restore used the existing E15 API
```

### Scenario SC-e18s03-P1-04: Unknown-future stays honest

```gherkin
Given a fixture database newer than marker 1
When the packaged CLI opens it
Then status is unknown-future
And mutations are blocked
```

## 18. Verification Script (Step-by-Step)

1. Create a temp project, pack, install, reopen; confirm artifact hash.
2. Uninstall the prefix package; confirm `.ganesh` remains.
3. Backup, swap tarball, restore; confirm E15 path.
4. Open an unknown-future fixture; confirm blocked mutations.
5. Run typecheck, lint, build and test under Node.js 24.

## 19. Risks and Mitigations

- **Uninstall deletes studies:** tests assert sqlite existence; uninstall API has no project-folder delete.
- **Second restore engine:** rollback-check only wraps E15.
- **Schema bump sneak:** marker stays 1.

## 20. Traceability

- Scope outcome: R18 criterion 1 (upgrade, migration compatibility, rollback, uninstall)
- Epic acceptance scenarios: AC-20
- Test scenarios: SC-e18s03-P0-01, SC-e18s03-P0-02, SC-e18s03-P0-03, SC-e18s03-P1-04
- Domain contracts: product uninstall versus evidence tombstone
- Language: Product uninstall
- Security: T-E18-07, T-E18-08
