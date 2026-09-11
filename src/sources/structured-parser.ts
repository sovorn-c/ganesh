// story: e06s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { sha256 } from "../persistence/storage-utils.js";
import { addDiagnostic, getSourceVersion, insertExtraction, insertSourceRecord, listSourceRecords, readSourceBytes, updateSourceExtractionStatus } from "./source-store.js";
import type { BibliographicSourceRecord, StructuredImportLimits, TabularRegion, TabularValue } from "./structured-types.js";
import { runBoundedStructuredParser, structuredLimits, type StructuredParserTask } from "./structured-worker.js";
import type { BibliographyResult } from "./structured-parser-runtime.js";

type StoredRecord = Record<string, unknown>;

function persistBibliography(handle: ProjectHandle, sourceVersionId: string, records: readonly BibliographicSourceRecord[]): BibliographicSourceRecord[] {
  if (listSourceRecords(handle, sourceVersionId, "bibliographic").length > 0) {return [...records];}
  for (const record of records) {
    insertSourceRecord(handle, sourceVersionId, "bibliographic", { id: record.id, format: record.format, entryKey: record.entryKey, recordNumber: record.recordNumber, rawFields: record.rawFields, normalizedIdentifiers: record.normalizedIdentifiers }, record.locator);
  }
  return [...records];
}

function persistTabular(handle: ProjectHandle, region: TabularRegion): TabularRegion {
  if (listSourceRecords(handle, region.sourceVersionId, "tabular").length > 0) {return region;}
  for (const value of region.values) {
    insertSourceRecord(handle, region.sourceVersionId, "tabular", { rawValue: value.rawValue, normalizedValue: value.normalizedValue, formula: value.formula, cachedValue: value.cachedValue, markers: value.markers }, value.locator);
  }
  return region;
}

function structuredExtractor(format: "bibtex" | "ris" | "csv" | "xlsx"): { name: string; version: string; locator: string } {
  return format === "bibtex" || format === "ris"
    ? { name: "biblatex-csl-converter", version: "3.6.0", locator: "bibliography-entry-v1" }
    : format === "csv"
      ? { name: "csv-parse", version: "7.0.2", locator: "csv-logical-cell-v1" }
      : { name: "read-excel-file+saxes", version: "9.3.10+6.0.0", locator: "xlsx-sheet-a1-v1" };
}

function structuredDerivedArtifact(handle: ProjectHandle, sourceVersionId: string, sourceAccess: "full-text" | "metadata-only" | "abstract-only" | "unavailable", format: "bibtex" | "ris" | "csv" | "xlsx", value: BibliographyResult | TabularRegion): string {
  const content = JSON.stringify(value);
  const id = `derived-structured-${sha256(new TextEncoder().encode(`${sourceVersionId}:${format}:${content}`))}`;
  try {
    return getArtifactVersion(handle, id).id;
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "artifact-not-found") {throw error;}
    return registerArtifactVersion(handle, {
      logicalId: `derived-${sourceVersionId}`,
      version: `structured-${format}-v1`,
      versionId: id,
      content,
      origin: "structured-source-extraction",
      access: format === "bibtex" || format === "ris" ? "metadata-only" : sourceAccess,
      dependencies: [{ versionId: sourceVersionId, relation: "derived-from" }]
    }).id;
  }
}

function persistStructuredFailure(handle: ProjectHandle, sourceVersionId: string, format: "bibtex" | "ris" | "csv" | "xlsx", error: unknown): never {
  const extractor = structuredExtractor(format);
  const code = error instanceof ProjectStoreError ? error.code : "structured-parser-failed";
  const detail = error instanceof ProjectStoreError ? error.message : "structured parser failed";
  const extraction = insertExtraction(handle, sourceVersionId, null, "failed", extractor.name, extractor.version, extractor.locator);
  addDiagnostic(handle, sourceVersionId, code, "error", detail, extraction.id);
  updateSourceExtractionStatus(handle, sourceVersionId, "failed", extractor.name, extractor.version);
  throw error;
}

export async function importStructuredSource(handle: ProjectHandle, sourceVersionId: string, provided: StructuredImportLimits = {}): Promise<BibliographicSourceRecord[] | TabularRegion> {
  const source = getSourceVersion(handle, sourceVersionId);
  if (!["bibtex", "ris", "csv", "xlsx"].includes(source.format)) {
    throw new ProjectStoreError("unsupported-format", "structured import accepts BibTeX, RIS, CSV or XLSX sources");
  }
  const format = source.format as "bibtex" | "ris" | "csv" | "xlsx";
  const maximum = structuredLimits(provided);
  const bytes = readSourceBytes(handle, sourceVersionId);
  let parsed: BibliographyResult | TabularRegion;
  try {
    const task: StructuredParserTask = { kind: "structured", sourceVersionId, format, bytes, limits: maximum };
    parsed = await runBoundedStructuredParser(task);
  } catch (error) {
    return persistStructuredFailure(handle, sourceVersionId, format, error);
  }
  const extractor = structuredExtractor(format);
  const bibliography = "kind" in parsed ? parsed : undefined;
  const tabular = "values" in parsed ? parsed : undefined;
  const records = bibliography?.records;
  const diagnostics = bibliography?.diagnostics ?? tabular?.diagnostics ?? (records?.length === 0 ? ["malformed-record"] : []);
  const status = diagnostics.length === 0 && (tabular === undefined ? (records?.length ?? 0) > 0 : tabular.values.length > 0) ? "complete" : "partial";
  const derivedId = structuredDerivedArtifact(handle, sourceVersionId, source.access, format, parsed);
  const extraction = insertExtraction(handle, sourceVersionId, derivedId, status, extractor.name, extractor.version, extractor.locator);
  updateSourceExtractionStatus(handle, sourceVersionId, status, extractor.name, extractor.version);
  for (const diagnostic of diagnostics) {
    addDiagnostic(handle, sourceVersionId, diagnostic, status === "partial" ? "warning" : "info", `structured import reported ${diagnostic}`, extraction.id);
  }
  return tabular === undefined ? persistBibliography(handle, sourceVersionId, records ?? []) : persistTabular(handle, tabular);
}

export function listBibliographicRecords(handle: ProjectHandle, sourceVersionId: string): readonly BibliographicSourceRecord[] {
  return listSourceRecords(handle, sourceVersionId, "bibliographic").map((record) => {
    const data = record.data as StoredRecord;
    return {
      id: String(data.id), sourceVersionId, format: String(data.format) as "bibtex" | "ris", ...(typeof data.entryKey === "string" ? { entryKey: data.entryKey } : {}), recordNumber: Number(data.recordNumber), rawFields: data.rawFields as Record<string, string>, normalizedIdentifiers: data.normalizedIdentifiers as Record<string, string>, access: record.access as BibliographicSourceRecord["access"], locator: record.locator as Record<string, unknown>
    };
  });
}

export function listTabularRegions(handle: ProjectHandle, sourceVersionId: string): readonly TabularRegion[] {
  const rows = [...listSourceRecords(handle, sourceVersionId, "tabular")].sort((left, right) => {
    const leftLocator = left.locator as Record<string, unknown>;
    const rightLocator = right.locator as Record<string, unknown>;
    return Number(leftLocator.recordNumber ?? 0) - Number(rightLocator.recordNumber ?? 0) || Number(leftLocator.columnNumber ?? 0) - Number(rightLocator.columnNumber ?? 0);
  });
  const values: TabularValue[] = rows.map((record) => {
    const data = record.data as StoredRecord;
    return { sourceVersionId, rawValue: String(data.rawValue ?? ""), ...(data.normalizedValue === undefined ? {} : { normalizedValue: data.normalizedValue as string | number | boolean | null }), ...(typeof data.formula === "string" ? { formula: data.formula } : {}), ...(typeof data.cachedValue === "string" ? { cachedValue: data.cachedValue } : {}), locator: record.locator as Record<string, unknown>, markers: Array.isArray(data.markers) ? data.markers.map(String) : [] };
  });
  const format = rows[0] === undefined ? "csv" : String((rows[0].locator as Record<string, unknown>).format ?? "csv");
  return values.length === 0 ? [] : [{ sourceVersionId, format: format === "xlsx" ? "xlsx" : "csv", values, diagnostics: [] }];
}

export { canonicalDoi, parseStructuredPayload } from "./structured-parser-runtime.js";
