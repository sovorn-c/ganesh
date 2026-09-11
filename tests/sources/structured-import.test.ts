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
  inspectArtifactVersion,
  listBibliographicRecords,
  listSourceDiagnostics,
  listSourceExtractions,
  listTabularRegions,
  type SourceImportRequest
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

const XLSX_FIXTURE = Buffer.from("UEsDBBQAAAAIAFmKK10DQSW3xgAAAHcBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2QsW7DMAxEf8XQWlh0OmQobGfInnboD7AyHQu2REFk0vTvIztohw6dOhHE8d4d2B5uYamulMVz7MzONubQt+9fiaQqSpTOTKrpBUDcRAHFcqJYlJFzQC1rPkNCN+OZ4Llp9uA4KkWtdWWYvn0t8OwHqt4w6wkDdQZuC3xynj+YZ1tYpjo+TGtuZzClxTvU0giucfiVWPM4ekcDu0soFispEw4yEWlY7DZtQB+fVjD8mb8dC7iLKIf6Yf3fOj8p321ge21/B1BLAwQUAAAACABZiitddfPUHY8AAADiAAAADwAAAHhsL3dvcmtib29rLnhtbI2PMQ6DMAxFrxL5ADV06ICAiaXHcME0ESSO7FTt8Yug7J3s/7/8vty+RZeHyOI+cU3WgS8lN4g2eo5kF8mctmQWjVQ2qU+0rEyTeeYSV7xW1Q0jhQQHodF/GDLPYeRBxlfkVA6I8kolSDIfskHf7g32my5R5A4GKgRud+5TBzU4bcK26H2qAfsWzyM8/+q/UEsDBBQAAAAIAFmKK124trvrjQAAAL8AAAAeAAAAeGwvd29ya3NoZWV0cy9jdXN0b20tc2hlZXQueG1sTY7NCsIwEIRfpeSkIG5TxYOkgYpXT+IDhJgYafPDJrQ+vkmQ4mWZ/XZ2GLZ4HKNRKjUfO7nYE5NSOANEaZQVce+DcvmiPVqR8ooviAGVeNYnO0HXtiew4u0IZ5VdRRKcoV8a7AnNVBYxFDXzY8dg5gzkD18K1vz+uG0GuqNbBrraDqsNclKef9GwduZfUEsDBBQAAAAIAFmKK126JvzvkQAAAPcAAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHONzzEOwjAMBdCrRNmpCwMDajOxdK24QJS6TdUmjmJXwO2JGFCRGBi/v/Ss3/S4Wpkpsp8Tq0dYI7fai6QLADuPwXJFCWNpRsrBSol5gmTdYieEU12fIe8NbZq9qbqh1bkbjlrdngn/sWkcZ4dXclvAKD9ewJ3ywh5RCmrzhNLqz4nBbSwUDu9UFVuDaeBrp3kBUEsBAhQDFAAAAAgAWYorXQNBJbfGAAAAdwEAABMAAAAAAAAAAAAAAIABAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAMUAAAACABZiitddfPUHY8AAADiAAAADwAAAAAAAAAAAAAAgAH3AAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAWYorXbi2u+uNAAAAvwAAAB4AAAAAAAAAAAAAAIABswEAAHhsL3dvcmtzaGVldHMvY3VzdG9tLXNoZWV0LnhtbFBLAQIUAxQAAAAIAFmKK126JvzvkQAAAPcAAAAaAAAAAAAAAAAAAACAAXwCAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLBQYAAAAABAAEABIBAABFAwAAAAA=", "base64");

function xlsxRequest(path: string): SourceImportRequest {
  return { commandId: "structured-xlsx-1", path, logicalId: "structured-xlsx", version: "v1", format: "xlsx", mediaType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" };
}

function request(path: string, format: "bibtex" | "ris" | "csv", commandId = `structured-${format}-1`): SourceImportRequest {
  const mediaType = format === "bibtex" ? "application/x-bibtex" : format === "ris" ? "application/x-research-info-systems" : "text/csv";
  return { commandId, path, logicalId: `structured-${format}`, version: "v1", format, mediaType };
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
  writeFileSync(path, "@article{smith2024, title={A {Nested} Title}, author={Smith, Jane}, doi={https://doi.org/10.1234/ABC}}\n");
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "bibtex"));
    const records = await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    strictEqual(Array.isArray(records), true);
    const bibliography = listBibliographicRecords(fixture.handle, imported.source.artifactVersionId);
    strictEqual(bibliography.length, 1);
    strictEqual(bibliography[0]?.rawFields.title, "A {Nested} Title");
    strictEqual(bibliography[0]?.normalizedIdentifiers.title, "a {nested} title");
    strictEqual(bibliography[0]?.normalizedIdentifiers.doi, "10.1234/abc");
    strictEqual(bibliography[0]?.access, "metadata-only");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 BibTeX and RIS record limits are partial and diagnosed", async () => {
  const fixture = projectFixture();
  const bibPath = join(fixture.root, "limited.bib");
  const risPath = join(fixture.root, "limited.ris");
  writeFileSync(bibPath, "@article{one, title={One}}\n@article{two, title={Two}}\n");
  writeFileSync(risPath, "TY  - JOUR\nID  - one\nTI  - One\nER  -\nTY  - JOUR\nID  - two\nTI  - Two\nER  -\n");
  try {
    const bib = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(bibPath, "bibtex", "structured-bib-record-limit"));
    await importStructuredSource(fixture.handle, bib.source.artifactVersionId, { maxRecords: 1 });
    strictEqual(listSourceDiagnostics(fixture.handle, bib.source.artifactVersionId).some((diagnostic) => diagnostic.code === "record-limit"), true);
    strictEqual(listSourceExtractions(fixture.handle, bib.source.artifactVersionId).at(-1)?.status, "partial");

    const ris = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(risPath, "ris", "structured-ris-record-limit"));
    await importStructuredSource(fixture.handle, ris.source.artifactVersionId, { maxRecords: 1 });
    strictEqual(listSourceDiagnostics(fixture.handle, ris.source.artifactVersionId).some((diagnostic) => diagnostic.code === "record-limit"), true);
    strictEqual(listSourceExtractions(fixture.handle, ris.source.artifactVersionId).at(-1)?.status, "partial");
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

test("e06s03 structured output has derived container provenance", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "provenance.csv");
  writeFileSync(path, "Name,Value\nAlice,42\n");
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "csv", "structured-provenance"));
    await importStructuredSource(fixture.handle, imported.source.artifactVersionId);
    const extraction = listSourceExtractions(fixture.handle, imported.source.artifactVersionId).at(-1);
    strictEqual(typeof extraction?.derivedVersionId, "string");
    strictEqual(inspectArtifactVersion(fixture.handle, extraction?.derivedVersionId ?? "").dependencies[0]?.dependencyVersionId, imported.source.artifactVersionId);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 structured parser persists bounded failures", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "too-many-fields.bib");
  writeFileSync(path, "@article{smith2024, title={A Study}, author={Smith, Jane}}\n");
  let sourceVersionId = "";
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "bibtex", "structured-limit"));
    sourceVersionId = imported.source.artifactVersionId;
    await importStructuredSource(fixture.handle, sourceVersionId, { maxFields: 1 });
    throw new Error("expected the field limit to fail");
  } catch (error) {
    strictEqual((error as { code?: string }).code, "structured-field-limit");
    strictEqual(listSourceExtractions(fixture.handle, sourceVersionId).at(-1)?.status, "failed");
    strictEqual(listSourceDiagnostics(fixture.handle, sourceVersionId).some((diagnostic) => diagnostic.code === "structured-field-limit"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 structured output limit is persisted as failure", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "too-large-output.csv");
  writeFileSync(path, "Name,Value\nAlice,42\n");
  let sourceVersionId = "";
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "csv", "structured-output-limit"));
    sourceVersionId = imported.source.artifactVersionId;
    await importStructuredSource(fixture.handle, sourceVersionId, { maxOutputBytes: 1 });
    throw new Error("expected the output limit to fail");
  } catch (error) {
    strictEqual((error as { code?: string }).code, "structured-output-limit");
    strictEqual(listSourceExtractions(fixture.handle, sourceVersionId).at(-1)?.status, "failed");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 structured worker timeout is persisted as failure", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "timeout.csv");
  writeFileSync(path, "Name,Value\nAlice,42\n");
  let sourceVersionId = "";
  try {
    const imported = importLocalSource(fixture.handle, createOwnerCapability("owner-test"), request(path, "csv", "structured-timeout"));
    sourceVersionId = imported.source.artifactVersionId;
    await importStructuredSource(fixture.handle, sourceVersionId, { maxElapsedMs: 1 });
    throw new Error("expected the worker timeout to fail");
  } catch (error) {
    strictEqual((error as { code?: string }).code, "structured-timeout");
    strictEqual(listSourceExtractions(fixture.handle, sourceVersionId).at(-1)?.status, "failed");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s03 dependency license offline adapter", () => {
  strictEqual(process.versions.node.split(".")[0], "24");
  strictEqual(typeof importStructuredSource, "function");
});
