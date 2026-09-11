# e06s03 — Located Bibliographic and Tabular Imports

## 1. Identity

- **Story ID:** e06s03
- **Epic:** e06 — Local import and source inspection
- **Type:** feat
- **Risk:** P0
- **Context:** parser/domain
- **BCPs:** 5
- **Status:** planned
- **Requirement delta:** ADDED

## 2. User Story

As a researcher, I want to import bibliographies and tables with stable record/field/cell locations so that metadata access and raw data remain inspectable without pretending that citations provide full-text evidence or executing spreadsheet content.

## 3. Context

E06s01 preserves immutable local sources; e06s02 supplies bounded parser workers and OOXML archive preflight. This slice adds BibTeX/RIS/CSV/XLSX adapters and source records that preserve original containers, raw values, normalized projections and exact format coordinates.

## 4. Problem

Bibliographic imports can resolve identity without providing full text. CSV records can span physical lines and contain duplicate headers. XLSX values can hide formulas, cached values, links, macros and huge ZIP expansions. Flattening these inputs into generic JSON would lose provenance and could turn metadata into misleading evidence.

## 5. Goal

Import BibTeX/RIS entries and CSV/XLSX data under finite limits, retain exact original files, register inspectable derived records, preserve raw-versus-normalized values and format-specific locators, and expose explicit partial/failure/active-content diagnostics.

## 6. Non-Goals

- Automatic duplicate merge; e06s04 proposes source relationships.
- Full-text retrieval, citation verification, evidence-item creation, statistical analysis or formula calculation.
- BibTeX/RIS export or project round-trip export; later export responsibilities own generation.
- XLS, macro-enabled workbook execution, arbitrary archive formats or provider/network access.

## 7. Stakeholders

- Researchers importing reference-manager and analysis files.
- E07/E08 consumers of source identity, accessibility and located records.
- E11 consumers of permission-checked table versions.
- E15 portability consumers that later preserve permitted source records and originals.

## 8. Dependencies

- e06s01 source intake/records and e06s02 bounded worker/archive preflight.
- E02 immutable artifact/dependency storage and E03 local-only/inherited policy.
- `specs/IMPACT_LATEST.md` and `specs/tech-architecture/e06-TEST_PLAN_LATEST.md` scenarios SC-e06s03-P0-01 through SC-e06s03-P0-05.
- Exact package candidates reviewed at implementation start:
  - `[SUS] biblatex-csl-converter@3.6.0` — current Node >=22 parser covers BibTeX and RIS with unknown-field handling, but LGPL-3.0 redistribution obligations require explicit owner acceptance and recorded notices before execution.
  - `[OK] csv-parse@7.0.2` — MIT, typed, no direct runtime dependencies and finite record/field options.
  - `[SUS] read-excel-file@9.3.10` — MIT and Node >=18, selected over vulnerable `xlsx`, but OOXML active-content/formula/link visibility is incomplete without E06s02 archive/XML preflight; adoption requires that combined behavior to pass.
  - `[OK] saxes@6.0.0` — ISC streaming XML parser used only on bounded known OOXML entries to retain formula expressions/cached values and relationship markers without evaluating them.

## 9. Assumptions

- A BibTeX/RIS container is one immutable imported source. Each parsed citation becomes a metadata-only artifact/source version derived from that container so policy/provenance applies independently.
- Identity fields such as DOI are normalized as projections while exact raw fields remain available.
- CSV locators use logical record number and numeric column index plus raw header because quoted records may span lines and headers may repeat.
- XLSX locators use exact sheet name and A1 cell address. Formula expression and cached value, when present, remain distinct.

## 10. Constraints

- Parse bytes/local strings only; no DOI lookup, schema fetch, external relationship resolution or network fallback.
- Preserve every original container before parsing; parsed entries/tables are derived artifacts/records with exact dependencies.
- Keep unknown and malformed bibliography fields as raw data with diagnostics; never repair missing facts by inference.
- Preflight XLSX ZIP entries and OOXML relationships/formula/macro markers before structured parsing. Use `saxes` on bounded known workbook, relationship, shared-string and worksheet XML entries; reject DTD/entity declarations and ignore unknown parts.
- Use `read-excel-file` for cell projections and join them to independently scanned sheet/A1 formula/link metadata. Preserve formula expression and cached lexical value separately; an absent/error cache remains absent with a diagnostic.
- Never evaluate formulas, DDE, macros, links or external workbook relationships.
- Enforce finite record, field, cell, sheet, string, archive, output, time and worker-memory limits.
- Complete status requires persisted derived record(s), locators and diagnostics; partial status names omitted/malformed items.

## 11. Domain Model

- **Bibliographic source record:** metadata-only derived source with entry key/ordinal, raw fields, normalized identifiers and access state.
- **Tabular extraction:** derived structured content from a CSV/XLSX original with sheet/record/cell coordinates.
- **Structured locator:** BibTeX entry+field; RIS record+tag+occurrence; CSV logical record+column index/raw header; XLSX sheet+A1 address.
- **Raw/normalized value:** source-preserved lexical value and deterministic typed/identifier projection, never a silent replacement.

## 12. Requirements

### ADDED: Located BibTeX and RIS import

BibTeX/RIS import MUST retain original bytes and create metadata-only source records with exact container dependency, raw fields, normalized identifiers and entry/field or record/tag/occurrence locators. Malformed/unknown fields MUST remain visible as partial diagnostics and MUST NOT produce invented metadata.

### ADDED: Located CSV import

CSV import MUST preserve logical records across quoting/newlines and locate values by logical record plus numeric column/raw header. Raw lexical values MUST remain distinguishable from normalized projections, including duplicate headers and blanks.

### ADDED: Located XLSX import

XLSX import MUST preserve exact originals and locate extracted values by sheet and A1 address. Bounded OOXML scanning MUST retain formula expression and cached lexical value separately and identify links, macro markers and external relationships; none may be executed or fetched.

### ADDED: Finite structured parsing

All structured adapters MUST enforce finite input/archive/record/field/cell/string/output/time/memory limits and return explicit partial/failed status without a falsely complete output.

## 13. Non-Functional Requirements

- **Research integrity:** bibliographic identity never implies full-text access or claim support.
- **Security:** no formula, link, macro, DDE, relationship, process or network execution.
- **Fidelity:** raw values and coordinates remain available alongside deterministic normalization.
- **Resource safety:** hostile cardinality/size limits terminate deterministically.
- **Supply chain:** exact pins, source/notice/export review, LGPL compliance decision and clean production audit are required.

## 14. Contracts

### New contracts

- Existing `importLocalSource` dispatch adds `bibtex`, `ris`, `csv` and `xlsx` formats after secure byte intake.
- `listBibliographicRecords(handle, containerVersionId): readonly BibliographicSourceRecord[]` returns metadata-only derived source records and raw/normalized fields.
- `listTabularRegions(handle, sourceVersionId): readonly TabularRegion[]` returns sheet/record boundaries and located values.

### Existing contracts preserved

- E06s01 owns path/capability/original registration; adapters receive bytes only.
- E06s02 worker/archive ceilings are reused rather than duplicated.
- E02 derived dependencies and E03 inherited/local-only behavior apply to each parsed result.
- No parser directly calls classification, grant, disclosure, viewer, provider or approval APIs.

## 15. Reason for Depth and Zoom-Out

`src/sources/structured-parser.ts` owns format-specific pure byte-to-record conversion with a direct switch for four formats; a plugin registry is unnecessary. Existing `parser-worker.ts` and `archive-preflight.ts` are extended only for structured limits and XLSX markers; `saxes` scans bounded known OOXML entries while `read-excel-file` supplies values. `source-store.ts` persists bibliography/table projections and locators. This separation is justified by pure parsing versus canonical writes, not future extensibility.

Shared schema/artifact/policy/public-export blast radius remains as documented in `specs/IMPACT_LATEST.md`. New parser packages are isolated behind E06 source functions and never exported as public Ganesh contracts.

Planned tests: `tests/sources/structured-import.test.ts`; tiny independent BibTeX/RIS/CSV/XLSX fixtures in `tests/fixtures/sources/`; `tests/support/source-fixtures.ts` helpers.

## 16. Implementation Steps

1. Install exact bibliography/CSV/XLSX/XML packages with `--ignore-scripts`, inspect source/exports/licenses/notices, and extend `specs/verifications/e06-parser-dependencies.md` before adapter adoption → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && test -f specs/verifications/e06-parser-dependencies.md && grep -q -- '--ignore-scripts' specs/verifications/e06-parser-dependencies.md && grep -q 'biblatex-csl-converter@3.6.0' specs/verifications/e06-parser-dependencies.md && npm ls --depth=0 biblatex-csl-converter@3.6.0 csv-parse@7.0.2 read-excel-file@9.3.10 saxes@6.0.0 && npm run build && node --test --test-name-pattern='e06s03.*(dependency|license|offline|adapter)' dist/tests/*/*.test.js && npm audit --omit=dev`
2. Import BibTeX/RIS originals and metadata-only entries with raw/normalized fields, locators and honest malformed diagnostics → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s03.*(bibtex|ris|metadata.only|entry|field|identifier)' dist/tests/*/*.test.js`
3. Import CSV/XLSX with exact logical/sheet/cell locators and inert formula/link/macro handling → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run build && node --test --test-name-pattern='e06s03.*(csv|xlsx|record|column|sheet|cell|formula|link|macro)' dist/tests/*/*.test.js`
4. Enforce structured limits, partial/failure diagnostics and all regressions → verify: `node -e "if (process.versions.node.split('.')[0] !== '24') process.exit(1)" && npm run typecheck && npm run lint && npm run build && npm test && node --test --test-name-pattern='e06s03.*(limit|partial|malformed|unicode|duplicate header|regression)' dist/tests/*/*.test.js`

## 17. Acceptance Criteria

### Scenario SC-e06s03-P0-01: Bibliography records retain source coordinates

```gherkin
Given BibTeX and RIS files with normal, unknown and malformed fields
When they are imported
Then original containers, raw fields, normalized identifiers and format-specific locators remain inspectable
And malformed data is partial or failed rather than repaired into invented facts
```

### Scenario SC-e06s03-P0-02: Metadata identity is not full text

```gherkin
Given a bibliographic entry with no acquired paper or abstract
When its source record is inspected
Then access is metadata-only with no full-text segment, quotation or page locator
And identity resolution is not reported as evidence verification
```

### Scenario SC-e06s03-P0-03: CSV locators follow logical records

```gherkin
Given CSV with multiline quoting, Unicode, duplicate headers and blank cells
When the table is imported
Then each value retains raw and normalized forms where applicable
And its locator uses logical record and numeric column plus raw header rather than physical line alone
```

### Scenario SC-e06s03-P0-04: XLSX content remains inert and located

```gherkin
Given a multi-sheet XLSX with formulas, cached values and external-link or macro markers
When the workbook is imported
Then extracted cells use exact sheet and A1 locators and distinguish those markers
And no formula, DDE, macro, relationship or external resource executes
```

### Scenario SC-e06s03-P0-05: Structured limits prevent false completion

```gherkin
Given a bibliography, CSV or XLSX that breaches a configured field, record, cell, string, archive, output, time or memory limit
When parsing is attempted
Then parsing stops deterministically with bounded diagnostics
And no incomplete canonical output is marked complete
```

## 18. Verification Script (Step-by-Step)

1. Verify exact package pins, source/exports/notices, LGPL decision and production advisory snapshot under Node.js 24.
2. Import independent BibTeX/RIS fixtures and inspect original hashes, derived metadata-only artifacts, raw fields and locators.
3. Import multiline CSV and multi-sheet XLSX fixtures and inspect raw/normalized values and coordinates.
4. Assert active workbook markers generate diagnostics and no network/process execution.
5. Trigger every finite limit with tiny injected ceilings.
6. Reopen the project and run all E01-E04 plus e06s01/e06s02 tests.

## 19. Risks and Mitigations

- **Metadata mistaken for evidence:** metadata-only access cannot return full-text locators/quotations.
- **Parser normalization destroys source:** retain exact containers and raw fields/values beside projections.
- **LGPL distribution obligation:** `[SUS]` requires owner plan approval and E18-compatible notices/source-link obligations before package adoption.
- **Hidden workbook activity:** bounded SAX scanning retains formula/cache/link/macro/relationship markers before value projection; DTD/entities reject and nothing evaluates/fetches.
- **Cardinality exhaustion:** finite counts/string/output/worker ceilings with deterministic fixtures.

## 20. Traceability

- Scope outcome: R06
- Epic acceptance scenarios: AC-05, AC-10, AC-20
- Test scenarios: SC-e06s03-P0-01, SC-e06s03-P0-02, SC-e06s03-P0-03, SC-e06s03-P0-04, SC-e06s03-P0-05
- Domain contracts: source identity/acquired versions, exact locators and metadata-versus-evidence distinction
- Architecture: `specs/docs/04-system-architecture.md` §§5, 9, 10 and 12
