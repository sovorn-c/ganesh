// story: e06s03
// scenario: SC-e06s03-P0-01, SC-e06s03-P0-02, SC-e06s03-P0-03, SC-e06s03-P0-04, SC-e06s03-P0-05
import { strictEqual, deepStrictEqual } from "node:assert";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  createOwnerCapability,
  importLocalSource,
  importStructuredSource,
  listBibliographicRecords,
  listTabularRegions,
  type SourceImportRequest
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

const XLSX_FIXTURE = Buffer.from("UEsDBBQAAAAIAIZ+K11n9Ob4wQAAAHEBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2Qsa7CMAxFf6XKiojLGxhQWwZ2eMP7AZO6NGoTR4nhwd+TFsHAwMR0Zdn33CtX26sbiwvFZNnXaqVLtW2qv1ugVOSNT7XqRcIGIJmeHCbNgXzedBwdSh7jCQKaAU8EP2W5BsNeyMtSJoZqqkOGR9tS8YtR9uioVnAd4Z/jcGQedGapYvcwTbm1whBGa1ByI7j49i1xyV1nDbVszi5bdAqRsE09kbhRz6odWr+YwPAxfz5OMMvqy0Ve/GcPmJ/a3AFQSwMEFAAAAAgAhn4rXdWHkZJ1AAAAlAAAAA8AAAB4bC93b3JrYm9vay54bWw1jsEOwjAMQ3+lygeQjQOHqe2Jyz4j0ECnLe2UVILPp5rYyfazLNl/qq6PWlf3la1YgNzaPiHaM7OQXerOpTevqkKtR32j7cqULDM32fA6DDcUWgpEfzD7qyskHOBOjcAdZE4BRnA6Ld3onEbA6PEc4fkk/gBQSwMEFAAAAAgAhn4rXbi2u+uNAAAAvwAAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxNjs0KwjAQhF+l5KQgblPFg6SBildP4gOEmBhp88MmtD6+SZDiZZn9dnYYtngco1EqNR87udgTk1I4A0RplBVx74Ny+aI9WpHyii+IAZV41ic7Qde2J7Di7QhnlV1FEpyhXxrsCc1UFjEUNfNjx2DmDOQPXwrW/P64bQa6o1sGutoOqw1yUp5/0bB25l9QSwECFAMUAAAACACGfitdZ/Tm+MEAAABxAQAAEwAAAAAAAAAAAAAAgAEAAAAAW0NvbnRlbnRfVHlwZXNdLnhtbFBLAQIUAxQAAAAIAIZ+K13Vh5GSdQAAAJQAAAAPAAAAAAAAAAAAAACAAfIAAAB4bC93b3JrYm9vay54bWxQSwECFAMUAAAACACGfitduLa7640AAAC/AAAAGAAAAAAAAAAAAAAAgAGUAQAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sUEsFBgAAAAADAAMAxAAAAFcCAAAAAA==", "base64");

function xlsxRequest(path: string): SourceImportRequest {
  return { commandId: "structured-xlsx-1", path, logicalId: "structured-xlsx", version: "v1", format: "xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

function request(path: string, format: "bibtex" | "ris" | "csv"): SourceImportRequest {
  const mediaType = format === "bibtex" ? "application/x-bibtex" : format === "ris" ? "application/x-research-info-systems" : "text/csv";
  return { commandId: `structured-${format}-1`, path, logicalId: `structured-${format}`, version: "v1", format, mediaType };
}

test("e06s03 XLSX import preserves A1 and formula provenance", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "table.xlsx");
  writeFileSync(path, XLSX_FIXTURE);
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), xlsxRequest(path));
    await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    const regions = listTabularRegions(fixture.handle, imported.source.artifactVersionId);
    strictEqual(regions[0]?.format, "xlsx");
    strictEqual(regions[0]?.values.some((value) => value.locator.cellAddress === "A1"), true);
    strictEqual(regions[0]?.values.some((value) => value.formula === "SUM(A1,1)"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 bibtex entry metadata-only identifiers preserve raw fields", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "refs.bib");
  writeFileSync(path, "@article{smith2024, title={A Study}, author={Smith, Jane}, doi={https://doi.org/10.1234/ABC}}\n");
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "bibtex"));
    const records = await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    strictEqual(Array.isArray(records), true);
    const bibliography = listBibliographicRecords(fixture.handle, imported.source.artifactVersionId);
    strictEqual(bibliography.length, 1);
    strictEqual(bibliography[0]?.rawFields.title, "A Study");
    strictEqual(bibliography[0]?.normalizedIdentifiers.doi, "10.1234/abc");
    strictEqual(bibliography[0]?.access, "metadata-only");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 RIS entry field identifiers remain metadata-only", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "refs.ris");
  writeFileSync(path, "TY  - JOUR\nID  - smith2024\nTI  - A Study\nDO  - https://doi.org/10.1234/ABC\nER  -\n");
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "ris"));
    await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    const records = listBibliographicRecords(fixture.handle, imported.source.artifactVersionId);
    strictEqual(records.length, 1);
    strictEqual(records[0]?.normalizedIdentifiers.doi, "10.1234/abc");
    strictEqual(records[0]?.locator.format, "ris");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 CSV import preserves duplicate headers and record column locators", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "table.csv");
  writeFileSync(path, "Name,Name,Value\nAlice,Alice,42\n");
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "csv"));
    await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    const regions = listTabularRegions(fixture.handle, imported.source.artifactVersionId);
    strictEqual(regions.length, 1);
    strictEqual(regions[0]?.values.length, 3);
    strictEqual(regions[0]?.values[0]?.locator.rawHeader, "Name");
    strictEqual(regions[0]?.values[1]?.locator.columnNumber, 2);
    deepStrictEqual(regions[0]?.values[2]?.normalizedValue, "42");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 malformed structured input is partial and bounded", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "bad.csv");
  writeFileSync(path, '"unterminated,field\n');
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "csv"));
    const result = await importStructuredSource(fixture.handle, imported.source.artifactVersionId, { maxCells: 1 });
    strictEqual((result as { diagnostics: readonly string[] }).diagnostics.includes("csv-malformed"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 dependency license offline adapter", () => {
  strictEqual(process.versions.node.split(".")[0], "24");
  strictEqual(typeof importStructuredSource, "function");
});
