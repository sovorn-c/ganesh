# e06s02 — Located PDF and DOCX Extraction

## 1. Identity

- **Story ID:** e06s02
- **Epic:** e06 — Local import and source inspection
- **Type:** feat
- **Risk:** P0
- **Context:** parser/security
- **BCPs:** 6
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want text-based PDF and DOCX imports to retain exact originals and stable page/paragraph locations so that I can inspect what was actually extracted and see when extraction is unsupported or lossy.

## 3. Context

E06s01 provides capability-scoped immutable source intake, additive source records, diagnostics and locators. This slice adds bounded parser work for compound untrusted documents and separate derived extraction artifacts that inherit restrictions from the original.

## 4. Problem

PDF and DOCX parsing is lossy and attacker-controlled. A parser can consume excessive resources, encounter encrypted/image-only content, expose external relationships, or produce text without stable coordinates. Treating an empty image-only PDF as verified text or silently dropping tables/math would violate AC-05/AC-20.

## 5. Goal

Extract text-based PDFs by page and DOCX content by paragraph/table cell in a finite worker, preserve parser/version provenance and loss diagnostics, report image-only/unsupported content honestly, and register external OCR only as an attributable derived extraction.

## 6. Non-Goals

- Built-in OCR, PDF rendering, DOCX editing, formula evaluation, browser/web viewing or native viewer launch.
- Universal layout reconstruction, mathematical notation recovery or table fidelity claims.
- Bibliographic/tabular imports, matching, claim verification or export.
- A sandbox guarantee; controls bound the chosen adapters and no broader containment claim is made.

## 7. Stakeholders

- Researchers inspecting papers and documents.
- E03 policy consumers that require derived restrictions.
- E07 evidence items that later need exact page/paragraph/cell locations.
- E14 native-viewer integration, which consumes but does not redefine E06 records.

## 8. Dependencies

- e06s01 immutable source intake, source records, locator/diagnostic schema and path security.
- E02 artifact dependencies and E03 inherited disclosure restrictions.
- `specs/IMPACT_LATEST.md` and `specs/tech-architecture/e06-TEST_PLAN_LATEST.md` scenarios SC-e06s02-P0-01 through SC-e06s02-P0-05.
- Exact package candidates reviewed at implementation start:
  - `[OK] pdfjs-dist@6.3.289` — official Apache-2.0 PDF.js distribution with Node 24 support; byte input only and `isEvalSupported: false`.
  - `[SUS] mammoth@1.12.2` — BSD-2-Clause and buffer/HTML capable, but upstream states it does no sanitization; adoption requires owner approval and proof that generated HTML remains in-memory, is never rendered, images/external access are disabled, and only text/paragraph/table structure is consumed.
  - `[OK] parse5@8.0.1` — MIT inert standards parser for Mammoth's generated HTML; no browser DOM or script execution.
  - `[OK] yauzl@3.4.0` and `[OK] @types/yauzl@3.4.0` — small MIT lazy ZIP preflight/type packages for finite central-directory checks.

## 9. Assumptions

- Absence of usable embedded PDF text is reported as `unsupported-image-only`; it does not prove how the image content was created.
- PDF locators are one-based page plus parser item ordinal and a UTF-8 byte span within stored page text.
- DOCX locators are one-based body paragraph or table/row/cell coordinates plus a UTF-8 byte span into the exact derived text artifact; they do not claim Word-rendered page numbers.
- External OCR bytes and provenance are supplied by an authorized local operation; Ganesh does not invoke OCR in E06.

## 10. Constraints

- Pass bytes, never paths or URLs, into parser functions after E06s01 secure intake.
- Preflight OOXML central directories for entry count, per-entry/total expanded size, compression ratio, encryption and unsafe names before Mammoth reads bytes.
- Run parsers in a worker with finite input, extracted-output, segment, elapsed-time and memory limits; terminate and persist a failed status on limit breach.
- Disable PDF eval and external resource loading; do not render pages, resolve remote fonts/maps, follow actions or expose JavaScript.
- Use Mammoth buffer-to-HTML with `p => p:fresh`, images disabled and `externalFileAccess: false`; parse generated HTML inertly with parse5, consume only text/paragraph/table structure, never render or persist the HTML, and retain Mammoth warnings.
- PDF page text concatenates returned text-item strings in parser order, inserting a line feed only for an item marked `hasEOL`; locators retain page/item ordinal and page-local UTF-8 span. Parser upgrades create a new extraction version rather than relocating an old one.
- DOCX derived text serializes paragraph and table-cell text in document order with canonical LF separators. Locators identify body paragraph or table/row/cell; merged cells and content omitted by the selected projection produce diagnostics.
- Register extracted text as a new artifact with `derived-from` dependency on the exact original before marking extraction complete.
- Active-content presence is diagnostic data, never executable content.

## 11. Domain Model

- **Document extraction:** exact original version, extractor name/version, limits, start/end status, derived text version and diagnostics.
- **Located segment:** extracted text span tied to original source and derived text with PDF page or DOCX paragraph/table coordinates.
- **Unsupported image-only extraction:** original retained, no usable text/quotation produced, explicit diagnostic attached.
- **External OCR extraction:** separately registered derived text with tool/version, acquisition time, actor and exact original dependency.

## 12. Requirements

### ADDED: Located PDF extraction

A successful PDF extraction MUST retain original bytes, register derived text, record the exact parser/version/locator algorithm, and persist stable one-based page/item plus page-local UTF-8 spans. Empty/image-only, encrypted or malformed content MUST NOT fabricate text or locations.

### ADDED: Located DOCX extraction

A successful DOCX extraction MUST retain original bytes, register canonical-LF derived text, and persist body paragraph or table/row/cell coordinates plus UTF-8 spans into that exact derived artifact. Unsupported layout, merged cells, images, equations, tracked changes or ordering ambiguity MUST be reported rather than silently represented as faithful.

### ADDED: Bounded inert parsing

PDF/DOCX parsing MUST obey finite byte/archive/output/segment/time/memory limits and MUST NOT execute or fetch scripts, actions, macros, links, relationships, embedded objects or remote resources.

### ADDED: Attributable external OCR

Externally produced OCR MAY be registered only as a separate derived extraction with exact source dependency and recorded tool/version/time/actor provenance. E06 MUST NOT claim built-in OCR or treat OCR as the original.

## 13. Non-Functional Requirements

- **Security:** no eval, network, process, macro, relationship or embedded-content execution.
- **Resource safety:** deterministic limits and worker termination; no unbounded archive expansion.
- **Integrity:** complete status requires both derived artifact and valid locators; failures retain the original and safe diagnostics.
- **Research integrity:** loss and unsupported extraction remain visible to downstream evidence consumers.
- **Supply chain:** exact pins, lockfile integrity, licenses/notices, source/exports review and `npm audit --omit=dev` are required before adoption.

## 14. Contracts

### New contracts

- `extractDocumentSource(handle, sourceVersionId, limits): Promise<SourceExtractionRecord>` dispatches only PDF/DOCX byte adapters and records a terminal outcome.
- `registerExternalExtraction(handle, capability, request): SourceExtractionRecord` registers attributable externally generated text against an exact source.
- `listSourceSegments(handle, sourceVersionId): readonly LocatedSourceSegment[]` returns page/paragraph/table coordinates and spans.

### Existing contracts preserved

- E06s01 remains the only local-path intake boundary.
- E02 artifact registration and dependency edges remain authoritative; extracted text is never stored only in SQLite.
- E03 inherited restriction traversal sees the original through the `derived-from` edge.
- `renderInertDocument` remains a display projection helper, not a parser or canonical-text sanitizer.

## 15. Reason for Depth and Zoom-Out

`src/sources/document-parser.ts` owns PDF/DOCX byte-to-segment conversion. `parser-worker.ts` owns finite worker execution shared by binary/structured adapters. `archive-preflight.ts` owns OOXML ZIP metadata checks used by DOCX and later XLSX. parse5 is used only inside the DOCX adapter to traverse Mammoth-generated inert structure. These modules are justified by distinct parser, process-budget and archive-security contracts; they are functions with a format switch, not speculative plugin interfaces.

Existing touched modules retain the purposes/callers/contracts recorded in `specs/IMPACT_LATEST.md`. This story adds dependencies to `package.json`/lockfile, calls `registerArtifactVersion`, writes through `source-store.ts`, adds explicit exports in `src/index.ts`, and does not alter policy or decision semantics.

Planned tests: `tests/sources/document-extraction.test.ts`; tiny independent fixtures under `tests/fixtures/sources/`; helper additions in `tests/support/source-fixtures.ts`.

## 16. Implementation Steps

1. Install exact PDF/DOCX/HTML/ZIP packages with `--ignore-scripts`, inspect source/exports/licenses/notices, and write `specs/verifications/e06-parser-dependencies.md` before adapter adoption → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && test -f specs/verifications/e06-parser-dependencies.md && grep -q -- '--ignore-scripts' specs/verifications/e06-parser-dependencies.md && grep -q 'pdfjs-dist@6.3.289' specs/verifications/e06-parser-dependencies.md && npm ls --depth=0 pdfjs-dist@6.3.289 mammoth@1.12.2 parse5@8.0.1 yauzl@3.4.0 @types/yauzl@3.4.0 && npm run build && node --test --test-name-pattern='e06s02.*(dependency|license|offline|adapter)' dist/tests/*/*.test.js && npm audit --omit=dev`
2. Extract bounded PDF text with exact derived provenance, stable pages and loss diagnostics → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s02.*(pdf|page|derived|provenance|loss)' dist/tests/*/*.test.js`
3. Extract bounded DOCX paragraphs/table cells and register attributable external OCR → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s02.*(docx|paragraph|table|ocr|provenance)' dist/tests/*/*.test.js`
4. Prove image-only/corrupt/encrypted/archive/timeout/active-content failures and regressions → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e06s02.*(image.only|corrupt|encrypted|oversiz|archive|timeout|active|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e06s02-P0-01: PDF text retains page provenance

```gherkin
Given a tiny text-based PDF
When bounded document extraction succeeds
Then exact original bytes and separately derived text are retained
And each text segment resolves to a one-based page and span with parser/version provenance
```

### Scenario SC-e06s02-P0-02: DOCX text retains structural provenance

```gherkin
Given a DOCX containing paragraphs and a table
When bounded document extraction succeeds
Then exact original bytes and derived text are retained
And segments identify paragraph or table/row/cell coordinates while unsupported layout is diagnostic
```

### Scenario SC-e06s02-P0-03: Image-only and OCR status is honest

```gherkin
Given a PDF with no usable embedded text
When extraction completes
Then status is unsupported-image-only and no quotation or page text is created
And separately supplied OCR is accepted only as an attributable derived extraction
```

### Scenario SC-e06s02-P0-04: Resource and format failures are terminal

```gherkin
Given corrupt, encrypted, oversized, over-expanded, excessive-entry or timed-out PDF/DOCX input
When parsing is attempted
Then the worker terminates with an explicit bounded failure
And no extraction is marked complete or points to missing derived bytes
```

### Scenario SC-e06s02-P0-05: Active content stays inert

```gherkin
Given PDF actions or JavaScript, or DOCX macros, links, relationships or embedded objects
When the document is inspected and parsed
Then no script, macro, network request, process or external resource executes
And safe diagnostics report active-content categories without retaining executable payloads
```

## 18. Verification Script (Step-by-Step)

1. Verify exact package pins, licenses/notices, package exports and clean production advisory snapshot under Node.js 24.
2. Import independent text PDF, image-only PDF and paragraph/table DOCX fixtures.
3. Compare original hashes, derived artifacts, dependencies, statuses, parser provenance and locators after reopen.
4. Register one synthetic external OCR output and verify exact dependency/provenance.
5. Exercise low injected archive/output/time/memory ceilings plus corrupt/encrypted/active-content fixtures.
6. Assert no network/process/viewer boundary call and run all inherited tests.

## 19. Risks and Mitigations

- **Parser code execution/history:** current PDF.js plus `isEvalSupported: false`, bytes only, no rendering/resources, active fixture checks.
- **Mammoth unsanitized output:** generated HTML is parsed inertly with parse5 and never rendered/persisted; no images/external file access; preflight OOXML; `[SUS]` requires owner plan approval.
- **Archive bomb:** inspect central directory before parser and cap entries/expanded size/ratio.
- **Worker exhaustion:** finite worker memory/time/output and deterministic termination.
- **False OCR confidence:** distinguish unsupported image-only input from separately attributable OCR and original bytes.
- **Locator overclaim:** use PDF pages and DOCX structure, never invented Word page numbers.

## 20. Traceability

- Scope outcome: R06
- Epic acceptance scenarios: AC-05, AC-10, AC-20
- Test scenarios: SC-e06s02-P0-01, SC-e06s02-P0-02, SC-e06s02-P0-03, SC-e06s02-P0-04, SC-e06s02-P0-05
- Domain contracts: exact source versions/locators, imported-material threat model and derived restriction inheritance
- Architecture: `specs/docs/04-system-architecture.md` §§3, 5, 9 and 10
