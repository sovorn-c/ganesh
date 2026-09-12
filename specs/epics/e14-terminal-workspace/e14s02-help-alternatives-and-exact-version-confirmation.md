# e14s02 — Contextual Help, Alternatives and Exact-Version Confirmation

## 1. Identity

- **Story ID:** e14s02
- **Epic:** e14 — Accessible terminal research workspace
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want contextual help, inspectable research alternatives and an exact-version confirmation in the Pi workspace so that only a displayed local owner action can create a human commitment.

## 3. Context

e14s01 binds a project session. E04 already implements `recordOwnerDecision`, stale rejection, `compareBranchReferences` and `listAlternativeImpact`. This slice presents those records in the reused Pi UI through curated extension commands and `ctx.ui.confirm` / `ctx.ui.custom`, without a second approval channel.

Installed Pi `docs/extensions.md` documents `pi.registerCommand`, `ctx.ui.confirm` and `ctx.ui.custom` for keyboard-capable custom components. Built-in interactive commands such as `/model` are not returned by `pi.getCommands()` and must not become owner-approval paths.

## 4. Problem

Chat text saying "approved", imported supervisor feedback, forged `{ role: "owner" }` objects, or an unbound Pi command would mint a commitment and break AC-06. A stale displayed packet that still commits would break AC-07.

## 5. Goal

Register curated workspace commands that show contextual help and alternatives without mutation, and an owner confirmation that displays packet id, packet version and option versions before calling `recordOwnerDecision` with the in-process `OwnerCapability`.

## 6. Non-Goals

- Launch/intake; e14s01 owns these.
- Evidence viewers and offline inspection; e14s03 owns these.
- Live run/budget/cancel chrome and the supported access-path matrix; e14s04 owns these.
- New decision, override, or branch-adoption APIs; E04 already owns those mutations.
- Academic-supervisor authentication.

## 7. Stakeholders

- Owners confirming exact versions locally.
- E04 decision/commitment stores that remain the only commitment writers.
- E03 capability broker: workers and serialized roles stay denied.
- Later E07-E13 surfaces that will reuse the same confirmation command.

## 8. Dependencies

- e14s01 workspace session and in-process owner capability.
- E04 `getDecisionPacket`, `recordOwnerDecision`, alternative comparison/impact listing.
- E03 `isOwnerCapability` / `ownerAction` denial of forged objects.
- `specs/tech-architecture/e14-TEST_PLAN_LATEST.md` SC-e14s02-P0-01 through SC-e14s02-P1-04.

## 9. Assumptions

- Confirmation uses `ctx.ui.confirm` or `ctx.ui.custom` with an injected `TuiPort.confirm` in tests. Tests never open a real TTY dialog.
- Viewing alternatives does not call `adoptBranchAlternative`.
- Reported prior commitments in imported text stay attributed feedback, not Ganesh commitments (AC-02).
- Keyboard focus order for the confirm control is specified here; the full critical-flow map is completed in e14s04.

## 10. Constraints

- The confirmation payload MUST equal the displayed packet id, packet version, selected candidate version ids and dependency version ids.
- Chat, prompt text, imported documents and tool arguments MUST NOT call `recordOwnerDecision`.
- Worker capabilities and JSON-parsed role objects MUST be rejected before any disposition write.
- Unbound or built-in Pi commands MUST NOT be registered as owner-approval handlers.
- Stale `packetVersion` or changed dependencies MUST return the existing E04 stale/rejected result and present a refreshed packet.
- Identical command-id retry MUST not duplicate the decision.

## 11. Domain Model

- **Steering view:** help topics for current session actions, current alternatives/impact summaries, open packets.
- **Confirmation request:** packet id, packet version, selected option versions, dependency versions, command id, owner capability.
- **Confirmation result:** committed, rejected, stale, or denied, plus displayed text.

## 12. Requirements

### ADDED: Contextual help and inspectable alternatives

The workspace MUST expose a help command listing current steering actions and MUST present research-branch alternatives and impact summaries from E04 without adopting a branch or recording a disposition.

### ADDED: Exact-version owner confirmation

An explicit local confirmation MUST display packet id, packet version and selected option versions, then call `recordOwnerDecision` with the session `OwnerCapability`. No other workspace path MAY create a human commitment.

### ADDED: Forged and stale confirmation fail closed

Chat "approved" text, imported documents, forged roles, worker capabilities and unbound Pi commands MUST leave `listCommitments` unchanged. A stale displayed packet MUST be rejected and replaced by a refreshed packet.

## 13. Non-Functional Requirements

- **Security:** owner confirmation is a trusted local interaction; prompts are not enforcement.
- **Integrity:** displayed versions are the versions sent to E04.
- **Accessibility:** confirm/cancel controls have text labels and a keyboard activate action.
- **Compatibility:** E04 packet semantics stay unchanged.

## 14. Contracts

### New contracts

- `presentHelp(session): HelpView` returns current action help.
- `presentAlternatives(session, branchId?): AlternativeView` reads E04 comparison/impact.
- `confirmExactVersion(session, request): ConfirmationResult` displays versions and calls `recordOwnerDecision` only after `TuiPort.confirm` returns true.
- `registerWorkspaceCommands(pi, session)` registers `/ganesh-help`, `/ganesh-alternatives`, `/ganesh-confirm` or equivalent curated names.

### Existing contracts preserved

- `recordOwnerDecision` remains the only commitment writer.
- `adoptBranchAlternative` is not invoked by viewing alternatives.

## 15. Reason for Depth and Zoom-Out

Separate steering presenters from the Pi extension registrar so tests can confirm packets without `InteractiveMode`. The extension file exists only to bind `registerCommand` onto presenters. Reason for depth: Pi's command API is a UI adapter, not a domain store.

`src/decisions/decision-store.ts` purpose is packet/disposition persistence; callers are decision tests and this confirmation presenter; contracts are exact-version, stale, and idempotent command ids.

## 16. Implementation Steps

1. Add help and alternative presenters that read E04 records without mutation → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s02.*(help|alternative|inspect)' dist/tests/*/*.test.js`
2. Add exact-version confirmation that displays packet/option versions and calls recordOwnerDecision only after trusted TuiPort.confirm → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s02.*(confirm|packet|version|commit)' dist/tests/*/*.test.js`
3. Deny chat, forged, worker and unbound Pi-command confirmation paths, and refresh stale packets without duplicating decisions → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s02.*(forg|chat|stale|bypass)' dist/tests/*/*.test.js`
4. Prove no new security findings in affected paths and all released E01-E06 behavior remains passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e14s02.*(regression|security)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e14s02-P0-01: Displayed versions are the committed versions

```gherkin
Given an open decision packet and an in-process owner session
When the owner confirms the displayed packet id, packet version and option versions
Then recordOwnerDecision is called with those exact ids
And a human commitment exists only for that packet version
```

### Scenario SC-e14s02-P0-02: Chat and forged approval cannot commit

```gherkin
Given chat text, an imported document saying approved, a forged role object, a worker capability or an unbound built-in Pi command
When those paths attempt to confirm
Then listCommitments remains empty
And no decision record is written
```

### Scenario SC-e14s02-P0-03: Stale packets refresh

```gherkin
Given a displayed checkpoint whose referenced artifact version then changes
When confirmation is attempted
Then the result is stale or rejected
And a refreshed packet is presented
And an identical command-id retry does not duplicate a commitment
```

### Scenario SC-e14s02-P1-04: Help and alternatives are read-only

```gherkin
Given two research branches with distinct candidates
When the owner inspects help and alternatives
Then comparison and impact text are visible
And no branch is adopted and no disposition is recorded
```

## 18. Verification Script (Step-by-Step)

1. Seed a packet with two option versions; confirm through TuiPort; assert commitment ids.
2. Send chat "approved" and a forged owner object; assert no commitment.
3. Change a dependency and retry the old packet version; assert stale plus refresh.
4. List alternatives; assert E04 adoption APIs were not called.
5. Run E01-E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Parallel approval channel:** only `confirmExactVersion` may call `recordOwnerDecision`; grep tests for other workspace callers.
- **Built-in Pi commands:** deny-list / unbind commands that write files or look like approval; assert they are not registered as confirm handlers.
- **Displayed versus sent versions:** build the E04 request from the same view model the TUI rendered.

## 20. Traceability

- Scope outcome: R14
- Epic acceptance scenarios: AC-06, AC-07
- Test scenarios: SC-e14s02-P0-01, SC-e14s02-P0-02, SC-e14s02-P0-03, SC-e14s02-P1-04
- Domain contracts: tech-stack human authority, decision-packet transitions
- Architecture: `specs/docs/04-system-architecture.md` trusted approval capability
- Pi API: `docs/extensions.md` `pi.registerCommand`, `ctx.ui.confirm`, `ctx.ui.custom`
