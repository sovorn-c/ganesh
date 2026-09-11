# e05s05 — Honest Provider Degradation and Session Rebinding

## 1. Identity

- **Story ID:** e05s05
- **Epic:** e05 — Bounded autonomous work and specialist coordination
- **Type:** feat
- **Risk:** P0
- **Context:** infra/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want provider failures, timeouts and session replacement to degrade honestly so that specialist work never silently switches destination or accepts results from a stale session.

## 3. Context

e05s01-e05s04 already bind contracts, budgets and cancel fences. This slice adds consented provider destinations, bounded retries, timeout failure, and Pi session subscription rebinding. Installed Pi SDK `docs/sdk.md` states that `createAgentSessionRuntime` replacement changes `runtime.session` and that callers must unsubscribe and `session.subscribe` / `bindExtensions` again.

## 4. Problem

A timeout retried against an unauthorized fallback, or a result accepted from a replaced session's old subscription, bypasses destination policy and current-run identity. Uncertain usage booked as zero reopens the spend-cap hole closed in e05s03.

## 5. Goal

Require a consented destination/purpose for provider-backed runs, retry failures/timeouts within recorded bounds then fail, rebind subscriptions after session replacement, and keep unauthorized fallback and stale-session acceptance impossible.

## 6. Non-Goals

- Real paid provider calls, live model quality and global Pi configuration changes.
- Terminal session UX; E14 owns presentation.
- Local analysis execution; E11 owns command running.
- Scholarly competencies; E07-E13 own those.

## 7. Stakeholders

- Owners who authorized a specific destination.
- Security reviewers of AC-09/AC-10 no-fallback behavior during autonomous runs.
- Later E16 diagnostics that will correlate provider attempts.

## 8. Dependencies

- e05s01 dispatch checkpoints, e05s03 pricing/uncertainty rules, e05s04 cancel fences.
- E03 `requestDisclosure` / `checkLifecyclePolicy` phase `external`.
- Installed `@earendil-works/pi-coding-agent@0.85.1` `createAgentSessionRuntime` and session replacement notes in `docs/sdk.md`.
- `specs/product/PRIOR_ART.md` session-runtime rebind evidence.
- `specs/tech-architecture/e05-TEST_PLAN_LATEST.md` SC-e05s05-P0-01 through SC-e05s05-P1-04.

## 9. Assumptions

- Tests inject `SpecialistSessionPort`. A production adapter may wrap `createAgentSessionRuntime` but MUST NOT be exercised against the network in this epic's tests.
- Consented destination means a current E03 grant for that destination and purpose on every assigned version, checked at the `external` checkpoint immediately before the port call.
- Bounded retries are a small injected integer (tests use 1 retry). Backoff is deterministic and fake-clock friendly; no real sleep.
- Session replacement includes `newSession`, `switchSession`, `fork` and documented clone/import flows. After replacement, old unsubscribe handles are invalid.

## 10. Constraints

- Provider/session calls MUST pass `checkLifecyclePolicy(..., "external")` and `requestDisclosure` for operation `prompt` (or the actual existing disclosure operation for that call). Denied calls MUST NOT retry against another destination.
- Timeouts and provider failures retry only against the same consented destination until the retry bound, then the run fails.
- After `runtime.session` replacement, the adapter MUST unsubscribe the prior listener, assign `session = runtime.session`, subscribe again, and `bindExtensions` when extensions are used. Submissions from the prior session ID MUST be rejected.
- Uncertain usage remains reserved per e05s03. Missing usage reports MUST NOT settle spend as zero.
- Adapter errors MUST NOT include credentials, prompt bodies or restricted source bytes.

## 11. Domain Model

- **Provider attempt:** destination, purpose, attempt number, outcome (`ok` | `timeout` | `failure` | `denied`), pricing status.
- **Session handle:** current session ID bound to one run.
- **Rebind:** explicit resubscribe after AgentSessionRuntime replacement.
- **Unauthorized fallback:** any retry or continuation that changes destination, purpose or local-only handling without a current grant.

## 12. Requirements

### ADDED: Bounded honest retries

Provider failures and timeouts MUST retry within the contract bound on the same consented destination, then fail. They MUST NOT switch destination or use a local-to-remote fallback.

### ADDED: Consented destination selection

A provider-backed run MUST declare destination and purpose. Mismatch, withdrawal, expiry or local-only inputs MUST deny the external checkpoint.

### ADDED: Session subscription rebinding

Session replacement MUST rebind event subscriptions and extensions to the new `runtime.session`. Results from an unbound prior session MUST NOT be accepted as current.

### ADDED: Uncertain outcomes stay conservative

Until usage is reconciled, reserved cost and limits remain held. Unknown or missing usage MUST NOT be treated as zero.

## 13. Non-Functional Requirements

- **Security:** no unauthorized destination, no stale-session acceptance, no credential leakage.
- **Honesty:** failures, timeouts, retry counts and rebind events are inspectable.
- **Isolation:** tests never open a real Pi session or network socket.
- **Compatibility:** prior E05 stories and released suites remain passing.

## 14. Contracts

### New contracts

- `SpecialistSessionPort.start | prompt | cancel | rebind | submit`
- `createPiSessionAdapter(options): SpecialistSessionPort` (production seam; untested against network here)
- `recordProviderAttempt(handle, runId, attempt): void`
- `listProviderAttempts(handle, runId): readonly ProviderAttempt[]`

### Existing contracts preserved

- E03 disclosure denials remain authoritative.
- e05s03 unknown/uncertain budget rules remain authoritative.
- e05s04 cancel still fences acceptance of late provider results.

## 15. Reason for Depth and Zoom-Out

`src/work/session-adapter.ts` is the only Pi-facing module. Callers are `work-runtime.ts` and tests through the port interface. A one-implementation interface is justified because tests must not construct `createAgentSessionRuntime`. No second HTTP client or agent SDK is added; the locked Pi package is `[OK]`.

Quoted SDK detail: after `createAgentSessionRuntime` replacement, `runtime.session` changes and "event subscriptions are attached to a specific `AgentSession`, so re-subscribe after replacement" (`node_modules/@earendil-works/pi-coding-agent/docs/sdk.md`).

## 16. Implementation Steps

1. Record consented destination checks and deny mismatched or withdrawn provider calls without fallback → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s05.*(destination|consent|withdraw|fallback)' dist/tests/*/*.test.js`
2. Bound timeout and failure retries on the same destination, then fail the run honestly → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s05.*(timeout|retry|failure)' dist/tests/*/*.test.js`
3. Rebind subscriptions after session replacement and reject unbound prior-session submissions → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e05s05.*(rebind|replace|unbound|subscribe)' dist/tests/*/*.test.js`
4. Keep uncertain usage reserved, redact adapter errors, and pass released regressions with no new security findings in affected paths → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e05s05.*(uncertain|zero|redact|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e05s05-P0-01: Failure and timeout without fallback

```gherkin
Given a consented destination and a port that times out then fails
When the run retries within the bound and then exhausts retries
Then the run fails with inspectable attempts
And no other destination is used
```

### Scenario SC-e05s05-P0-02: Destination mismatch denies

```gherkin
Given assigned inputs that are local-only or granted for a different destination
When a provider-backed dispatch is attempted
Then the external checkpoint denies the call
And no session prompt is sent
```

### Scenario SC-e05s05-P0-03: Replacement rebinds

```gherkin
Given a running session whose runtime replaces `runtime.session`
When the adapter rebinds subscriptions
Then only the new session can submit a current candidate
And the prior session handle is rejected
```

### Scenario SC-e05s05-P1-04: Uncertain usage is not zero

```gherkin
Given a provider attempt with no final usage report
When budget is inspected
Then the original reservation remains
And spent is not recorded as zero-cost completion
```

## 18. Verification Script (Step-by-Step)

1. Dispatch a provider-backed run with a timeout-then-fail fake; inspect attempt records.
2. Attempt dispatch with a destination that current policy denies; confirm no port start.
3. Replace the fake session ID and confirm old submissions are rejected after rebind.
4. Leave usage unknown; inspect budget reservation.
5. Run the inherited suite under Node.js 24.

## 19. Risks and Mitigations

- **Silent fallback:** destination is part of the attempt key; tests fail if it changes across retries.
- **Stale listeners:** adapter tests assert unsubscribe was called and the previous session ID cannot `submit`.
- **Live Pi in tests:** the production adapter is not constructed in default tests; only the port fake is.

## 20. Traceability

- Scope outcome: R05
- Epic acceptance scenarios: AC-09, AC-17
- Test scenarios: SC-e05s05-P0-01, SC-e05s05-P0-02, SC-e05s05-P0-03, SC-e05s05-P1-04
- Domain contracts: PRIOR_ART Pi session-runtime rebind; E03 disclosure no-fallback; tech-stack invariant 5
