# e05s03 — Cumulative Limits, Concurrent Accounting, and Enforced Spend Caps

## 1. Identity

- **Story ID:** e05s03
- **Epic:** e05 — Bounded autonomous work and specialist coordination
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want token, call, time and known-price spend limits to stay cumulative across retries, concurrent runs, revisions and restart so that autonomous work cannot silently mint a fresh budget.

## 3. Context

e05s01 reserves token/call/time for a single run. This slice makes that ledger concurrent-safe, applies it to retries and revised contracts, and adds a spend cap that is valid only when provider pricing is known.

## 4. Problem

Retries, overlapping dispatch and revised contracts are the usual ways to reset a budget. Unknown prices recorded as zero, or uncertain usage released as unused, make a spend cap false. Concurrent admission without atomic remaining-balance checks overspends.

## 5. Goal

Atomically reserve remaining token, call, time and known-price spend before dispatch; reject over-admission; preserve spent and reserved amounts across retry, revision and reopen; deny required spend caps when pricing is unknown; keep uncertain outcomes conservative.

## 6. Non-Goals

- First-run authorization and snapshot isolation; e05s01 owns these.
- Role disagreements; e05s02 owns these.
- Cancel fences and late-output quarantine; e05s04 owns these.
- Provider retry policy and session rebind beyond recording usage/pricing status; e05s05 owns these.
- Measured production performance budgets and operational diagnostics; E16 owns these.

## 7. Stakeholders

- Owners who authorized finite work and expect the ceiling to hold after a crash.
- Concurrent specialist runs sharing one contract.
- Later E16 reliability work that will read these ledgers rather than invent a second budget.

## 8. Dependencies

- e05s01 run records, command identity and the initial token/call/time reservation.
- `specs/tech-architecture/tech-stack.md` invariant 8 and work-budget concurrency row.
- `specs/tech-architecture/DESIGN_PLAN_LATEST.md` budget admission rules.
- `specs/tech-architecture/e05-TEST_PLAN_LATEST.md` SC-e05s03-P0-01 through SC-e05s03-P0-04.

## 9. Assumptions

- Pricing is a discriminated status: `known` with currency, unit and amount, or `unknown` with a reason. There is no implicit zero.
- A spend cap on a contract is a required monetary guarantee. Dispatch against that cap is allowed only with `known` pricing.
- Contract revision creates a new contract version that inherits spent totals; it does not grant a fresh allowance unless the owner authorizes an explicit limit increase on the new version.
- Uncertain provider usage keeps the original reservation until an explicit reconcile records spent <= reserved.

## 10. Constraints

- Reservation updates use a single SQLite transaction with expected remaining balances. Concurrent over-admission fails entirely; it MUST NOT commit a partial dimension.
- Retry of a run consumes remaining contract budget through a new run record when the previous run is terminal; an identical in-flight command resumes rather than double-reserving.
- Restart/reopen MUST reconstruct spent, reserved and remaining from the ledger; it MUST NOT treat missing provider receipts as zero spend.
- Unknown pricing MAY proceed only when the contract has no spend cap. The unknown status is stored and never converted to amount 0.
- Ledger rows contain dimension, reserved, spent, remaining, run ID and reason. They do not contain prompt text or credentials.

## 11. Domain Model

- **Budget ledger:** append-only reservations and settlements per contract and dimension (`tokens`, `calls`, `timeMs`, `spend`).
- **Known price:** explicit currency/unit/amount used to compute spend reservation.
- **Unknown price:** recorded inability to guarantee spend; cannot satisfy a spend cap.
- **Uncertain outcome:** a started provider/session effect whose usage is not yet final; reservation is held.
- **Revised contract:** a new version that carries prior spent totals forward.

## 12. Requirements

### ADDED: Concurrent atomic reservation

Two overlapping `dispatchRun` calls on one contract MUST serialize on remaining token, call and time. The second MUST be rejected when remaining balance is insufficient, with no partial reservation.

### ADDED: Survival across retry, revision and restart

Spent and reserved amounts MUST survive terminal retry (new run), authorized contract revision and project reopen. None of those events MAY reset spent totals.

### ADDED: Known-price spend cap

When a contract includes a spend cap, dispatch MUST reserve cost from known pricing before the session starts and MUST preserve spent/reserved cost across retry, revision and restart.

### ADDED: Unknown price and uncertain usage are not zero

Unknown pricing MUST deny a required spend cap. Uncertain outcomes MUST keep a conservative reservation and MUST NOT be booked as zero-cost completed work.

## 13. Non-Functional Requirements

- **Integrity:** ledger totals reconstruct after reopen and match the sum of reservation/settlement rows.
- **Concurrency:** expected-balance transactions prevent overspend under interleaved dispatch.
- **Honesty:** unknown and uncertain statuses remain visible.
- **Compatibility:** e05s01/e05s02 behavior and released tests remain passing.

## 14. Contracts

### New contracts

- `reserveBudget(handle, contractVersionId, runId, dimensions): ReservationResult`
- `settleBudget(handle, runId, actuals): SettlementResult`
- `inspectBudget(handle, contractId): BudgetInspection`
- `quoteProviderPrice(destination, unit): PriceQuote` (`known` | `unknown`)
- `reviseContract(handle, ownerCapability, request): ContractResult` inheriting spent totals

### Existing contracts preserved

- e05s01 `dispatchRun` still refuses to start a session before a successful reservation.
- E02 project locking continues to exclude extra OS processes; this story still uses transactional expected balances inside one process.

## 15. Reason for Depth and Zoom-Out

`src/work/budget-ledger.ts` owns reservation arithmetic and ledger persistence because concurrent admission is a different failure contract from snapshot construction. Callers are `work-runtime.ts` and tests. No separate accounting service or queue is added.

## 16. Implementation Steps

1. Persist per-dimension ledgers and reject concurrent over-admission atomically → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s03.*(ledger|concurrent|over-admission|reserv)' dist/tests/*/*.test.js`
2. Prove retry, revision and reopen preserve spent and reserved token/call/time → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s03.*(retry|revision|reopen|spent)' dist/tests/*/*.test.js`
3. Enforce known-price spend caps and deny unknown pricing when a monetary guarantee is required → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s03.*(spend|known|unknown|guarantee)' dist/tests/*/*.test.js`
4. Keep uncertain outcomes reserved, never zero, and pass released regressions with no new security findings in affected paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e05s03.*(uncertain|zero|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e05s03-P0-01: Concurrent admission

```gherkin
Given a contract with remaining budget sufficient for only one of two requested runs
When both dispatch calls reserve concurrently
Then exactly one run is admitted
And the other is rejected with no partial dimension committed
```

### Scenario SC-e05s03-P0-02: Retry, revision, restart

```gherkin
Given spent and reserved token, call and time on a contract
When a terminal retry, an authorized revision and a project reopen occur
Then spent totals remain
And remaining budget is reduced by those totals rather than reset
```

### Scenario SC-e05s03-P0-03: Known-price spend cap

```gherkin
Given known provider pricing and a spend cap
When a run is dispatched, retried, revised and reopened
Then spend is reserved before dispatch
And spent plus reserved cost never exceed the cap
```

### Scenario SC-e05s03-P0-04: Unknown and uncertain are not zero

```gherkin
Given unknown pricing on a contract that requires a spend cap
When dispatch is attempted
Then dispatch is denied because the monetary guarantee cannot be satisfied
And an uncertain in-flight outcome keeps its reservation instead of booking zero
```

## 18. Verification Script (Step-by-Step)

1. Authorize a tiny-limit contract and interleave two dispatch reservations.
2. Spend part of the budget, retry, revise the contract, close and reopen; inspect `inspectBudget`.
3. Dispatch with a known-price quote under a spend cap; confirm reservation.
4. Attempt a spend-capped dispatch with unknown pricing; confirm denial.
5. Run the inherited suite under Node.js 24.

## 19. Risks and Mitigations

- **Lost updates:** expected remaining balances in one transaction, not read-then-write without a check.
- **Zero-filling unknowns:** pricing status is a union type; tests reject numeric coercion to 0.
- **Revision loophole:** reviseContract copies spent totals unless the owner explicitly raises limits on the new version.

## 20. Traceability

- Scope outcome: R05
- Epic acceptance scenarios: AC-17
- Test scenarios: SC-e05s03-P0-01, SC-e05s03-P0-02, SC-e05s03-P0-03, SC-e05s03-P0-04
- Domain contracts: tech-stack invariant 8; DESIGN_PLAN budget admission; glossary work contract versus run
