# e03s01 — Classification and Destination/Purpose Policy Records

## 1. Identity

- **Story ID:** e03s01
- **Epic:** e03 — Enforced data-use and capability controls
- **Type:** feat
- **Risk:** P0
- **Context:** domain
- **BCPs:** 7
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want every newly imported or pasted material to have an explicit classification and intended use so that local data cannot become remotely disclosable by default.

## 3. Context

E01 supplies the runtime and E02 supplies durable projects, immutable artifacts, branches, and history. This story adds the durable policy vocabulary and evaluator that later disclosure and capability gates consume. It keeps classification and data-use permission separate from scholarly approval and ordinary conversation text.

## 4. Problem

A file's location and an agent's wording do not establish permission to transmit or mutate research state. Without durable policy records, later gateways cannot distinguish unclassified material, permitted destinations, expired grants, inherited restrictions, or a forged approval claim.

## 5. Goal

Persist classifications and destination/purpose permissions, evaluate them deterministically, and expose fail-closed decisions with exact input versions and attributable authority.

## 6. Non-Goals

- Disclosure adapters and transformation inheritance; e03s02 owns those paths.
- Agent capability and Pi extension enforcement; e03s03 owns those paths.
- Lifecycle dispatch, resume, acceptance, and in-flight revocation; e03s04 owns those paths.
- Human commitment packet approval; e04 owns commitment creation.
- Institutional or community authorization; e10 owns external authorization.

## 7. Stakeholders

- Researchers who need local-only defaults and inspectable policy.
- The future disclosure gateway and capability broker.
- Reviewers who need to distinguish policy evidence from scholarly judgment.
- E02 persistence and branch callers that must retain exact versions.

## 8. Dependencies

- E02 project, artifact, dependency, branch, and history stores.
- `specs/tech-architecture/tech-stack.md` global invariants 3–6 and the SQLite canonical-state decision.
- `specs/tech-architecture/e03-TEST_PLAN_LATEST.md`, scenarios SC-e03s01-P0-01 through SC-e03s01-P1-03.
- Node.js 24 standard-library SQLite and crypto APIs already established by e02. No new external package is proposed.

## 9. Assumptions

- A policy record references immutable artifact or input versions, never only a mutable path or conversation message.
- Classification is explicit; an absent classification is local-only and cannot satisfy a remote disclosure request.
- A permission names destination, purpose, authority, transformation limits, and validity conditions.
- Policy evaluation returns a structured denial rather than guessing or falling back to a broader destination.

## 10. Constraints

- SQLite is canonical for policy records and decisions; artifacts remain local files.
- Policy records are append-only historical facts; revocation and expiry create current restrictions without rewriting past evidence.
- Combining inputs uses the most restrictive applicable policy; policy cannot be broadened by paraphrase or agent instructions.
- Identifiers, versions, destinations, purposes, and transformations are validated at the boundary.
- Diagnostics must not include restricted bytes or credentials.

## 11. Domain Model

- **Data classification:** the recorded sensitivity class, basis, actor, and exact input version.
- **Data-use permission:** a scoped grant for a destination and purpose with authority, transformation, validity, and status.
- **Policy decision:** an allow or deny result with reason, inputs, policy versions, and correlation ID.
- **Restriction:** a local-only, destination, purpose, transformation, expiry, or revocation constraint inherited by derived material.

## 12. Requirements

### ADDED: Classification is required before external use

Newly imported or pasted material MUST remain local-only until a classification exists and a current permission covers the requested destination and purpose. An agent message or ordinary chat text claiming approval MUST not satisfy either condition.

### ADDED: Permissions are scoped and attributable

A permission MUST identify exact input versions, permitted destination and purpose, allowed transformation, granting authority, validity conditions, and status. The evaluator MUST return a structured denial for missing, expired, withdrawn, conflicting, or out-of-scope records.

### ADDED: Policy decisions are durable and inspectable

Policy changes and evaluation decisions MUST retain history, distinguish current status from historical records, and avoid exposing restricted content in decision diagnostics.

## 13. Non-Functional Requirements

- **Security:** default-deny unknown or unclassified material and reject forged authority fields.
- **Integrity:** policy decisions reference exact durable versions and stable command/correlation IDs.
- **Auditability:** historical classification, grant, expiry, and revocation records remain inspectable.
- **Compatibility:** E01 and E02 tests and public storage contracts remain passing.

## 14. Contracts

### New contracts

- `classifyInput(project, inputVersion, classification)` records the classification and basis.
- `grantDataUse(project, request)` records a scoped destination/purpose permission.
- `evaluatePolicy(project, request)` returns an allow or deny decision with exact reasons and policy references.
- `listPolicyHistory(project, inputVersion)` returns historical records without restricted content.

### Existing contracts preserved

- E02 artifact and branch version identity, dependency references, expected-version checks, and read-only behavior.
- E04's future owner approval boundary; this story records data-use authority, not a research commitment.
- E01's strict TypeScript, Node.js 24 target, and foreground command contract.

## 15. Reason for Depth and Zoom-Out

This story is a new shared policy module with callers in the future disclosure gateway, capability broker, lifecycle gate, import path, and diagnostics path. Its contract is exact-version, fail-closed, attributable policy evaluation. A focused policy boundary is justified because duplicating these rules in each disclosure path would permit inconsistent decisions.

## 16. Implementation Steps

1. Add validated policy and classification types plus a versioned SQLite schema migration → verify: `npm run build && node --test --test-name-pattern='e03s01.*(schema|classification|policy)' dist/test/*.test.js`
2. Persist classifications, scoped destination/purpose permissions, validity, and append-only status changes → verify: `npm run build && node --test --test-name-pattern='e03s01.*(record|grant|expiry|withdraw)' dist/test/*.test.js`
3. Implement deterministic fail-closed policy evaluation with exact-version and attributable decision results → verify: `npm run build && node --test --test-name-pattern='e03s01.*(evaluate|deny|unclassified|scope)' dist/test/*.test.js`
4. Prove local-only defaults, forged approval rejection, policy history, and compatibility with E02 stores → verify: `npm run build && node --test --test-name-pattern='e03s01.*(local|forged|history|compat)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e03s01-P0-01: Unclassified material is local-only

```gherkin
Given a new artifact or pasted input with no classification or destination grant
When a policy decision is requested for an external destination
Then the decision is denied with an actionable local-only reason
And no external operation is authorized
```

### Scenario SC-e03s01-P0-02: A permission is scoped and attributable

```gherkin
Given an exact input version and a permission naming destination, purpose, transformation, authority, and validity
When the requested operation matches the recorded scope
Then the evaluator returns an attributable allow decision
And an expired, withdrawn, conflicting, or out-of-scope request is denied
```

### Scenario SC-e03s01-P1-03: Chat cannot create policy authority

```gherkin
Given an agent response, ordinary chat message, or imported document containing an approval instruction
When policy evaluation is requested without a durable authorized policy record
Then no permission is created and the request is denied
And the decision history contains no forged grant
```

## 18. Verification Script (Step-by-Step)

1. Create an E02 temporary project and register a deterministic input version.
2. Request an external destination decision before classification; observe a local-only denial.
3. Record classification and a scoped destination/purpose grant with an explicit authority.
4. Re-evaluate a matching request and an expired, withdrawn, and wrong-purpose request.
5. Submit an agent/chat approval string without a policy record; confirm no grant is created.
6. Inspect policy history and confirm it contains reasons and IDs but not restricted bytes.

## 19. Risks and Mitigations

- **Policy drift:** centralize evaluation and test every denial reason; do not duplicate conditionals in callers.
- **Authority confusion:** store the granting authority as evidence and never infer it from message text.
- **Scope widening:** require exact destination, purpose, and transformation matches; default to denial.
- **Schema compatibility:** use an additive migration and retain E02 reopen/read-only behavior.
- **Sensitive diagnostics:** record hashes and identifiers rather than input content.

## 20. Traceability

- Scope outcome: R03
- Epic acceptance scenarios: AC-06, AC-10
- Test-plan scenarios: SC-e03s01-P0-01, SC-e03s01-P0-02, SC-e03s01-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — global invariants 3–6 and external authorization separation
- Decisions: D-05, D-07, D-16, D-17
