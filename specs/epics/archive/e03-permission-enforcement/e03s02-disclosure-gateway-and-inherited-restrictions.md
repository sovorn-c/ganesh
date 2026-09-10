# e03s02 — Disclosure Gateway and Inherited Restrictions

## 1. Identity

- **Story ID:** e03s02
- **Epic:** e03 — Enforced data-use and capability controls
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want every derived representation and disclosure destination to use the same policy gateway so that summaries, prompts, exports, diagnostics, and analysis inputs cannot shed their source restrictions.

## 3. Context

E03s01 establishes exact classifications and scoped permissions. This story carries those restrictions through common disclosure operations and derived content, including cross-branch use. The gateway must be the single decision boundary for local and external destinations without becoming a generic workflow engine.

## 4. Problem

A system can protect an original file while leaking its contents through a summary, attachment, prompt, embedding, telemetry event, export, or diagnostic. Branch snapshots preserve research history but do not preserve withdrawn current permission.

## 5. Goal

Implement a disclosure request/gateway contract that evaluates all source versions, inherits the strongest restrictions, blocks unauthorized destinations without fallback, and records inspectable decisions across branches.

## 6. Non-Goals

- Policy record creation and classification vocabulary; e03s01 owns those contracts.
- Protected owner/capability APIs and Pi loading; e03s03 owns those boundaries.
- Lifecycle dispatch/resume/acceptance and revocation timing; e03s04 owns those checkpoints.
- Real provider integrations, document parsers, embedding services, or export formats owned by later epics.
- Data deletion and backup propagation owned by e15.

## 7. Stakeholders

- Researchers handling sensitive or participant-identifiable material.
- Prompt, attachment, summary, export, telemetry, and analysis callers.
- Branch and dependency stores that identify inherited source versions.
- Reviewers auditing denied and permitted disclosure attempts.

## 8. Dependencies

- e03s01 classification, permission, and policy decision contracts.
- E02 artifact, dependency, branch, and history stores.
- `specs/tech-architecture/tech-stack.md` invariants 3–5 and `specs/docs/05-decisions-and-acceptance.md` AC-10.
- `specs/tech-architecture/e03-TEST_PLAN_LATEST.md`, scenarios SC-e03s02-P0-01 through SC-e03s02-P1-03.
- Existing Node.js 24 and Pi-compatible local boundary; no new external package is proposed.

## 9. Assumptions

- Every disclosure request names input version IDs, operation kind, destination, purpose, and optional transformation.
- Derived material records its source versions and cannot claim fewer restrictions than any source.
- A local-only decision is still a policy decision and can be denied when the local operation violates project scope.
- A blocked request terminates at the gateway; it does not attempt a different provider or destination.

## 10. Constraints

- Current permission, not historical branch state, controls new disclosure.
- The gateway must handle prompts, pasted text, attachments, summaries, compaction, snippets, embeddings, telemetry, exports, diagnostics, and analysis inputs through one explicit contract.
- Restricted content must never appear in denial diagnostics, logs, or decision metadata.
- Cross-branch checks use E02 dependency/reference data and do not rewrite historical snapshots.
- The implementation must remain usable offline for local policy decisions.

## 11. Domain Model

- **Disclosure request:** exact source versions, operation, destination, purpose, transformation, branch, and correlation ID.
- **Derived material:** a new candidate representation linked to all source versions and inherited restrictions.
- **Disclosure decision:** allowed or denied result with policy references, redacted reason, and no content payload.
- **Destination:** a named local or external sink whose identity is part of policy scope.

## 12. Requirements

### ADDED: Derived material inherits restrictions

A derived summary, prompt, attachment, compacted context, snippet, embedding, telemetry record, export, diagnostic, or analysis input MUST retain all applicable source restrictions. Combining inputs MUST select the most restrictive effective policy and MUST NOT broaden destination or purpose authority.

### ADDED: All disclosure paths use one gateway

Every supported disclosure request MUST pass through the policy gateway with exact source versions, destination, purpose, and transformation. A denied local operation MUST not trigger an unauthorized remote fallback.

### ADDED: Branch history does not restore withdrawn permission

A permission withdrawal MUST block new disclosure requests from every branch using the affected source while preserving the branch's historical snapshot and inspectable decision history.

## 13. Non-Functional Requirements

- **Security:** no gateway bypass through representation changes, branch selection, or destination aliases.
- **Provenance:** each allowed result identifies exact source versions, destination, purpose, transformation, and decision.
- **Privacy:** denied results and logs contain no restricted bytes, credentials, or participant identifiers.
- **Reliability:** gateway behavior is deterministic and offline-capable for local checks.

## 14. Contracts

### New contracts

- `requestDisclosure(project, request)` evaluates and returns a redacted `DisclosureDecision`.
- `deriveMaterial(project, inputVersions, transformation)` records inherited restrictions before producing a candidate.
- `effectiveRestriction(project, sourceVersions, branchId)` resolves the most restrictive current policy.
- `recordDisclosureDecision(project, decision)` persists an inspectable redacted audit record.

### Existing contracts preserved

- E02 exact artifact/dependency/branch references and historical snapshots.
- E03s01 classification and scoped policy records.
- Later provider/import/export callers receive a gate result rather than direct credential or network access.

## 15. Reason for Depth and Zoom-Out

The gateway modifies the existing E02 artifact/dependency/branch surface. Its callers are future import, prompt, attachment, compaction, export, diagnostic, embedding, telemetry, and analysis adapters; its contract is a redacted, exact-version, fail-closed decision. Centralizing this shared interface prevents one disclosure path from implementing weaker inheritance rules.

## 16. Implementation Steps

1. Define disclosure request, destination, transformation, inherited restriction, and redacted decision types over e03s01 policy records → verify: `npm run build && node --test --test-name-pattern='e03s02.*(request|destination|restriction|decision)' dist/test/*.test.js`
2. Implement effective restriction resolution over multiple exact source versions and E02 dependency/branch references → verify: `npm run build && node --test --test-name-pattern='e03s02.*(inherit|restrict|dependency|branch)' dist/test/*.test.js`
3. Route prompt, attachment, summary, compaction, snippet, embedding, telemetry, export, diagnostic, and analysis-shaped requests through the gateway → verify: `npm run build && node --test --test-name-pattern='e03s02.*(prompt|attach|summary|compact|snippet|embed|telemetry|export|diagnostic|analysis)' dist/test/*.test.js`
4. Add cross-branch revocation, no-fallback denial, redaction, and offline decision integration tests → verify: `npm run build && node --test --test-name-pattern='e03s02.*(revoke|fallback|redact|offline)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e03s02-P0-01: Derived representations retain restrictions

```gherkin
Given restricted source versions are used to create a summary, prompt, attachment, or export
When a disclosure request is evaluated for a destination and purpose
Then the derived request inherits every applicable restriction
And a destination or purpose not covered by current policy is denied
```

### Scenario SC-e03s02-P0-02: Revocation reaches every branch

```gherkin
Given two research branches reference the same restricted source version
When its disclosure permission is withdrawn
Then new requests from both branches are denied
And historical branch snapshots and decision records remain inspectable
```

### Scenario SC-e03s02-P1-03: Denial has no remote fallback

```gherkin
Given a local operation is denied by current policy
When the caller attempts to continue the operation
Then the gateway returns an actionable denial
And no alternate remote destination or provider call is attempted
```

## 18. Verification Script (Step-by-Step)

1. Create two E02 branches that reference one synthetic restricted source version.
2. Request prompt, summary, attachment, export, diagnostic, and analysis disclosures to permitted and unpermitted destinations.
3. Confirm allowed requests record exact sources and transformations while denied records contain no source bytes.
4. Withdraw the shared source permission and repeat requests from both branches.
5. Confirm all new requests deny, historical snapshots remain unchanged, and no fallback sink was called.

## 19. Risks and Mitigations

- **Path omission:** maintain a named operation registry and test every listed disclosure kind.
- **Restriction loss:** calculate effective policy from all source versions, including transitive dependencies.
- **Alias bypass:** canonicalize destination identity before evaluation.
- **Cross-branch stale state:** query current policy at request time rather than copying grants into snapshots.
- **Diagnostic leakage:** use structured redacted reasons and synthetic sensitive markers in tests.

## 20. Traceability

- Scope outcome: R03
- Epic acceptance scenarios: AC-09, AC-10
- Test-plan scenarios: SC-e03s02-P0-01, SC-e03s02-P0-02, SC-e03s02-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — invariants 3–5 and cross-branch permission revocation
- Decisions: D-05, D-07, D-16, D-17
