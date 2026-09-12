# e07s02 — Claim Records and Citation Verification

## 1. Identity

- **Story ID:** e07s02
- **Epic:** e07 — Located evidence and accountable claims
- **Type:** feat
- **Risk:** P0
- **Context:** domain/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want a claim linked to supporting and challenging evidence with an explicit citation-verification status so that bibliographic identity is never treated as substantive support and inaccessible full text cannot invent quotations or page findings.

## 3. Context

e07s01 records located evidence items. E06 already distinguishes metadata-only, abstract-only, unavailable and full-text access. AC-05 requires identity resolution to stay separate from verification when the full text is inaccessible and an abstract does not support the claim.

## 4. Problem

A DOI, title or abstract match is not support. Auto-filling missing bibliographic fields, quoting inaccessible pages, or letting a specialist candidate create a human commitment would convert identity resolution into false verification.

## 5. Goal

Record scoped claims, link them to supporting and challenging evidence items, and compute citation verification that distinguishes identity-resolved, access-limited, fields-missing, unsupported and substantively-supported states without inventing missing fields or quotations.

## 6. Non-Goals

- Evidence-item recording and statement kinds; e07s01 owns these.
- Matrix presentation, correction/retraction reassessment; e07s03 owns these.
- Method-appropriate appraisal and synthesis; e07s04 owns these.
- Literature retrieval, screening and contribution challenge; E08 owns these.
- Human commitments, decision packets and reasoned overrides; E04 owns those.
- TUI claim rendering or E14 presenter changes.

## 7. Stakeholders

- Researchers checking whether a citation actually supports a claim.
- Later matrix/synthesis consumers that need honest support status.
- E03 disclosure and E04 commitment boundaries that must not be confused with claim records.

## 8. Dependencies

- e07s01 evidence items, operations and additive E07 schema.
- E06 bibliographic records, access levels and `inspectSource`.
- E04 `recordOwnerDecision` / `listCommitments` as a non-writer boundary.
- `specs/tech-architecture/e07-TEST_PLAN_LATEST.md` SC-e07s02-P0-01 through SC-e07s02-P1-04.
- Node.js 24 standard library only; no citation-js, citeproc or NLP package.

## 9. Assumptions

- A claim is a scoped proposition with its own ID. It is not an artifact commitment and not an E04 scholarly finding.
- Support status is derived from linked evidence and citation verification. A bibliographic identifier alone cannot produce `substantively-supported`.
- Substantive support requires at least one supporting evidence item whose source access is full-text, extraction is complete, integrity is verified, and `readLocatedExcerpt` returned content. Abstract-only or metadata-only sources can at most reach `identity-resolved` or `access-limited`.
- Missing title, DOI, year or other bibliographic fields stay missing. Verification MUST NOT fill them from model output or related records unless that exact field exists on the cited source record.
- Chat text, imported “verified” strings and specialist-candidate success never call `recordOwnerDecision`.

## 10. Constraints

- `recordClaim` and `linkClaimEvidence` require owner identity or worker `claim:record` plus current `evidence:inspect`.
- Linking a supporting item from an inaccessible or metadata-only source MUST set verification `access-limited` or `unsupported`, never `substantively-supported`.
- `verifyCitation` against a real paper identity with inaccessible full text and an abstract that does not contain the claim MUST mark identity as resolved when identifiers exist, access as limited, support as unsupported, and MUST store no quotation or page locator.
- Same `commandId` retries resume; payload conflicts reject.
- Claim current support may be `unverified`, `identity-resolved`, `access-limited`, `fields-missing`, `unsupported`, `substantively-supported` or `contested` (both supporting and challenging links exist). e07s03 adds `needs-reassessment`.

## 11. Domain Model

- **Claim:** a scoped proposition with origin, current support status and qualifications.
- **Claim-evidence link:** supporting or challenging role plus per-link verification status.
- **Citation verification:** identity status, access status and support status for one cited source version.
- **Counterevidence:** a challenging link; it is retained rather than deleted when support is later recorded.

## 12. Requirements

### ADDED: Scoped claim records

`recordClaim` MUST persist statement text, scope, origin and command identity. It MUST NOT create a commitment, decision packet or scholarly-finding row.

### ADDED: Supporting and challenging links

`linkClaimEvidence` MUST reference an existing evidence item. A claim MAY have multiple supporting and multiple challenging links. Challenging links MUST remain visible when a supporting link is added.

### ADDED: Citation verification distinct from identity

`verifyCitation` MUST distinguish bibliographic identity resolution from substantive support. Identity resolution alone MUST NOT set `substantively-supported`.

### ADDED: AC-05 inaccessible and misleading citation

Given metadata for a real source, inaccessible full text, and a claim the abstract does not support, verification MUST mark access limits and unsupported status and MUST NOT invent quotations, page numbers or full-text findings.

### ADDED: Missing fields stay missing

When required bibliographic fields are absent on the cited source record, identity status MUST be `fields-missing`. Verification MUST NOT invent DOI, title, year, pages or quoted text.

## 13. Non-Functional Requirements

- **Integrity:** claims, links and verification records reconstruct after reopen.
- **Honesty:** inaccessible full text cannot become verified support.
- **Authority:** claim write is not owner approval.
- **Compatibility:** E01-E06, E14 and e07s01 tests remain passing.
- **Privacy:** verification diagnostics omit source excerpts except the already-stored evidence excerpt hash/reference.

## 14. Contracts

### New contracts

- `recordClaim(handle, capability, request): ClaimRecord`
- `linkClaimEvidence(handle, capability, request): ClaimEvidenceLink`
- `verifyCitation(handle, capability, request): CitationVerification`
- `inspectClaim(handle, capability, claimId): ClaimInspection` including links, current support and verifications.
- `listClaims(handle, capability): readonly ClaimRecord[]`

### Existing contracts preserved

- Evidence items remain the only located-observation records.
- `listCommitments` stays empty unless an E04 owner confirmation occurred.
- E06 bibliographic/source records remain the identity authority; E07 does not create sources.

## 15. Reason for Depth and Zoom-Out

`src/evidence/claim-store.ts` owns claim, link and verification persistence. It is separate from `evidence-store.ts` because claims have support-status invariants that evidence items do not. No workflow engine or citation graph database is introduced.

Shared modules: `source-store` bibliographic records (read), `readLocatedExcerpt` / `inspectSource` (read), `commitment-store` (must not be written), `index.ts` (typed exports).

Planned tests: `tests/evidence/claim-verification.test.ts` and extensions to `tests/integration/evidence-authority.test.ts`.

## 16. Implementation Steps

1. Add claim, link and verification types plus durable command/payload reopen coverage → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s02.*(claim record|link|reopen|command|payload)' dist/tests/*/*.test.js`
2. Distinguish identity, access limits and substantive support, including inaccessible full text and unsupported abstracts → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s02.*(identity|access-limited|unsupported|inaccessible|abstract|quotation|page)' dist/tests/*/*.test.js`
3. Keep missing fields missing and retain supporting versus challenging links on the same claim → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e07s02.*(fields-missing|invent|supporting|challenging)' dist/tests/*/*.test.js`
4. Prove claims are not commitments and keep the quality gate passing → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e07s02.*(commitment|chat|candidate|capability|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e07s02-P0-01: Identity is not support

```gherkin
Given a claim and a bibliographic identity that matches a cited source
When citation verification runs without accessible full text that locates supporting content
Then identity may be resolved
And current support is not substantively-supported
```

### Scenario SC-e07s02-P0-02: AC-05 inaccessible misleading citation

```gherkin
Given metadata for a real source, inaccessible full text, and a claim the abstract does not support
When citation verification runs
Then access is marked limited and the claim is unsupported
And no quotation, page number or full-text finding is stored
```

### Scenario SC-e07s02-P0-03: Missing fields stay missing

```gherkin
Given a cited source record with absent DOI, title or year
When verification runs
Then identity status is fields-missing
And those fields remain empty rather than invented
```

### Scenario SC-e07s02-P1-04: Claims are not commitments

```gherkin
Given a recorded claim, a specialist candidate marked verified in its payload, and ordinary chat text that says approved
When claim APIs complete
Then listCommitments remains empty
And the claim remains a claim record with inspectable support status
```

## 18. Verification Script (Step-by-Step)

1. Record a claim and link supporting plus challenging evidence items from e07s01 fixtures.
2. Verify a DOI-identified metadata-only source and confirm support is not substantive.
3. Run the AC-05 inaccessible-full-text plus unsupported-abstract fixture.
4. Verify a source with missing bibliographic fields.
5. Confirm `listCommitments` is empty.
6. Run all released tests under Node.js 24.

## 19. Risks and Mitigations

- **DOI-as-proof:** derive `substantively-supported` only from located full-text evidence items.
- **Abstract-as-paper:** AC-05 fixture uses abstract-only access and a claim string absent from the abstract.
- **Commitment confusion:** claim APIs never call `recordOwnerDecision`.
- **Field invention:** copy bibliographic values only from existing E06 source/bibliography records.

## 20. Traceability

- Scope outcome: R07
- Epic acceptance scenarios: AC-05
- Test scenarios: SC-e07s02-P0-01, SC-e07s02-P0-02, SC-e07s02-P0-03, SC-e07s02-P1-04
- Domain contracts: `specs/tech-architecture/tech-stack.md` invariant 2; Claim / Counterevidence language
- Acceptance: `specs/docs/05-decisions-and-acceptance.md` AC-05
