# e03s05 — Reviewed Declassification and Adversarial Integration

## 1. Identity

- **Story ID:** e03s05
- **Epic:** e03 — Enforced data-use and capability controls
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 6
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want an authorized transformation or declassification to be explicit and reviewable so that a permitted disclosure is limited to its stated purpose and does not hide residual risk or defeat earlier controls.

## 3. Context

The first four stories provide policy records, disclosure inheritance, protected capabilities, and lifecycle checks. This story closes the epic with the end-to-end path: a reviewed transformation can authorize a specific destination while adversarial material, forged approval, cross-project access, and diagnostic leakage remain blocked.

## 4. Problem

A declassification label can become a blanket exception unless the transformation, destination, purpose, authority, residual risk, and source versions are recorded and rechecked. Security tests that only assert prompt refusal miss bypasses in loaders, tools, storage, and disclosure adapters.

## 5. Goal

Deliver a complete synthetic end-to-end policy path with explicit reviewed declassification, adversarial prompt/document fixtures, redacted diagnostics, and regression checks across all e03 enforcement boundaries.

## 6. Non-Goals

- Institutional or community authorization decisions; e10 owns external authority.
- Scholarly approval and decision packet commitment; e04 owns human commitment semantics.
- Real participant data, credentials, provider calls, or network transmission in fixtures.
- Full production export/parser/viewer behavior owned by later epics.
- General security certification or a claim that deterministic tests establish scholarly validity.

## 7. Stakeholders

- Researchers who need a narrow, auditable exception for a transformed artifact.
- Security reviewers testing actual rather than prompt-only boundaries.
- Later provider, import, export, diagnostics, and analysis integrations.
- Qualified humans who inspect residual risk and applicability.

## 8. Dependencies

- e03s01 through e03s04 contracts and evidence.
- E02 exact artifact/dependency/branch/history and recovery behavior.
- `specs/docs/05-decisions-and-acceptance.md` AC-06, AC-09, AC-10, and AC-15.
- `specs/tech-architecture/e03-TEST_PLAN_LATEST.md`, scenarios SC-e03s05-P0-01 through SC-e03s05-P1-03.
- Existing Node.js 24 test/build/audit tooling; no new external package is proposed.

## 9. Assumptions

- Declassification is a new explicit policy record, not an edit to the source classification or a global allow flag.
- A transformation can reduce disclosed content but cannot claim to remove all residual risk without recorded basis.
- Adversarial fixtures can observe attempted side effects through fakes without using real secrets or network connections.
- Diagnostics expose identifiers, statuses, and reasons but never restricted payloads.

## 10. Constraints

- Declassification names exact input versions, transformation, destination, purpose, authority, residual risk, and validity.
- Every declassified request still passes current lifecycle, capability, and disclosure checks.
- Adversarial content is untrusted data; no parser or renderer may execute its instructions.
- Security failures block the epic; tests must assert absence of side effects as well as denial output.
- Evidence distinguishes deterministic policy enforcement from human review and external authorization.

## 11. Domain Model

- **Declassification record:** a scoped transformation exception with exact inputs, output, destination, purpose, authority, residual risk, and status.
- **Adversarial fixture:** synthetic imported content designed to request an unauthorized operation.
- **Boundary evidence:** a redacted decision plus observed side-effect record from a fake sink.
- **Policy audit packet:** inspectable collection of classification, permission, checkpoint, capability, and transformation evidence.

## 12. Requirements

### ADDED: Declassification is narrow and reviewable

An authorized declassification MUST identify exact input versions, transformation, destination, purpose, residual risk, authority, and validity. It MUST authorize only the named transformed output and MUST remain subject to current policy and lifecycle checks.

### ADDED: Adversarial paths fail at actual boundaries

Imported documents, prompts, built-in commands, curated resources, and generic tools MUST NOT acquire owner authority, credentials, cross-project access, canonical writes, or unauthorized disclosure through instruction text.

### ADDED: Protected decisions are redacted and attributable

Policy, capability, lifecycle, and disclosure evidence MUST be inspectable by identifier, status, reason, and authority without including restricted content, credentials, or participant-identifying values.

## 13. Non-Functional Requirements

- **Security:** adversarial tests verify no protected side effect, not only a denial message.
- **Privacy:** synthetic sensitive markers and redacted diagnostics prove payload absence.
- **Integrity:** transformed outputs retain exact source and policy provenance.
- **Operability:** denied and declassified outcomes provide valid next actions and residual-risk visibility.

## 14. Contracts

### New contracts

- `requestDeclassification(project, request)` records a scoped transformation and returns a reviewable result.
- `authorizeTransformedDisclosure(project, declassification, request)` permits only the named output when all current checks pass.
- `runAdversarialBoundarySuite(fixtures)` returns side-effect observations and redacted decisions.
- `inspectPolicyAudit(project, operationId)` returns an attributable audit packet without restricted payloads.

### Existing contracts preserved

- e03s01 policy evaluation, e03s02 disclosure inheritance, e03s03 capability protection, and e03s04 lifecycle gates.
- E02 artifact immutability, exact dependencies, branch history, and recovery semantics.
- E04/e10 ownership boundaries: declassification evidence does not create scholarly commitment or external institutional authorization.

## 15. Reason for Depth and Zoom-Out

This story integrates all e03 enforcement boundaries and modifies their shared audit surface. Callers are transformation review, disclosure authorization, adversarial tests, and diagnostics. Their contract is a narrow exact-version exception with no bypass of current policy. A focused integration boundary is justified because only an end-to-end test can prove that separate gates compose without a gap; no generic security framework is proposed.

## 16. Implementation Steps

1. Define declassification and policy-audit records with exact inputs, transformation, destination, purpose, authority, residual risk, and validity → verify: `npm run build && node --test --test-name-pattern='e03s05.*(declass|transform|residual|audit)' dist/test/*.test.js`
2. Enforce transformed disclosure through current policy, capability, lifecycle, and inherited-restriction checks → verify: `npm run build && node --test --test-name-pattern='e03s05.*(authorize|current|restriction|lifecycle)' dist/test/*.test.js`
3. Add adversarial fixtures for forged approval, credential access, cross-project reads, direct writes, document scripts, and unauthorized export with side-effect assertions → verify: `npm run build && node --test --test-name-pattern='e03s05.*(adversarial|forged|credential|cross.project|script|side.effect)' dist/test/*.test.js`
4. Add redacted audit inspection and full e03 regression coverage while preserving E01/E02 behavior → verify: `npm run build && npm test && node --test --test-name-pattern='e03s05.*(redact|regression|provenance|inspect)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e03s05-P0-01: Reviewed declassification is narrow

```gherkin
Given a classified input and a reviewed transformation naming an exact output, destination, purpose, authority, and residual risk
When the transformed disclosure is requested
Then only the named output and scope can be authorized
And changing the input, destination, purpose, or current policy causes denial
```

### Scenario SC-e03s05-P0-02: Adversarial content cannot bypass boundaries

```gherkin
Given an imported document or prompt instructs a worker to export credentials, approve a design, read another project, or write canonical state
When it reaches the loader, renderer, capability, and disclosure boundaries
Then every protected operation is denied
And no credential, cross-project read, canonical write, script execution, or external sink side effect occurs
```

### Scenario SC-e03s05-P1-03: Audit evidence is safe to inspect

```gherkin
Given policy and capability decisions include sensitive source material
When a researcher inspects the policy audit packet
Then exact identifiers, statuses, reasons, authority, and residual risk are visible
And restricted bytes, credentials, and participant-identifying values are absent
```

## 18. Verification Script (Step-by-Step)

1. Create a synthetic classified source and a reviewed transformation record.
2. Authorize the transformed output for its named destination and purpose; attempt changed scope and revoked-policy variants.
3. Run the adversarial fixture suite through loader, renderer, capability, lifecycle, and disclosure boundaries.
4. Inspect fake sink side effects and confirm all protected side effects are absent.
5. Inspect the policy audit packet and confirm provenance and residual risk are present without sensitive payloads.
6. Run the full inherited E01/E02 suite and e03 regression scenarios.

## 19. Risks and Mitigations

- **Declassification becomes a blanket allow:** require exact output and scope matching, then rerun all current checks.
- **Prompt-only tests:** use fakes that observe storage, credential, renderer, and sink side effects.
- **Audit leakage:** assert sensitive marker absence from serialized decisions and diagnostics.
- **Integration gaps:** maintain a matrix from each AC-06/09/10 path to a boundary test.
- **False certification:** state that tests prove enforcement behavior, not scholarly or institutional validity.

## 20. Traceability

- Scope outcome: R03
- Epic acceptance scenarios: AC-06, AC-09, AC-10, AC-15
- Test-plan scenarios: SC-e03s05-P0-01, SC-e03s05-P0-02, SC-e03s05-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — global invariants 1–6 and readiness/work transitions
- Decisions: D-05, D-07, D-16, D-17, D-20
