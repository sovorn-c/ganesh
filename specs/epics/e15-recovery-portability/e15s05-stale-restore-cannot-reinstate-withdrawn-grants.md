# e15s05 — Stale Restore Cannot Reinstate Withdrawn Grants

## 1. Identity

- **Story ID:** e15s05
- **Epic:** e15 — Recovery portability and controlled deletion
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want restoring an older packet onto a project that already withdrew a grant to keep that grant withdrawn, so that moving files cannot resurrect revoked data use or pretend a past disclosure was recalled.

## 3. Context

e15s01 can export while a grant is active. e15s02 can restore snapshots. e15s04 can tombstone deleted bytes. E03 already withdraws grants monotonically for live commands. This slice closes the restore-replace hole: an old packet must not UPDATE withdrawn or expired rows back to `active`.

## 4. Problem

Materialize-into-empty is a new copy of historical facts. Restore-replace onto a live project that already withdrew a grant is different: applying the packet as a naive row overlay would reinstate remote disclosure. That violates tech-stack invariant 5, AC-15/AC-20 language, and the glossary example that a branch cannot restore a revoked permission.

## 5. Goal

Add an explicit restore-replace mode that validates integrity like e15s02, then merges policy so withdrawn and expired win, keeps cross-branch snapshot isolation, and preserves not-recalled disclosure notices and tombstones.

## 6. Non-Goals

- Changing live withdraw/evaluatePolicy behavior for ordinary commands; E03 owns that.
- Defaulting restore to replace; empty-root materialize and drills stay e15s02.
- Recalling bytes from providers.
- TUI commands; E14 stays unmodified.
- Treating a materialized new folder as automatically bound to a different live project's later withdrawals. That copy is a separate project unless restore-replace is used.

## 7. Stakeholders

- Owners who restore a backup over the current project after a policy change.
- Reviewers checking that historical snapshots cannot restore revoked capabilities.
- e16/e17 later adversarial recovery tests.

## 8. Dependencies

- e15s01 packets, e15s02 restore validation, e15s04 tombstones and not-recalled notices.
- E03 `withdrawDataUse`, `requestDisclosure`, permission status `active | withdrawn | expired`.
- `specs/tech-architecture/e15-TEST_PLAN_LATEST.md` scenarios SC-e15s05-P0-01 through SC-e15s05-P1-04.
- Node.js 24 standard library only.

## 9. Assumptions

- `restoreProject(..., { mode: "replace" })` targets an existing ready project root. It is owner-only and distinct from drill and materialize.
- Merge rule for `policy_permissions` keyed by permission id and by `(inputVersion, destination, purpose)`: if either side is `withdrawn` or `expired`, the result is that terminal status. `active` in the packet cannot override.
- Tombstones in the live project survive replace. Packet bytes for a tombstoned id are not reintroduced as `available`.
- Disclosure rows are unioned; not-recalled notices are not deleted.
- Research-branch snapshots remain isolated; revocation applies to current disclosure on every branch.

## 10. Constraints

- Replace MUST reuse e15s02 hash/schema checks before any policy merge.
- Replace MUST NOT call `recordOwnerDecision`.
- After replace, `requestDisclosure` for the withdrawn use MUST deny.
- Inspecting an old restored snapshot MUST NOT change grant status.
- Failed replace MUST not leave a torn mix of packet artifacts and live policy; use a transactional staging directory then swap, or abort with the live project still withdrawn.
- `src/workspace/**` MUST NOT change.

## 11. Domain Model

- **Restore-replace:** owner command that overlays a snapshot onto an existing project under monotonic revocation and tombstone rules.
- **Monotonic grant:** `withdrawn` and `expired` are terminal for that permission identity; restore cannot move them to `active`.
- **Not-recalled notice:** retained record that bytes were previously disclosed externally.

## 12. Requirements

### ADDED: Restore-replace is explicit

`restoreProject` MUST require `mode: "replace"` to overlay a live project. Drill and materialize MUST keep e15s02 semantics.

### ADDED: Withdrawn and expired win

Replace MUST not set a live withdrawn or expired grant to active because the packet still says active.

### ADDED: Current disclosure still denies

After replace, remote export/disclosure of the withdrawn material MUST deny. Cross-branch snapshot inspection MUST not resurrect the grant.

### ADDED: Tombstones and not-recalled notices survive

Live tombstones remain unavailable. Prior external disclosure rows remain not-recalled rather than successful recall.

## 13. Non-Functional Requirements

- **Safety:** revoked data use stays revoked on the live project.
- **Integrity:** hash checks still gate replace.
- **Isolation:** AC-08 branch snapshots stay isolated.
- **Honesty:** recall is still not promised.
- **Compatibility:** e15s02 materialize into a new empty root still restores packet policy as historical facts for that new project id.

## 14. Contracts

### New contracts

- `restoreProject` `mode: "replace"` with `RestoreResult.reinstatedGrants: []` always empty on success, plus `preservedWithdrawals` listing ids that stayed withdrawn/expired.

### Existing contracts preserved

- E03 withdraw/evaluate/disclosure denies.
- e15s02 drill/materialize.
- e15s04 tombstone inspection.

## 15. Reason for Depth and Zoom-Out

Replace lives in `restore-store.ts` as an additional mode, not a second restore engine, because hash validation is shared. Policy merge is a dedicated function so `policy-store` does not grow packet I/O.

Planned tests: `tests/portability/stale-restore-grants.test.ts`.

## 16. Implementation Steps

1. Add restore-replace that keeps withdrawn and expired grants terminal → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s05.*(replace|withdrawn|expired|active)' dist/tests/*/*.test.js`
2. Prove requestDisclosure still denies the withdrawn use after replace, including remote export → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s05.*(disclosure|deny|remote|export)' dist/tests/*/*.test.js`
3. Prove withdrawal remains effective across restored branches and snapshot inspection cannot resurrect it → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node scripts/require-test-match.mjs 'e15s05.*(branch|snapshot|resurrect|AC-08)' dist/tests/*/*.test.js`
4. Preserve not-recalled notices and tombstones, and keep released regressions passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node scripts/require-test-match.mjs 'e15s05.*(recall|tombstone|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e15s05-P0-01: Replace cannot reactivate a withdrawn grant

```gherkin
Given a live project whose grant G is withdrawn and a packet exported while G was active
When restoreProject runs in replace mode
Then G remains withdrawn
And restored packet rows do not set G to active
```

### Scenario SC-e15s05-P0-02: Disclosure still denies after replace

```gherkin
Given the project from SC-e15s05-P0-01
When requestDisclosure is called for the withdrawn destination and purpose
Then the decision is deny
And exportProject to that remote destination omits the artifact
```

### Scenario SC-e15s05-P0-03: Branches cannot resurrect the grant

```gherkin
Given two research branches on the replaced project
When an older snapshot is inspected or selected for inspection
Then current disclosure still denies the withdrawn use
And the other branch's current references are unchanged
```

### Scenario SC-e15s05-P1-04: Not-recalled notices and tombstones survive

```gherkin
Given a not-recalled disclosure notice and an evidence tombstone on the live project
When replace completes
Then both records remain
And the tombstoned artifact is not available
```

## 18. Verification Script (Step-by-Step)

1. Grant remote use, export a packet, withdraw the grant, optionally delete/tombstone a different artifact.
2. Restore-replace the packet onto the live root.
3. Confirm permission status withdrawn, disclosure deny, export omission.
4. Inspect an old snapshot; confirm grant still withdrawn.
5. Confirm tombstone and not-recalled notice.
6. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **Naive UPSERT:** never UPDATE terminal status to active from packet data.
- **New-folder confusion:** document that materialize creates a new project; only replace applies live withdrawals.
- **Torn replace:** stage then swap; tests abort on hash mismatch with grant still withdrawn.

## 20. Traceability

- Scope outcome: R15
- Epic acceptance scenarios: AC-08, AC-20; related E03 AC-15 language on snapshots vs revoked capabilities
- Test scenarios: SC-e15s05-P0-01, SC-e15s05-P0-02, SC-e15s05-P0-03, SC-e15s05-P1-04
- Domain contracts: tech-stack invariant 5 and 11
- Language: Revocation, Evidence tombstone, Research branch
