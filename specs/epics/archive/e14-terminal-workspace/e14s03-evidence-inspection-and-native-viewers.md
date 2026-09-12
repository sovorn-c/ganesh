# e14s03 — Evidence Inspection, Native Viewers and Offline Inspection

## 1. Identity

- **Story ID:** e14s03
- **Epic:** e14 — Accessible terminal research workspace
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a project owner, I want to inspect located evidence in the Pi workspace and open a native local viewer from a checked path so that I can review originals offline without a Ganesh web application.

## 3. Context

e14s01 provides the session. E06 already returns inspection records and `authorizeSourceHandoff` with a local `path` only after integrity, access, capability and disclosure checks. This slice presents those records and invokes an injected `LocalViewerPort` on allow.

E06 tests already forbid launching a process. E14 is the first allowed invocation, and only behind the port.

## 4. Problem

Rendering extracted text as if it were full-text verification, opening a viewer on a denied path, or requiring a live provider to inspect saved sources would break AC-05/AC-10 boundaries that E06 already enforces and the R14 offline-inspection outcome.

## 5. Goal

Present E06 inspection (access, extraction, integrity, locators, limitations) in the workspace, launch a native viewer only with an allowed project-contained path, and keep inspection available with network and provider ports disabled.

## 6. Non-Goals

- Launch/intake; e14s01 owns these.
- Exact-version confirmation; e14s02 owns these.
- Access-path matrix and live work status; e14s04 owns these.
- Scholarly evidence appraisal, quotation verification, OCR, PDF rendering inside Ganesh, or a web viewer.
- Changing E06 locator or disclosure semantics.

## 7. Stakeholders

- Owners inspecting sources and originals.
- E06 source-access and E03 disclosure gateway.
- E15 later export must not treat viewer temp files as canonical state.
- Desktop environment that owns Preview or the user-selected viewer.

## 8. Dependencies

- e14s01 session and owner capability.
- E06 `inspectSource` and `authorizeSourceHandoff`.
- E03 current-policy disclosure for non-local destinations.
- `specs/tech-architecture/e14-TEST_PLAN_LATEST.md` SC-e14s03-P0-01 through SC-e14s03-P1-04.

## 9. Assumptions

- Production `LocalViewerPort` uses `open` on darwin and `xdg-open` elsewhere, passing the checked path as a single argument with `shell: false`. Tests never bind that adapter.
- Destination `local` is the only auto-launched viewer path. Remote destinations remain E03 disclosure decisions and do not spawn a viewer.
- Offline means intercepting fetch/HTTP/sockets/provider ports; SQLite and artifact files remain readable.

## 10. Constraints

- Viewer spawn MAY occur only after `authorizeSourceHandoff` returns `status: "allow"` and a `path` contained in the project artifact root.
- Denied, unverified, metadata-only, unclassified-remote, symlink and missing-path results MUST NOT spawn and MUST NOT return a usable path to the TUI.
- Inspection MUST show E06 limitations rather than fabricating quotations, page locators or full-text claims.
- Diagnostics and errors MUST NOT embed source excerpts, credentials or unrestricted absolute home paths.
- No new parser or viewer npm package.

## 11. Domain Model

- **Inspection view:** source version id, access, extraction status, integrity, locators, limitations, optional located text when E06 allows.
- **Viewer request:** source version id, optional locator, owner capability, destination `local`.
- **Viewer result:** `launched`, `denied`, or `unavailable`, plus bounded reason.

## 12. Requirements

### ADDED: Workspace evidence inspection

The workspace MUST present E06 inspection records including limitations. Unavailable full text MUST be labeled as such. Inspection MUST NOT invent quotations or locators.

### ADDED: Native local viewer launch

`openLocalViewer` MUST call `authorizeSourceHandoff` for destination `local` and MUST invoke `LocalViewerPort` only with the allowed path.

### ADDED: Offline inspection

Inspection and denied viewer requests MUST complete with provider and network ports disabled. Failure to reach a provider MUST NOT fall back to remote disclosure.

## 13. Non-Functional Requirements

- **Security:** spawn is argument-vector only; no shell interpolation.
- **Privacy:** unclassified sources cannot be sent to a remote destination by this command.
- **Integrity:** viewer path is the E02 artifact path already checked by E06.
- **Compatibility:** E06 handoff tests remain passing.

## 14. Contracts

### New contracts

- `presentInspection(session, request): InspectionView` wraps `inspectSource`.
- `openLocalViewer(session, request): ViewerResult` wraps handoff plus `LocalViewerPort.launch(path)`.
- `LocalViewerPort.launch(path): Promise<void> | void` is injectable.

### Existing contracts preserved

- `inspectSource` / `authorizeSourceHandoff` remain authoritative.
- E06 still does not launch processes.

## 15. Reason for Depth and Zoom-Out

A dedicated viewer adapter exists so tests can intercept spawn without stubbing Node globally in every file. Reason for depth: process launch is a trust boundary distinct from inspection presentation.

`src/sources/source-access.ts` purpose is capability-gated inspection and handoff; callers are E06 tests and this workspace; contracts are deny-by-default and local path only after allow.

## 16. Implementation Steps

1. Present E06 inspection with locators and limitations and no fabricated content → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s03.*(inspect|locator|limitation)' dist/tests/*/*.test.js`
2. Launch native viewers only through LocalViewerPort after allowed local handoff → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s03.*(viewer|handoff|launch)' dist/tests/*/*.test.js`
3. Deny integrity, capability, unclassified-remote, escape and missing-path launches with no usable path → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e14s03.*(deny|integrity|unclassified|disclose|escape)' dist/tests/*/*.test.js`
4. Prove offline inspection, spawn/network intercepts, no new security findings in affected paths, and all released E01-E06 behavior remains passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e14s03.*(offline|network|spawn|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e14s03-P0-01: Inspection is honest

```gherkin
Given an acquired source version with locators and an extraction limitation
When the owner inspects it in the workspace
Then access, extraction, integrity, locators and limitations are visible
And no unavailable quotation or page text is invented
```

### Scenario SC-e14s03-P0-02: Viewer requires allowed path

```gherkin
Given a full-text source that passes local handoff
When the owner requests a native viewer
Then LocalViewerPort.launch is called with the checked project-contained path
And no other path is spawned
```

### Scenario SC-e14s03-P0-03: Denied paths never launch

```gherkin
Given denied capability, failed integrity, unclassified remote destination, symlink/escape or missing bytes
When a viewer is requested
Then the result is denied
And LocalViewerPort is not called
```

### Scenario SC-e14s03-P1-04: Offline inspection

```gherkin
Given saved source records and disabled network and provider ports
When inspection and a denied viewer request run
Then inspection returns local records
And no fetch or remote disclosure occurs
```

## 18. Verification Script (Step-by-Step)

1. Import a tiny text fixture; inspect; assert locators and no extra quotes.
2. Allow local handoff; assert viewer port received the artifact path.
3. Repeat with withdrawn grant and a metadata-only source; assert no launch.
4. Disable network; inspect again.
5. Run E01-E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Shell injection:** `shell: false`, single path argument.
- **TOCTOU on path:** use the path E06 already authorized; do not re-resolve user-supplied strings.
- **False verification:** surface E06 limitations verbatim.

## 20. Traceability

- Scope outcome: R14
- Epic acceptance scenarios: AC-01, AC-02 (offline/late inspection of existing sources)
- Test scenarios: SC-e14s03-P0-01, SC-e14s03-P0-02, SC-e14s03-P0-03, SC-e14s03-P1-04
- Domain contracts: tech-stack invariants 2, 4, 5, 7
- Architecture: native viewers, no Ganesh web application
- Prior E06 contract: `authorizeSourceHandoff` returns `path` only for local allow
