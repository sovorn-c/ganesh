# e04s01 — Versioned Decision Packets and Explicit Owner Dispositions

## 1. Identity

- **Story ID:** e04s01
- **Epic:** e04 — Human commitments and research alternatives
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want to review an exact versioned decision packet and record an explicit disposition so that only the option and dependencies I saw can become a human commitment.

## 3. Context

E02 provides immutable artifact versions, branch snapshots, expected revisions, and command history. E03 prevents agents and imported material from acquiring owner authority. This story adds the first complete human-decision path without putting authority in conversation text or a generic tool.

## 4. Problem

An approval string from a chat message, agent response, or imported document is not an authenticated owner action. A packet can also become stale between display and action, or a retried command can create duplicate commitments unless the exact packet and branch state are checked transactionally.

## 5. Goal

Create inspectable decision packets containing exact candidate and dependency versions, and accept only an explicit local owner action for approval, rejection, or deferral. Stale, forged, duplicate, and partial actions must fail safely.

## 6. Non-Goals

- Commitment revision, archival, supersession, and current-readiness propagation; e04s02 owns these.
- Alternative branch adoption and transitive impact review; e04s03 owns these.
- Scholarly override and external-authorization gate composition; e04s04 and e10 own these boundaries.
- Terminal UI, hosted accounts, real participant data, or institutional authorization.

## 7. Stakeholders

- Project owners making consequential research decisions.
- E03 capability and policy boundaries that must remain non-bypassable.
- Later terminal, bounded-work, and study-progress integrations consuming exact decisions.

## 8. Dependencies

- E02 project, artifact, dependency, branch, snapshot, and history stores.
- E03 protected owner boundary and current policy terminology.
- `specs/docs/05-decisions-and-acceptance.md` AC-06 and AC-07.
- `specs/tech-architecture/e04-TEST_PLAN_LATEST.md` scenarios SC-e04s01-P0-01 through SC-e04s01-P1-03.
- Node.js 24 SQLite and existing transaction/ID utilities; no new package.

## 9. Assumptions

- The local project owner ID is the trusted identity available to the explicit owner-command boundary; no hosted authentication is introduced.
- A packet references immutable artifact versions and one branch snapshot/revision, not mutable content.
- Rejection and deferral are durable decisions but do not create a commitment.
- Imported text and agent output are data, not callable authority.

## 10. Constraints

- Approval must bind the displayed packet ID/version, selected candidate IDs, exact dependency versions, branch, and current branch revision.
- The command ID is unique and idempotent for an identical payload; reuse with a different payload is rejected.
- Stale packet or branch state fails before any decision or commitment row is partially written.
- Decision evidence stores identifiers, statuses, rationale, and actor without copying restricted artifact bytes.

## 11. Domain Model

- **Decision packet:** versioned question, candidate artifact versions, dependency snapshot, branch snapshot/revision, review references, and permitted actions.
- **Decision record:** immutable owner disposition with packet version, selected candidates, rationale, command ID, and resulting status.
- **Human commitment:** the approval result that adopts exact candidate versions; it is distinct from readiness and external authorization.
- **Candidate:** an artifact version presented for review but not yet adopted.

## 12. Requirements

### ADDED: Exact decision packets

A decision packet MUST identify its question, packet version, branch snapshot/revision, exact candidate artifact versions, dependency versions, reviews, and permitted owner actions. Packet content MUST be immutable after publication; a changed option creates a new packet version.

### ADDED: Explicit owner dispositions

Only a trusted explicit local owner action whose actor matches the project owner and whose payload matches the current packet may approve, reject, or defer. Approval creates one human commitment; rejection and deferral create historical decisions without adoption.

### ADDED: Stale and duplicate safety

An action MUST reject stale packet, candidate, dependency, or branch revisions before mutation. An identical repeated command returns its original result; a command ID with a different payload is rejected and cannot create a second commitment.

## 13. Non-Functional Requirements

- **Authority:** no agent, imported instruction, ordinary chat message, or generic public API path can create a commitment.
- **Integrity:** packet and action records retain exact IDs and versions sufficient to reconstruct what the owner saw.
- **Privacy:** decision history contains safe metadata and never stores restricted artifact content.
- **Durability:** decision and commitment rows are written atomically with the relevant branch/history update.

## 14. Contracts

### New contracts

- `createDecisionPacket(handle, input)` publishes a versioned packet from exact current references.
- `getDecisionPacket(handle, packetId)` returns the immutable packet and its candidate/dependency references.
- `recordOwnerDecision(handle, request)` validates owner identity, packet currency, exact selection, branch revision, and command idempotency before recording the disposition.
- `listDecisionHistory(handle, filters?)` returns attributable decision records without restricted payloads.

### Existing contracts preserved

- E02 artifact immutability, dependency references, branch expected-version checks, and append-only history.
- E03 capability boundary: policy evaluation and owner authority are not delegated to packet text.
- A human commitment is not external authorization, scholarly certification, or permanent readiness.

## 15. Reason for Depth and Zoom-Out

This story modifies the shared SQLite schema and public export boundary. `src/schema.ts` owns canonical project tables and migrations; its callers are every project store and schema reopen path; its contract is additive migration with E02/E03 compatibility. `src/index.ts` owns the public API surface; its callers are tests and later integrations; its contract is explicit typed exports without a generic authority escape. A focused decision store is justified because packet/action validation and idempotent commitment history must be one transactional boundary; no generic command framework is proposed.

## 16. Implementation Steps

1. Add e04 packet, candidate, decision, and commitment types plus additive schema tables/migration → verify: `npm run build && node --test --test-name-pattern='e04s01.*(schema|type|packet)' dist/test/*.test.js`
2. Publish and inspect immutable packets from exact branch snapshots, candidate versions, dependencies, reviews, and permitted actions → verify: `npm run build && node --test --test-name-pattern='e04s01.*(exact|packet|candidate|dependency)' dist/test/*.test.js`
3. Implement the explicit owner disposition transaction for approval, rejection, and deferral with stale checks and command idempotency → verify: `npm run build && node --test --test-name-pattern='e04s01.*(owner|approv|reject|defer|stale|duplicate)' dist/test/*.test.js`
4. Add forged-authority, partial-transaction, redaction, and E01–E03 regression fixtures → verify: `npm run build && npm test && node --test --test-name-pattern='e04s01.*(forg|partial|redact|regression)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e04s01-P0-01: Explicit owner approval binds exact versions

```gherkin
Given a displayed packet with exact candidate and dependency versions
When the project owner performs an explicit local approval action
Then one commitment records the packet, option, dependencies, actor, rationale, and branch revision
And an agent response, imported “approved” text, or ordinary chat message creates no commitment
```

### Scenario SC-e04s01-P0-02: Stale actions cannot partially commit

```gherkin
Given a displayed packet and a changed candidate, dependency, or branch revision
When the old approval action is submitted
Then the action is rejected as stale
And no decision, commitment, branch mutation, or partial history is created
```

### Scenario SC-e04s01-P1-03: Dispositions are durable and idempotent

```gherkin
Given an owner rejection, deferral, or repeated command
When the action is recorded or retried
Then rejection/deferral remain inspectable without adoption
And an identical retry returns the original result while a changed-payload reuse is rejected
```

## 18. Verification Script (Step-by-Step)

1. Create synthetic candidate artifacts and a branch snapshot with exact dependencies.
2. Publish and inspect a decision packet; record the packet version and references.
3. Attempt approval through a trusted owner action, an agent/imported string, a stale payload, and duplicate commands.
4. Confirm only the valid owner action creates one commitment and that all decisions are reconstructable without artifact bytes.
5. Run all inherited E01–E03 tests.

## 19. Risks and Mitigations

- **Forged authority:** expose commitment creation only through the explicit owner action contract and assert no side effects from untrusted strings.
- **TOCTOU stale approval:** validate packet, candidates, dependencies, and branch revision inside one transaction.
- **Duplicate commitment:** persist unique command IDs and payload hashes.
- **Restricted-data leakage:** store exact references and redacted rationale metadata, not source content.

## 20. Traceability

- Scope outcome: R04
- Epic acceptance scenarios: AC-06, AC-07
- Test-plan scenarios: SC-e04s01-P0-01, SC-e04s01-P0-02, SC-e04s01-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — human authority, packet transitions, readiness, and concurrency
- Decisions: D-05, D-07, D-09, D-15
