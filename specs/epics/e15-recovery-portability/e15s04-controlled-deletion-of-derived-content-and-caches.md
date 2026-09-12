# e15s04 — Controlled Deletion of Derived Content and Caches

## 1. Identity

- **Story ID:** e15s04
- **Epic:** e15 — Recovery portability and controlled deletion
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want authorized deletion to remove application-controlled originals, derived copies, caches and app backups while leaving an evidence tombstone, so that removed material is visibly unavailable and I am not told that providers already forgot it.

## 3. Context

E02 inspection already reports `unavailable` / `missing` / `corrupt`. E03 records derived materials and disclosures. E04 readiness already blocks unavailable inputs. E05 work dispatch already requires available assigned content. This slice adds the owner deletion command and propagation e02 left to e15.

## 4. Problem

Unlinking one artifact file without derived copies, caches and app backups would leave prohibited bytes on disk. Deleting SQLite history wholesale would destroy reconstructable decisions. Claiming that a past `export` or `retrieval` disclosure was recalled would be false.

## 5. Goal

Provide an owner-only deletion command that unlinks application-controlled bytes, writes an evidence tombstone, blocks new committed use and execution that needs the removed input, and reports not-recalled external disclosures.

## 6. Non-Goals

- Export and materialize restore; e15s01/e15s02 own those.
- Stale restore versus withdrawn grants; e15s05 owns restore-replace monotonicity and may consume tombstones.
- OS-level secure erase, Time Machine, and user copies outside `.ganesh`.
- Uninstall of the Ganesh application; E18 owns that.
- TUI commands; E14 stays unmodified.
- Using `ownerAction({ action: "delete-project" })` as the implementation; that E03 stub stays unchanged.

## 7. Stakeholders

- Owners removing participant or restricted material from a local project.
- e15s05, which must keep tombstones and not-recalled notices across restore-replace.
- Reviewers checking AC-20 deletion and glossary Evidence tombstone.

## 8. Dependencies

- e15s03 write lock (deletion is a canonical write).
- E03 `derived_materials`, disclosure rows, classifications.
- E04 `assessReadiness`, E05 work input availability, E07 claim rows as historical facts.
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` scenarios SC-e15s04-P0-01 through SC-e15s04-P1-04.
- Node.js 24 standard library only.

## 9. Assumptions

- Deletion target is an artifact version or source version id, plus optional `includeAppBackups: true` to unlink matching files under `.ganesh/backups/`.
- Tombstone retains non-sensitive identifiers, hashes, deletion time, actor and reason. It does not retain prohibited full text.
- Derived copies are rows in `derived_materials` plus any registered artifact versions whose dependency relation traces to the target.
- Caches are application-controlled files under `.ganesh` that `listTemporaryArtifactFiles` or an explicit cache directory names; not `node_modules` and not the user's Downloads folder.
- Prior `requestDisclosure` rows with status allow to a non-local destination become not-recalled notices on the deletion result. Bytes are not fetched back from providers.

## 10. Constraints

- `deleteArtifactContent` MUST run inside `protectCanonicalWrite` with matching owner identity.
- After success, `inspectArtifactVersion` MUST report `unavailable` or equivalent, and the file MUST be absent.
- Historical commitment and decision rows MUST remain. New committed use MUST require revalidation; readiness MUST be `blocked` for actions that need the removed input.
- Work dispatch that needs the removed input MUST fail closed.
- Diagnostics MUST NOT print deleted bytes.
- `src/workspace/**` MUST NOT change.

## 11. Domain Model

- **Evidence tombstone:** permitted non-sensitive record that source material was removed or became unavailable.
- **Deletion event:** command-scoped record of targets, unlinked paths, remaining stubs and not-recalled disclosures.
- **Application-controlled copy:** files Ganesh created under `.ganesh` (artifacts, derived, caches, backups), not arbitrary host paths.

## 12. Requirements

### ADDED: Propagating deletion

Authorized deletion MUST unlink the original, derived materials, named caches and opted-in app backups for the target, then write a tombstone.

### ADDED: New use is blocked

After deletion, `assessReadiness` for actions depending on the target MUST be blocked, claim quotation MUST not fabricate removed bytes, and work dispatch needing the input MUST not start.

### ADDED: Honest disclosure limits

The deletion result MUST list prior non-local disclosures as `recall-not-promised` (or equivalent) and MUST NOT claim provider deletion.

### ADDED: Authority and history retention

Workers and forged owners MUST be denied. Permitted non-sensitive decision history MUST remain inspectable.

## 13. Non-Functional Requirements

- **Privacy:** prohibited bytes are gone from application-controlled paths.
- **Integrity:** hashes in tombstones remain; files do not.
- **Safety:** workers cannot delete.
- **Honesty:** external recall is not promised.
- **Compatibility:** released readiness and work-unavailable tests still pass and now have an owner path that produces that state.

## 14. Contracts

### New contracts

- `deleteArtifactContent(handle, capability, request): DeletionResult`
- `getEvidenceTombstone(handle, capability, artifactVersionId): EvidenceTombstone`
- `listDeletionEvents(handle, capability): readonly DeletionEvent[]`

### Existing contracts preserved

- `inspectArtifactVersion` status vocabulary.
- `assessReadiness` blocked-on-unavailable logic.
- `ownerAction` stub behavior.
- `OWNER_OPERATIONS` list unchanged; owner identity is the gate.

## 15. Reason for Depth and Zoom-Out

`src/portability/deletion-store.ts` owns unlink + tombstone because artifact-store would exceed the 300-line guideline if deletion were inlined. Artifact-store remains the inspection oracle.

Planned tests: `tests/portability/controlled-deletion.test.ts` and authority cases in `tests/integration/portability-authority.test.ts`.

## 16. Implementation Steps

1. Unlink original, derived, cache and opted-in app-backup bytes and persist a tombstone → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s04.*(tombstone|unlink|derived|cache|backup)' dist/tests/*/*.test.js`
2. Block readiness and work dispatch that need the removed input, and require revalidation for new committed use → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s04.*(readiness|blocked|dispatch|revalidat)' dist/tests/*/*.test.js`
3. Report not-recalled external disclosures without claiming provider recall, and prove no new security findings in affected deletion paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e15s04.*(recall|disclosure|not-recalled)' dist/tests/*/*.test.js`
4. Deny workers and forged owners, keep decision history, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e15s04.*(worker|forged|history|commitment|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e15s04-P0-01: Deletion unlinks application-controlled copies

```gherkin
Given an artifact with a derived copy, a cache file and an app backup that contains its bytes
When deleteArtifactContent runs with includeAppBackups true
Then those files are absent
And an evidence tombstone remains inspectable without the prohibited text
```

### Scenario SC-e15s04-P0-02: New use and execution are blocked

```gherkin
Given a commitment or work contract that depends on the deleted artifact
When readiness is assessed or a run is dispatched
Then readiness is blocked
And dispatch fails because the assigned input is unavailable
```

### Scenario SC-e15s04-P0-03: External disclosures are not recalled

```gherkin
Given a prior allowed non-local disclosure of the target
When deletion completes
Then the result lists that disclosure as recall-not-promised
And no API reports that the provider deleted the bytes
```

### Scenario SC-e15s04-P1-04: Workers cannot delete and history remains

```gherkin
Given a worker capability and an existing decision row
When the worker deletes and the owner then deletes
Then the worker is denied
And the owner deletion leaves the decision row inspectable
```

## 18. Verification Script (Step-by-Step)

1. Register an artifact, a derived material, a cache file and a backup that includes it.
2. Record one non-local disclosure allow.
3. Owner-delete with includeAppBackups.
4. Confirm files gone, tombstone present, text absent.
5. Assess readiness and attempt work dispatch.
6. Attempt worker delete.
7. List commitments/decisions still present.
8. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Scope creep into home directory:** only unlink paths inside `.ganesh` after `pathInside` checks.
- **History wipe:** delete bytes and access, not decision tables.
- **False recall:** dedicated result field, never reuse disclosure status `allow` as deleted-at-provider.

## 20. Traceability

- Scope outcome: R15
- Epic acceptance scenarios: AC-20 (deletion, tombstone, disclosure limits)
- Test scenarios: SC-e15s04-P0-01, SC-e15s04-P0-02, SC-e15s04-P0-03, SC-e15s04-P1-04
- Domain contracts: tech-stack deletion invariant and artifact/deletion concurrency row
- Language: Evidence tombstone, Revocation as distinct from recall
