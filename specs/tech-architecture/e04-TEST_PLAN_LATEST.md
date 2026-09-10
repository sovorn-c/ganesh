# Test Design: e04-human-commitments

## 1. Risk Matrix & Scenarios

| Scenario ID | Behavior Description | Risk | Test Level | Target File/Module |
|---|---|---:|---|---|
| SC-e04s01-P0-01 | An explicit local owner action approves the displayed packet and exact option/dependency versions, creating one commitment; ordinary chat, agent output, or imported “approved” text cannot do so. | P0 | Integration | `test/e04s01-decisions.test.ts`, `src/decision-store.ts` |
| SC-e04s01-P0-02 | A packet action with a stale packet/branch/dependency version is rejected before any commitment or partial state is written. | P0 | Integration | `test/e04s01-decisions.test.ts`, `src/decision-store.ts` |
| SC-e04s01-P1-03 | Duplicate owner commands are idempotent for the same payload and rejected when a command ID is reused with a different payload; rejection and deferral remain inspectable decisions without creating commitments. | P1 | Integration | `test/e04s01-decisions.test.ts`, `src/decision-store.ts` |
| SC-e04s02-P0-01 | Approval, rejection, deferral, revision, reopening, archival, and supersession preserve append-only decision history and distinguish current readiness from historical disposition. | P0 | Integration | `test/e04s02-commitments.test.ts`, `src/commitment-store.ts` |
| SC-e04s02-P0-02 | Changing an adopted dependency or referenced version marks affected direct and transitive work for impact review; historical approval remains reconstructable and cannot authorize stale execution. | P0 | Integration | `test/e04s02-commitments.test.ts`, `src/readiness-store.ts` |
| SC-e04s02-P1-03 | Archived and superseded packets/versions remain readable as history, while only a current, validated candidate can become the active commitment. | P1 | Integration | `test/e04s02-commitments.test.ts`, `src/commitment-store.ts` |
| SC-e04s03-P0-01 | Editing a research alternative changes only its branch snapshot and does not mutate another branch or the current committed references. | P0 | Integration | `test/e04s03-alternatives.test.ts`, `src/promotion-store.ts` |
| SC-e04s03-P0-02 | Promoting selected exact versions requires an explicit reviewed action and expected destination revision, then records direct and transitive dependent impact notices. | P0 | Integration | `test/e04s03-alternatives.test.ts`, `src/commitment-store.ts` |
| SC-e04s03-P0-03 | Concurrent or repeated branch adoption cannot create duplicate commitments or bypass stale destination/packet checks; shared-source notices reach each using branch without rewriting snapshots. | P0 | Integration | `test/e04s03-alternatives.test.ts`, `src/dependency-store.ts` |
| SC-e04s03-P1-04 | Exploring an alternative without adoption leaves the current commitment ready when its own dependencies and policy remain current. | P1 | Integration | `test/e04s03-alternatives.test.ts`, `src/readiness-store.ts` |
| SC-e04s04-P0-01 | A reasoned scholarly override retains the original objection, authority, rationale, affected versions, and dissent while committing only the exact reviewed option. | P0 | Integration | `test/e04s04-overrides.test.ts`, `src/override-store.ts` |
| SC-e04s04-P0-02 | An override cannot waive identity, provenance, privacy/disclosure, execution-safety, or required external-authorization gates; denied commitments remain uncommitted. | P0 | Adversarial integration | `test/e04s04-overrides.test.ts`, `src/commitment-store.ts` |
| SC-e04s04-P1-03 | At most one targeted revision occurs within the authorized review path; persistent reviewer disagreement is returned to the owner with both positions visible rather than looping indefinitely. | P1 | Integration | `test/e04s04-overrides.test.ts`, `src/override-store.ts` |

## 2. Fixture Architecture & Isolation

- **Synthetic artifacts:** extend `test/e02-fixtures.ts` with deterministic candidate versions, exact dependency edges, two independent research branches, and sensitive markers that are never real participant data or credentials.
- **Decision packets:** create packet fixtures containing immutable packet/version IDs, candidate artifact references, dependency snapshot, scholarly findings, permitted actions, and a branch revision. Packet display and action payloads are separate objects so stale/forged payloads can be tested.
- **Owner authority:** use a trusted explicit-command fixture with a stable owner ID. Agent messages, imported documents, and ordinary strings are untrusted inputs and must have no access to the owner-action API.
- **Readiness:** use deterministic dependency and policy changes rather than sleeps. Assert current readiness separately from historical commitment status.
- **Branch concurrency:** use two SQLite handles or deterministic transaction barriers for stale/repeated promotion and approval commands. Assertions must inspect revisions and history, not timing.
- **Scholarly disagreement:** fixture one reviewer finding and one methodology position with a retained dissent record. Use a single targeted revision counter to prove the finite-revision boundary.
- **Safety/external gates:** use existing E03 policy and lifecycle fakes with denied privacy/authorization conditions. No network calls or institutional claims are made by tests.
- **Isolation:** every test creates a temporary project and removes it in `finally`; tests do not read global Pi configuration or use real research material.

## 3. NFR Verification

| NFR Type | Requirement | Verification Command |
|---|---|---|
| Authority | Only an explicit owner command can create a commitment; forged chat/imported/agent approval and generic APIs have no side effect. | `npm run build && node --test --test-name-pattern='e04s01.*(owner|forg|approv|commit)' dist/test/*.test.js` |
| Integrity | Packet, selected option, branch revision, dependencies, command ID, actor, and resulting commitment are exact and reconstructable. | `npm run build && node --test --test-name-pattern='e04s0[1-3].*(exact|stale|duplicate|history|reconstruct)' dist/test/*.test.js` |
| Readiness | Historical approval does not bypass current dependency, policy, provenance, or external-authorization checks; impacts are transitive. | `npm run build && node --test --test-name-pattern='e04s0[2-4].*(readiness|impact|dependency|policy|authorization)' dist/test/*.test.js` |
| Branch isolation | Alternative exploration and adoption preserve unrelated branches and reject stale/concurrent writes. | `npm run build && node --test --test-name-pattern='e04s03.*(branch|promot|concurr|isolation)' dist/test/*.test.js` |
| Privacy/security | Override and decision history retain safe metadata without restricted payloads and cannot waive E03 non-waivable controls. | `npm run build && node --test --test-name-pattern='e04s04.*(override|dissent|privacy|security|non.waiv)' dist/test/*.test.js` |
| Compatibility | Released E01–E03 runtime, persistence, policy, disclosure, lifecycle, and adversarial tests remain passing. | `npm run typecheck && npm run lint && npm run build && npm test` |

## 4. Out of Scope

- Provider/search/parser/import/export implementations owned by later epics.
- Institutional or community authorization decisions owned by e10; e04 only preserves and enforces the non-waivable authorization prerequisite.
- Bounded specialist dispatch, cumulative budgets, cancellation implementation, and analysis execution owned by e05/e11.
- Full backup/restore, migration, deletion propagation, and portability owned by e15.
- Terminal presentation and accessibility owned by e14.
- Hosted accounts, remote policy services, graph databases, sandbox guarantees, real credentials, participant data, or scholarly certification.

## 5. Release Evidence

The e04 release gate requires all 13 scenarios, all inherited E01–E03 tests, and explicit inspection of forged/stale/duplicate owner actions, branch isolation, transitive impact, retained dissent, and non-waivable gates. Deterministic tests prove the recorded authority and state transitions under synthetic fixtures; they do not establish scholarly validity or external institutional authorization.
