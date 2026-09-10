# e03s03 — Trusted Capabilities and Pi Boundary

## 1. Identity

- **Story ID:** e03s03
- **Epic:** e03 — Enforced data-use and capability controls
- **Type:** feat
- **Risk:** P0
- **Context:** infra
- **BCPs:** 7
- **Status:** in_progress
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want agents and imported instructions to receive only explicit capabilities so that conversation text cannot approve research, read another project, access credentials, or write canonical state.

## 3. Context

E03s01 and e03s02 define policy and disclosure decisions. This story protects the authority boundary around those decisions and E02 storage. It adapts the reused Pi runtime through a curated boundary rather than assuming a prompt, role label, or removed tool name is a security control.

## 4. Problem

A capable extension, built-in command, document renderer, or imported instruction can bypass prompt-level restrictions if it receives unrestricted host APIs or project paths. User-selected local command modes and the per-project bash guard also need an explicit, inspectable contract.

## 5. Goal

Expose narrow capability objects and a curated Pi integration boundary that deny owner authority, credentials, direct canonical writes, cross-project reads, script execution, and disallowed local commands while preserving explicit `ask`, `approve`, and `full-access` behavior.

## 6. Non-Goals

- Creating classifications or data-use permissions; e03s01 owns those records.
- Routing every disclosure representation; e03s02 owns the gateway.
- Lifecycle revocation and acceptance fences; e03s04 owns current-policy checkpoints.
- Human commitment approval implementation; e04 owns the trusted owner action.
- A general sandbox, hosted account system, or replacement terminal UI.

## 7. Stakeholders

- Project owners who choose local execution authority.
- Agents, specialist tools, curated Pi extensions, and document viewers.
- E02 project storage whose canonical writes need protection.
- Security reviewers testing prompt injection and project isolation.

## 8. Dependencies

- e03s01 policy decisions and e03s02 disclosure gateway.
- E02 `ProjectHandle` write/read boundaries and public exports.
- E01 preflight execution-mode and per-project bash guard configuration.
- `specs/docs/03-agents-and-skills.md` role boundaries and `specs/docs/05-decisions-and-acceptance.md` AC-06/AC-09/AC-18.
- `specs/tech-architecture/e03-TEST_PLAN_LATEST.md`, scenarios SC-e03s03-P0-01 through SC-e03s03-P1-03.
- Existing Pi SDK package and Node.js 24 runtime; no new external package is proposed.

## 9. Assumptions

- Capability objects are created by trusted application code and cannot be forged by an agent-supplied actor field.
- Owner actions are separate from agent and worker capabilities; an agent can propose but cannot invoke owner authority.
- A bash guard is a configurable command policy, not a sandbox or guarantee against a malicious local machine owner.
- Document rendering consumes inert content and cannot execute scripts or macros.

## 10. Constraints

- Generic tools cannot access credentials, arbitrary project roots, canonical SQLite writes, or owner-only operations.
- Curated loading permits only declared resources and tools; imported instructions are data.
- `ask` may request confirmation, `approve` may run an allowed approved operation, and `full-access` explicitly reports local risk; none changes research policy authority.
- Denials identify the capability and remediation without exposing secrets or restricted bytes.
- Capability checks must be testable at the actual boundary, not only through prompt wording.

## 11. Domain Model

- **Capability:** a trusted object naming permitted operations and scope; absence means denial.
- **Owner capability:** a local-only authority that is not serializable or available to agents.
- **Worker capability:** least-privilege query, candidate-output, or broker request access.
- **Execution mode:** `ask`, `approve`, or `full-access` local command authority with explicit notices.
- **Bash guard:** per-project allow, deny, or require-approval command rule.

## 12. Requirements

### ADDED: Agent authority is least privilege

Agents and imported instructions MUST NOT acquire owner approval, credentials, arbitrary project reads, direct canonical writes, or unrestricted disclosure capability through message content, role labels, generic tools, or built-in Pi commands.

### ADDED: Curated Pi resources are protected

The curated Pi loader and document renderer MUST expose only declared resources and inert content. Loading a skill or rendering an imported document MUST NOT execute scripts/macros or create a path to another project or a credential store.

### ADDED: Local execution mode is explicit

Local commands MUST obey the selected `ask`, `approve`, or `full-access` mode and the per-project bash guard. Missing authority or a denied command MUST return a structured result; full-access MUST be labeled as a local-risk choice and MUST NOT claim sandbox containment.

## 13. Non-Functional Requirements

- **Security:** enforce capability absence and scope in application code at every protected operation.
- **Isolation:** canonical project paths and credentials are unavailable outside declared capabilities.
- **Auditability:** capability decisions identify operation, scope, mode, and outcome without secret values.
- **Compatibility:** retain E01 mode configuration and E02 storage behavior.

## 14. Contracts

### New contracts

- `createWorkerCapabilities(scope)` returns only scoped non-owner capabilities.
- `ownerAction(capability, request)` is callable only from the trusted local owner boundary.
- `loadCuratedResource(capability, resource)` validates an allowlisted resource and returns inert content.
- `executeLocalCommand(mode, guard, command, inputs)` returns allowed, approval-required, or denied without changing policy authority.
- `capabilityDecision(operation)` returns a redacted reason and no credential or restricted payload.

### Existing contracts preserved

- E02 project handle read-only/writable checks, exact history, and transaction behavior.
- E01 preflight modes, bash guard configuration, Node.js 24 target, and strict TypeScript.
- e03s01 policy evaluator and e03s02 disclosure gateway; capability checks cannot grant data-use permission.

## 15. Reason for Depth and Zoom-Out

This story modifies shared E02 storage entry points and the E01 execution-mode boundary. Callers include owner commands, agent tools, curated Pi resources, document rendering, local command execution, and integration tests. Their contracts require trusted capability construction, project isolation, and explicit mode/guard outcomes. A narrow capability adapter is justified; a generic plugin or role framework would add depth without improving enforcement.

## 16. Implementation Steps

1. Define non-serializable owner/worker capability types and protected operation scopes over E02 project handles → verify: `npm run build && node --test --test-name-pattern='e03s03.*(capability|owner|worker|scope)' dist/test/*.test.js`
2. Add protected read/write and credential boundaries that reject forged agent roles, cross-project paths, and direct canonical mutation → verify: `npm run build && node --test --test-name-pattern='e03s03.*(forge|credential|canonical|project|write)' dist/test/*.test.js`
3. Implement curated Pi resource loading and inert document rendering with built-in command and script/macro denial → verify: `npm run build && node --test --test-name-pattern='e03s03.*(curated|builtin|render|script|macro|injection)' dist/test/*.test.js`
4. Integrate ask/approve/full-access mode and per-project bash guard results with explicit local-risk diagnostics → verify: `npm run build && node --test --test-name-pattern='e03s03.*(ask|approve|full.access|bash|guard|mode)' dist/test/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e03s03-P0-01: Untrusted content cannot gain authority

```gherkin
Given an agent response or imported instruction requests approval, credentials, or a canonical write
When the request reaches the capability boundary
Then it is denied because no owner capability is present
And the canonical project state and credential store remain unchanged
```

### Scenario SC-e03s03-P0-02: Pi and document paths remain curated

```gherkin
Given a loaded document contains instructions to read another project or execute a script
When a curated resource or renderer processes it
Then the content is treated as inert data
And no cross-project read, script execution, or protected command occurs
```

### Scenario SC-e03s03-P1-03: Local execution mode and bash guard are visible

```gherkin
Given a command is requested under ask, approve, or full-access mode and a project bash guard
When the command is evaluated
Then the result is allow, approval-required, or deny with the applicable mode and guard reason
And full-access is labeled as an explicit local-risk choice rather than a sandbox guarantee
```

## 18. Verification Script (Step-by-Step)

1. Construct an agent capability and attempt owner approval, credential access, direct database write, and another project read.
2. Feed a synthetic malicious instruction to the curated loader and inert renderer.
3. Confirm each operation is denied and no storage, credential, or shell side effect occurs.
4. Evaluate representative commands under all three modes and allow, deny, and approval-required guard rules.
5. Confirm full-access displays the local-risk notice and does not alter research policy authority.

## 19. Risks and Mitigations

- **Prompt-only enforcement:** test actual capability objects and protected callers; message refusal is not evidence.
- **Host API leakage:** keep curated adapters narrow and test resource/credential path isolation.
- **Mode confusion:** make mode part of the structured command result and preserve E01 notices.
- **Sandbox overclaim:** document and test that full-access is explicit local risk, not containment.
- **Storage regression:** run all E02 tests after protecting existing project handles.

## 20. Traceability

- Scope outcome: R03
- Epic acceptance scenarios: AC-06, AC-09, AC-18
- Test-plan scenarios: SC-e03s03-P0-01, SC-e03s03-P0-02, SC-e03s03-P1-03
- Domain contracts: `specs/tech-architecture/tech-stack.md` — human authority, execution modes, and global invariants 1, 5, 9
- Decisions: D-05, D-07, D-16, D-17
