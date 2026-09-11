# e06s04 — Reviewable Source Matching and Permission-Gated Inspection

## 1. Identity

- **Story ID:** e06s04
- **Epic:** e06 — Local import and source inspection
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 4
- **Status:** planned
- **Requirement delta:** ADDED + MODIFIED

## 2. User Story

As a researcher, I want possible duplicate and related sources to remain reviewable and source inspection to honor current permissions so that a preprint is not silently merged with a publication and denied material cannot leak through viewer or downstream handoff.

## 3. Context

E06s01-s03 provide immutable originals, source metadata, access/extraction status and format locators. E03 provides current capability and disclosure controls. This final slice exposes conservative matching proposals and one permission-gated inspection/handoff boundary without launching UI or remote work.

## 4. Problem

A DOI or fuzzy title match can indicate identity, an acquisition duplicate or a related scholarly version; automatic merge can erase corrections and provenance. A local disclosure allowance alone also does not prove that a caller belongs to the project, can inspect the source, or that bytes are intact. Returning raw paths before these checks would bypass E03.

## 5. Goal

Propose exact/related/possible source relationships with explicit bases and no automatic merge; inspect source access/integrity/extraction honestly; and return a local viewer descriptor or downstream decision only after current project, operation, path, artifact and disclosure checks pass.

## 6. Non-Goals

- Automatic source merge, fuzzy truth adjudication, retraction-provider lookup or scholarly support assessment.
- Native viewer launch, terminal rendering or a separate web viewer; E14 owns presentation/invocation.
- Remote provider execution; E05/E08/E11 own bounded work/retrieval/analysis.
- Export, sanitized packets, deletion propagation, backup or restore; E15/later responsibilities own them.

## 7. Stakeholders

- Researchers resolving duplicate and version relationships.
- E07/E08 consumers that need distinct source versions and honest access.
- E03 policy/authority owners whose current decisions must apply at handoff.
- E14 viewer UI and E11 analysis callers consuming checked descriptors/decisions.

## 8. Dependencies

- e06s01-s03 complete source records, originals, extraction statuses, locators and parser diagnostics.
- E02 artifact inspection/dependencies and E03 capability/current disclosure policy.
- `specs/IMPACT_LATEST.md` and `specs/tech-architecture/e06-TEST_PLAN_LATEST.md` scenarios SC-e06s04-P0-01 through SC-e06s04-P0-05.
- Node.js 24 standard library and existing project dependencies only; this story adds no package.

## 9. Assumptions

- Equal content hashes or normalized trusted identifiers are deterministic match evidence but do not authorize deleting or merging either acquired version.
- Preprint/published, conference/journal, correction and retraction relationships require an explicit recorded basis and remain reviewable.
- Fuzzy title/author/year comparison only proposes `possible-match`; it never changes identity, access or current references.
- E06 returns a viewer descriptor containing a checked exact artifact version/path/media type; E14 decides how to present or launch it.
- Local viewer descriptors use the additive disclosure operation `inspection` with destination `local`; downstream callers must supply the actual existing operation (`attachment`, `snippet`, `analysis`, `export`, etc.), destination and purpose. There is no generic `handoff` operation.

## 10. Constraints

- Matching order is deterministic: exact content hash/trusted identifier, explicit related-version basis, bounded fuzzy proposal, otherwise distinct.
- DOI canonicalization algorithm `doi-v1` trims whitespace, strips a case-insensitive `doi:` or `https?://(dx.)?doi.org/` prefix, percent-decodes valid escapes, applies Unicode NFC and lowercase, and accepts only a `10.` registrant plus `/` suffix with no control/whitespace; invalid values remain raw and do not exact-match.
- Fuzzy algorithm `title-author-year-v1` applies Unicode NFKC/lowercase, removes punctuation and collapses whitespace, then proposes only when title token-set Jaccard is at least 0.90, publication years differ by at most one, and at least one normalized author family name overlaps. Persist algorithm version, component scores and compared raw-field locators.
- Cap the same-project scan with explicit `maxCandidates`; sort relation rank, descending score and then source IDs for stable ties. An O(n) scan is the deliberate local-project ceiling; add an index only after measured project-scale need.
- Persist proposals and accepted relationship labels without mutating either source record or artifact bytes.
- Inspection checks exact artifact integrity/status before returning located content; metadata-only/abstract-only/unavailable/unsupported sources cannot return full-text quotations or page claims.
- Owner capability must match project owner; worker capability must match project ID, permit `source:inspect`/`source:handoff`, and authorize the real artifact path.
- Remote/downstream handoff always calls `requestDisclosure` with exact source versions, operation, destination and purpose. Denial returns no content/path and never triggers another provider.
- Local viewer handoff also checks capability, integrity and access; the existing local policy allowance is necessary but not sufficient.

## 11. Domain Model

- **Source match proposal:** two exact acquired source versions, relation category, deterministic/fuzzy basis, review status and actor/time if accepted.
- **Source relationship:** recorded exact-duplicate or related-version link that preserves both versions.
- **Source inspection:** safe metadata, access, integrity, extraction status/diagnostics and only permitted located content.
- **Viewer descriptor:** checked local artifact version, media type and path/reference for E14; not a launched process.
- **Source handoff decision:** allow/deny result tied to capability, exact versions, operation, destination, purpose and E03 disclosure decision.

## 12. Requirements

### MODIFIED: Disclosure operation vocabulary

**Before:** the closed E03 `DisclosureOperationKind` union had prompt, attachment, summary, compaction, snippet, embedding, telemetry, export, diagnostic and analysis; it had no precise local source-inspection operation.

**After:** add `inspection` as the operation for a local/native-viewer descriptor. Downstream handoff uses the caller's actual existing operation rather than a generic handoff value, and all operations continue through `requestDisclosure`.

### ADDED: Conservative source matching

The system MUST use versioned `doi-v1` and `title-author-year-v1` algorithms and classify equal-byte/identifier, explicit related-version and bounded fuzzy candidates with visible component bases. It MUST order ties deterministically, keep every acquired source version separate and MUST NOT auto-merge, delete or broaden access.

### ADDED: Honest source inspection

Inspection MUST distinguish full-text, partial, metadata-only, abstract-only, unavailable, corrupt and unsupported extraction. It MUST NOT return full-text locations or quotations when access/extraction does not support them.

### ADDED: Permission-gated local viewer descriptor

A local viewer descriptor MUST be returned only after project/owner or worker capability, operation, segment-aware real path, exact artifact integrity and access checks pass. E06 MUST NOT launch the viewer.

### ADDED: Current-policy downstream handoff

Every non-local/downstream handoff MUST route through current E03 disclosure policy for exact versions, operation, destination and purpose. Missing classification/grant, mismatch, withdrawal or expiry MUST deny with no content/path and no remote fallback.

## 13. Non-Functional Requirements

- **Privacy:** no denied path, text or locator leaves the access boundary.
- **Integrity:** all inspection/handoff decisions bind exact artifact/source versions and current hashes/status.
- **Research integrity:** matching and metadata identity remain proposals/facts separate from scholarly verification.
- **Authority:** forged/wrong-project/missing-operation capabilities fail before path/content return.
- **Compatibility:** E03 disclosure history and operation semantics remain unchanged; E06 composes rather than duplicates policy.

## 14. Contracts

### New contracts

- `proposeSourceMatches(handle, sourceVersionId): readonly SourceMatchProposal[]` returns deterministic ordered proposals with bases.
- `recordSourceRelationship(handle, capability, request): SourceRelationship` records an explicit relationship while preserving both versions.
- `inspectSource(handle, capability, request): SourceInspection` returns only access-appropriate metadata/content/locators after integrity checks.
- `authorizeSourceHandoff(handle, capability, request): SourceHandoffDecision` uses `inspection` for a local viewer descriptor or a caller-supplied existing disclosure operation for downstream use, otherwise returning no path/content.

### Existing contracts preserved

- `inspectArtifactVersion` remains the source of content integrity/availability truth.
- `requestDisclosure` remains the authoritative current-policy decision and audit path; its operation union is additively extended by `inspection`, with all prior operation semantics unchanged.
- `readProjectPath`/worker capabilities retain source compatibility with stricter valid containment and E06 operation/project checks.
- No agent/source text can create owner capability, classification, grant, relationship acceptance or human commitment.

## 15. Reason for Depth and Zoom-Out

`src/sources/source-matching.ts` owns pure versioned DOI/title-author-year proposal logic and relationship persistence calls. `src/sources/source-access.ts` owns the cross-cutting capability→integrity→access→policy sequence. These two modules are justified because matching has no content-release authority while access handoff is a security boundary; combining them would obscure privilege flow. No generic broker or viewer abstraction is added.

Shared callers/contracts are fully mapped in `specs/IMPACT_LATEST.md`. `artifact-store.ts` is read for integrity, `capability-broker.ts` is composed for authority/path, `disclosure-gateway.ts` is called for current policy, `schema.ts` adds proposal/relationship tables, and `index.ts` exports only Ganesh types/functions.

Planned tests: `tests/sources/source-matching.test.ts`, `tests/sources/source-inspection.test.ts`, `tests/integration/source-access.test.ts`, and targeted regression additions to `tests/authority/capabilities.test.ts`.

## 16. Implementation Steps

1. Apply versioned DOI/title-author-year algorithms with bounded deterministic ordering and persist exact/related/possible proposals without merge → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s04.*(doi.v1|title.author.year.v1|threshold|tie|duplicate|related|preprint|correction|possible|distinct)' dist/tests/*/*.test.js`
2. Inspect access, integrity, extraction and permitted locations without converting metadata/unsupported extraction into verification → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s04.*(inspect|metadata.only|unavailable|integrity|quotation|locator)' dist/tests/*/*.test.js`
3. Gate local viewer/downstream handoff on capability, path, artifact and current disclosure with no launch/fallback → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s04.*(viewer|handoff|capability|disclosure|withdraw|deny|fallback)' dist/tests/*/*.test.js`
4. Exercise AC-05/10/20 adversarial integration and the complete Node 24 quality gate → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e06s04.*(AC.05|AC.10|AC.20|forg|wrong.project|corrupt|revok)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e06s04-P0-01: Matches never erase versions

```gherkin
Given equal bytes, canonical DOI variants, a preprint/publication/correction pair, a fuzzy title candidate and a distinct source
When source matches are proposed or an explicit relationship is recorded
Then each exact acquired version remains immutable and separate with a visible match basis
And no fuzzy or related candidate is silently merged
```

### Scenario SC-e06s04-P0-02: Access is distinct from verification

```gherkin
Given sources with full, partial, metadata-only, abstract-only, unavailable, corrupt and unsupported extraction states
When each source is inspected
Then the returned state and limitations are explicit
And metadata-only or unsupported sources yield no invented quotation, page locator or verification claim
```

### Scenario SC-e06s04-P0-03: Local viewer handoff is checked but not launched

```gherkin
Given an intact local source and an authorized project capability with source-inspect operation
When a viewer handoff is requested
Then Ganesh returns an exact integrity-checked descriptor for the permitted path
And E06 launches no process and exposes no path on denial
```

### Scenario SC-e06s04-P0-04: Downstream handoff obeys current policy

```gherkin
Given an exact source version and a requested operation, destination and purpose
When classification/grant is missing, mismatched, withdrawn or expired
Then the E03 disclosure decision denies and no content or path is returned
And a blocked local or remote operation does not trigger remote fallback
```

### Scenario SC-e06s04-P0-05: Forged and stale access cannot leak content

```gherkin
Given a forged or wrong-project capability, sibling-prefix/symlink path, missing operation, corrupt original or unavailable access
When inspection or handoff is requested
Then no path, source text or locator is returned
And the safe decision/diagnostic record identifies the denial without sensitive payloads
```

## 18. Verification Script (Step-by-Step)

1. Import synthetic same-byte, same-DOI, related-version, fuzzy and distinct source fixtures.
2. Inspect proposals/accepted relationships and prove every source version remains separate after reopen.
3. Inspect every access/extraction/integrity state and assert permitted fields/content only.
4. Request local viewer descriptors with valid and forged/cross-project/path-escape capabilities; assert no process launch.
5. Request downstream handoff before grant, after matching grant, and after withdrawal/expiry; assert disclosure history and no fallback.
6. Run all E01-E04 and E06 tests under Node.js 24.

## 19. Risks and Mitigations

- **Silent conflation:** persist proposals/relationships only; never merge or delete versions.
- **Fuzzy false positive:** versioned thresholded normalization returns `possible-match` with component scores/raw locators and no state mutation; bounded O(n) scan prevents unbounded work.
- **Local policy treated as sufficient:** capability, path, integrity and access checks run before descriptor return.
- **TOCTOU permission:** invoke current E03 policy at each downstream handoff; withdrawal/expiry applies immediately.
- **Path/content leak on denial:** denial type cannot carry descriptor or located content; diagnostics are bounded.
- **UI scope creep:** return a descriptor only; E14 owns terminal/native launch.

## 20. Traceability

- Scope outcome: R06
- Epic acceptance scenarios: AC-05, AC-10, AC-20
- Test scenarios: SC-e06s04-P0-01, SC-e06s04-P0-02, SC-e06s04-P0-03, SC-e06s04-P0-04, SC-e06s04-P0-05
- Domain contracts: source-version distinction, evidence accessibility, current policy and imported-material authority boundary
- Architecture: `specs/docs/04-system-architecture.md` §§3, 4, 9 and 10
