# E04 Whole-Epic Review Pass 1

**Verdict:** BLOCKED
**Branch:** `feat/e04-human-commitments`
**Stories:** `e04s01`–`e04s04`, all `done`, 16/16 tasks passing
**Runtime:** Node.js v24.21.0 / npm 11.19.0

## Passed gates

- All 16 story-ledger verification commands.
- `npm test`: 59 tests.
- `npm run build`, `npm run typecheck`, and `npm run lint`.
- Coverage: 84.74% lines, 71.41% branches, 94.54% functions.
- `npm audit --audit-level=high`: 0 vulnerabilities.
- `npm run preflight -- --clean-install`: exit 0; the existing `execution-mode: not_configured` warning is non-blocking.
- `bash scripts/check-blind-spots.sh`: 0 HIGH, 0 MEDIUM; 15 LOW stale done-story tags.
- `bash scripts/lib/completeness-critic.sh`: `BLOCKER=0 WARNING=0`.
- `bash scripts/lib/plan-consistency-check.sh specs/epics/e04-human-commitments`: `CRITICAL=0 HIGH=0 MED=0`.
- `ruby specs/verifications/check-blueprint.rb`: PASS.
- `bash scripts/trace-stories.sh --strict`: 15 stories, 0 dark.
- Shell/Ruby syntax, local Markdown links, and `git diff --check main`.

These checks establish passing task behavior and repository gates; they do not establish correct filtering for an untested public filter or atomicity under concurrent callers.

## Blocking findings

1. **Stale gate trace — shared state/release gate.** `specs/execution-status.yaml:177-180` still has the previous E03 rationale and timestamp, while `specs/execution-status.yaml:6,137-176` identifies E04 as active and complete at the story/task level. Reconcile the trace to E04 evidence.

2. **Branch filter is ignored — E04s02.** `src/commitment-store.ts:122-146` accepts `CommitmentHistoryFilter`, whose contract includes `branchId`, but only applies `commitmentId` and `packetId`. A synthetic two-branch reproduction called `listCommitmentHistory(handle, { branchId: alt })` and returned four records containing both the main and alt packet IDs. This violates historical inspection isolation for `SC-e04s02-P0-01` and `SC-e04s02-P1-03`. Add a branch predicate to each history source and a regression test.

3. **Bounded review limits are not atomic — E04s04.** `src/override-store.ts:103-122` checks for an existing override before `transaction(handle.db)`, and `src/override-store.ts:262-280` reads the revision count before creating the replacement packet and revision record. The schema has no uniqueness constraint for the finding/packet override or finding revision budget. Concurrent handles can therefore pass both checks and persist duplicate bounded records, violating `SC-e04s04-P1-03`. Make the limit atomic and add deterministic concurrent regression coverage.

## Correction scope

A correction fork should address only the three findings above, preserve the plan and all four stories, rerun affected story checks plus the full review gates, and leave the branch unreleased for a fresh review pass 2.
