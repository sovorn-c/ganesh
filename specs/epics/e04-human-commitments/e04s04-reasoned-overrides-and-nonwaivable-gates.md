# e04s04 — Reasoned Scholarly Overrides and Non-Waivable Gates

## 1. Identity

- **Story ID:** e04s04
- **Epic:** e04 — Human commitments and research alternatives
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 4
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want to record a reasoned response to a scholarly objection without hiding dissent, while knowing that privacy, provenance, execution safety, and external authorization remain mandatory.

## 3. Context

E04s01–s03 provide exact owner decisions, lifecycle/readiness, and alternative adoption. Scholarly findings can be contestable, but a human override must not become an agent “pass” or a blanket bypass of E03 controls or future external authorization evidence.

## 4. Problem

A reviewer disagreement can cause either an indefinite automated loop or an opaque override that erases the objection. Conversely, treating internal scholarly approval as permission to disclose or execute would violate the separation between human commitment, current policy, and external authority.

## 5. Goal

Persist reviewer and methodology positions, allow one bounded reasoned owner override for an exact candidate, retain dissent and rationale, and compose commitment gates so non-waivable failures always block adoption.

## 6. Non-Goals

- Creating academic supervisor accounts or authenticating external institutions.
- Replacing the Reviewer/Methodology roles or certifying scholarly validity.
- Bypassing E03 privacy, capability, provenance, lifecycle, or execution-safety controls.
- Implementing the e10 external authorization registry; this story consumes an explicit status contract.

## 7. Stakeholders

- Owners resolving a documented scholarly disagreement.
- Reviewers and methodology contributors whose positions must remain attributed.
- E03 security/privacy boundaries and e10 external-authorization consumers.

## 8. Dependencies

- e04s01 exact owner disposition and e04s02 readiness contracts.
- e04s03 branch/adoption impact contracts where an override selects an alternative.
- E03 `policy-store.ts`, `disclosure-gateway.ts`, and `lifecycle-gate.ts` current checks.
- `specs/docs/05-decisions-and-acceptance.md` AC-14 and AC-15.
- `specs/tech-architecture/e04-TEST_PLAN_LATEST.md` scenarios SC-e04s04-P0-01 through SC-e04s04-P1-03.

## 9. Assumptions

- A reviewer finding includes an affected exact version, rationale, severity, and source basis; the system records it but does not decide scholarly truth.
- The owner supplies a non-empty reason and identifies the exact candidate and retained objection.
- External authorization is represented by a status supplied by the applicable authority workflow: `not-required` with basis or `documented-approved` can pass; `unknown`, `pending`, `expired`, and `withdrawn` block.
- One targeted revision is finite; persistent disagreement is a human decision point, not an agent retry loop.

## 10. Constraints

- Override records MUST retain the original finding, dissent, owner rationale, actor, exact versions, and resulting decision.
- Override cannot waive identity, provenance, current privacy/disclosure, execution safety, or required external authorization.
- A failed non-waivable gate creates no commitment and reports the blocking reason.
- Revision count is persisted and bounded; a second unresolved blocker returns control to the owner.

## 11. Domain Model

- **Scholarly finding:** attributed contestable assessment linked to exact artifact versions and evidence.
- **Reasoned override:** owner disposition that retains a finding while permitting a candidate only after all non-waivable gates pass.
- **Non-waivable gate:** identity, provenance, privacy, execution safety, current policy, or required external authorization check that scholarly rationale cannot bypass.
- **Revision budget:** one targeted revision opportunity within the bounded review path.

## 12. Requirements

### ADDED: Dissent-preserving override

A reasoned override MUST retain the original scholarly finding, affected versions, source basis, owner rationale, actor, and residual uncertainty. It MUST record that the finding remains contestable; it MUST NOT relabel the finding as an agent pass.

### ADDED: Non-waivable commitment gates

An override MAY resolve a contestable scholarly disposition only when exact identity, provenance, current data-use/privacy policy, execution safety, and required external authorization checks pass. No owner scholarly rationale or branch selection can waive a failed non-waivable gate.

### ADDED: Finite revision

The review path MUST permit at most one targeted revision under its recorded budget. Persistent disagreement or a second unresolved blocker MUST return an actionable human decision with both positions visible and no automatic loop.

## 13. Non-Functional Requirements

- **Security:** all E03 policy/lifecycle/capability checks remain authoritative.
- **Integrity:** dissent, override rationale, exact versions, and gate outcomes are append-only and attributable.
- **Privacy:** findings and audit records contain references/metadata, not restricted payloads.
- **Boundedness:** revision and override operations have explicit finite limits.

## 14. Contracts

### New contracts

- `recordScholarlyFinding(handle, input)` records an attributed finding and exact affected versions.
- `recordReasonedOverride(handle, request)` preserves dissent and owner rationale for one exact candidate.
- `evaluateCommitmentGates(handle, request)` composes current E03 checks, provenance/readiness, and an external-authorization status without treating scholarly override as authorization.
- `resolveReviewDisagreement(handle, request)` records one revision or returns the issue to the owner after the finite limit.

### Existing contracts preserved

- e04s01–s03 packet, commitment, readiness, branch, impact, and owner-action contracts.
- E03 policy/revocation/capability boundaries and E02 exact artifact/dependency/history.
- External authorization remains a separate e10-owned record and cannot be manufactured by e04.

## 15. Reason for Depth and Zoom-Out

This story modifies the shared commitment gate surface and calls existing E03 modules. `src/policy-store.ts` owns current data-use policy evaluation; callers include disclosure and lifecycle gates; its contract is deny-by-default for missing/withdrawn/expired policy and attributable decisions. `src/lifecycle-gate.ts` owns current operation checkpoints and revocation fences; callers include execution/resume acceptance; its contract is current-policy evaluation at every boundary. A focused gate-composition function is justified to keep non-waivable checks explicit; no generic scholarly scoring or external-authority abstraction is proposed.

## 16. Implementation Steps

1. Add finding, dissent, override, gate-result, and finite-revision records with additive migration → verify: `npm run build && node --test --test-name-pattern='e04s04.*(schema|finding|dissent|override)' dist/test/*.test.js`
2. Implement one targeted revision and reasoned override persistence with exact candidate/version binding and retained disagreement → verify: `npm run build && node --test --test-name-pattern='e04s04.*(revision|override|disagree|rationale)' dist/test/*.test.js`
3. Compose current E03 policy/lifecycle/provenance and external-authorization status checks so non-waivable failures block commitment → verify: `npm run build && node --test --test-name-pattern='e04s04.*(gate|policy|provenance|authorization|non.waiv|blocked)' dist/test/*.test.js`
4. Add adversarial, privacy, finite-loop, and complete E04 regression fixtures → verify: `npm run build && npm test && node --test --test-name-pattern='e04s04.*(advers|privacy|finite|regression|redact)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e04s04-P0-01: Override retains dissent

```gherkin
Given a reviewer finding that conflicts with a methodology recommendation
When the owner records a reasoned override for an exact candidate
Then the finding, both positions, rationale, actor, versions, and uncertainty remain visible
And only that exact candidate is considered for commitment
```

### Scenario SC-e04s04-P0-02: Non-waivable gates still block

```gherkin
Given a reasoned scholarly override and a missing or withdrawn privacy, provenance, safety, or external authorization condition
When commitment gates are evaluated
Then the candidate remains uncommitted and the blocking gate is reported
And the override cannot manufacture external authorization or bypass current policy
```

### Scenario SC-e04s04-P1-03: Revision is finite

```gherkin
Given a disagreement requiring revision
When one targeted revision is attempted and the blocker persists
Then the system returns both positions and an actionable owner decision
And it does not launch an indefinite automated review loop
```

## 18. Verification Script (Step-by-Step)

1. Create synthetic reviewer and methodology findings tied to exact candidate versions.
2. Record one targeted revision, then a reasoned owner override and inspect retained dissent.
3. Exercise missing, withdrawn, and approved/not-required external authorization statuses with current E03 policy states.
4. Confirm only the fully gated exact candidate can be committed and persistent disagreement stops.
5. Inspect redacted records and run all inherited E01–E03 tests.

## 19. Risks and Mitigations

- **Override becomes a safety bypass:** evaluate non-waivable gates after, not before, recording the scholarly rationale and assert no commitment on denial.
- **Dissent disappears:** make finding and override records append-only and expose both in inspection.
- **Agent retry loop:** persist revision count and stop after one targeted revision.
- **Internal approval confused with external authority:** accept only explicit external status evidence and keep e10 ownership visible.

## 20. Traceability

- Scope outcome: R04
- Epic acceptance scenarios: AC-14, AC-15
- Test-plan scenarios: SC-e04s04-P0-01, SC-e04s04-P0-02, SC-e04s04-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — human authority, scholarly override, readiness, and external authorization
- Decisions: D-07, D-08, D-09, D-17, D-20
