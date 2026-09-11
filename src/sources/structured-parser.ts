// story: e06s03
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseBiblatex, parseRIS } from "biblatex-csl-converter";
import readXlsxFile from "read-excel-file/node";
import { SaxesParser } from "saxes";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { sha256 } from "../persistence/storage-utils.js";
import { addDiagnostic, getSourceVersion, insertExtraction, insertSourceRecord, listSourceRecords, readSourceBytes, updateSourceExtractionStatus } from "./source-store.js";
import { preflightZip, readZipEntries } from "./archive-preflight.js";
import type { BibliographicSourceRecord, StructuredImportLimits, TabularRegion, TabularValue } from "./structured-types.js";
import { runBoundedStructuredParser, structuredLimits, type StructuredParserTask } from "./structured-worker.js";

type StoredRecord = Record<string, unknown>;

function text(value: unknown): string {
  if (typeof value === "string") {return value;}
  if (Array.isArray(value)) {return value.map(text).join(" ");}
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    if (typeof object.text === "string") {return object.text;}
    if (typeof object.family === "string") {return object.family;}
  }
  return value === undefined || value === null ? "" : String(value);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function enforceFieldLimits(fields: Readonly<Record<string, string>>, maximum: Required<StructuredImportLimits>, totalFields: number): number {
  const next = totalFields + Object.keys(fields).length;
  if (next > maximum.maxFields) {
    throw new ProjectStoreError("structured-field-limit", "structured input exceeds the configured field limit");
  }
  for (const value of Object.values(fields)) {
    if (byteLength(value) > maximum.maxStringBytes) {
      throw new ProjectStoreError("structured-string-limit", "structured field exceeds the configured string byte limit");
    }
  }
  return next;
}

function canonicalDoi(value: string): string | undefined {
  const candidate = value.trim().replace(/^doi:\s*/iu, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate).normalize("NFC").toLowerCase();
  } catch {
    return undefined;
  }
  return /^10\.\d{4,9}\/\S+$/u.test(decoded) && !/[\s\u0000-\u001f]/u.test(decoded) ? decoded : undefined;
}

function rawBibtexFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const match of body.matchAll(/([A-Za-z][\w-]*)\s*=\s*(?:\{([^{}]*)\}|"([^"]*)")/gu)) {
    fields[match[1].toLowerCase()] = (match[2] ?? match[3] ?? "").trim();
  }
  return fields;
}

function bibtexRecords(sourceVersionId: string, input: string, maximum: Required<StructuredImportLimits>): BibliographicSourceRecord[] {
  const parsed = parseBiblatex(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const records: BibliographicSourceRecord[] = [];
  let recordNumber = 0;
  let totalFields = 0;
  for (const entry of entries) {
    if (recordNumber >= maximum.maxRecords) {break;}
    recordNumber += 1;
    const key = text(entry.entry_key);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const entryStart = input.search(new RegExp(`@[^\\{]+\\{${escapedKey}\\s*,`, "iu"));
    const nextEntry = entryStart < 0 ? -1 : input.indexOf("@", entryStart + 1);
    const entryText = entryStart < 0 ? "" : input.slice(entryStart, nextEntry < 0 ? input.length : nextEntry);
    const rawFields = rawBibtexFields(entryText);
    const fields = (entry.fields ?? {}) as Record<string, unknown>;
    totalFields = enforceFieldLimits(rawFields, maximum, totalFields);
    const normalizedIdentifiers: Record<string, string> = {};
    const doi = canonicalDoi(rawFields.doi ?? text(fields.doi));
    if (doi !== undefined) {normalizedIdentifiers.doi = doi;}
    if (rawFields.title !== undefined) {normalizedIdentifiers.title = rawFields.title.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();}
    const locator = { format: "bibtex", entryNumber: recordNumber, entryKey: key, fieldNames: Object.keys(rawFields).sort() };
    records.push({ id: `bibliography-${sourceVersionId}-${recordNumber}`, sourceVersionId, format: "bibtex", entryKey: key, recordNumber, rawFields, normalizedIdentifiers, access: "metadata-only", locator });
  }
  return records;
}

function risRecords(sourceVersionId: string, input: string, maximum: Required<StructuredImportLimits>): BibliographicSourceRecord[] {
  const parsed = parseRIS(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const groups = input.split(/(?:^|\n)ER\s*[- ]\s*/gu).filter((value) => value.trim() !== "");
  let totalFields = 0;
  return entries.slice(0, maximum.maxRecords).map((entry, index) => {
    const rawFields: Record<string, string> = {};
    for (const match of (groups[index] ?? "").matchAll(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/gmu)) {
      rawFields[match[1]] = rawFields[match[1]] === undefined ? match[2].trim() : `${rawFields[match[1]]}\n${match[2].trim()}`;
    }
    totalFields = enforceFieldLimits(rawFields, maximum, totalFields);
    const doi = canonicalDoi(rawFields.DO ?? rawFields.DOI ?? "");
    const normalizedIdentifiers: Record<string, string> = {};
    if (doi !== undefined) {normalizedIdentifiers.doi = doi;}
    const recordNumber = index + 1;
    return { id: `bibliography-${sourceVersionId}-${recordNumber}`, sourceVersionId, format: "ris", entryKey: text(entry.entry_key), recordNumber, rawFields, normalizedIdentifiers, access: "metadata-only", locator: { format: "ris", recordNumber, tags: Object.keys(rawFields).sort() } };
  });
}

function persistBibliography(handle: ProjectHandle, sourceVersionId: string, records: readonly BibliographicSourceRecord[]): BibliographicSourceRecord[] {
  if (listSourceRecords(handle, sourceVersionId, "bibliographic").length > 0) {return [...records];}
  for (const record of records) {
    insertSourceRecord(handle, sourceVersionId, "bibliographic", { id: record.id, format: record.format, entryKey: record.entryKey, recordNumber: record.recordNumber, rawFields: record.rawFields, normalizedIdentifiers: record.normalizedIdentifiers }, record.locator);
  }
  return [...records];
}

function normalizeCell(value: unknown): string | number | boolean | null | undefined {
  if (value === null || value === undefined) {return null;}
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {return value;}
  return String(value);
}

function validateWorksheetXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new ProjectStoreError("xml-doctype", "OOXML DTD and entity declarations are unsupported");
  }
  const parser = new SaxesParser({ xmlns: false });
  parser.on("error", () => {
    throw new ProjectStoreError("xml-malformed", "OOXML worksheet XML is malformed");
  });
  parser.write(xml).close();
}

function columnName(index: number): string {
  let value = index + 1;
  let result = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    value = Math.floor((value - 1) / 26);
  }
  return result;
}

function parseCsvValues(sourceVersionId: string, input: string, maximum: Required<StructuredImportLimits>): TabularRegion {
  let rows: unknown[][];
  try {
    rows = parseCsv(input, { relax_column_count: true, skip_empty_lines: false, bom: true }) as unknown[][];
  } catch {
    return { sourceVersionId, format: "csv", values: [], diagnostics: ["csv-malformed"] };
  }
  const headers = (rows[0] ?? []).map((value) => String(value ?? ""));
  const values: TabularValue[] = [];
  const diagnostics: string[] = [];
  let fieldCount = headers.length;
  if (fieldCount > maximum.maxFields) {
    throw new ProjectStoreError("structured-field-limit", "CSV header fields exceed the configured field limit");
  }
  for (let rowIndex = 1; rowIndex < rows.length; rowIndex += 1) {
    if (rowIndex > maximum.maxRecords) {
      diagnostics.push("record-limit");
      break;
    }
    const row = rows[rowIndex] ?? [];
    for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
      if (values.length >= maximum.maxCells) {
        diagnostics.push("cell-limit");
        return { sourceVersionId, format: "csv", values, diagnostics };
      }
      fieldCount += 1;
      if (fieldCount > maximum.maxFields) {
        throw new ProjectStoreError("structured-field-limit", "CSV fields exceed the configured field limit");
      }
      const rawValue = String(row[columnIndex] ?? "");
      if (byteLength(rawValue) > maximum.maxStringBytes) {
        diagnostics.push("string-limit");
        continue;
      }
      values.push({ sourceVersionId, rawValue, normalizedValue: rawValue.trim(), locator: { format: "csv", recordNumber: rowIndex, columnNumber: columnIndex + 1, rawHeader: headers[columnIndex] ?? "", logicalRecord: rowIndex } , markers: [] });
    }
  }
  return { sourceVersionId, format: "csv", values, diagnostics };
}

function scanOoxmlXml(xml: string, markers: Set<string>): void {
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new ProjectStoreError("xml-doctype", "OOXML DTD and entity declarations are unsupported");
  }
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    const name = String(tag.name).toLowerCase();
    const attributes = tag.attributes as Record<string, unknown>;
    const values = Object.values(attributes).map(String).join(" ");
    if (name === "f") {markers.add("formula");}
    if (name === "hyperlink") {markers.add("hyperlink");}
    if (name.includes("externallink") || name === "relationship" && /external|targetmode/iu.test(values)) {markers.add("external-relationship");}
    if (name.includes("vbaproject") || name === "oleobject" || name === "altchunk") {markers.add("active-content");}
  });
  parser.on("error", () => {
    throw new ProjectStoreError("xml-malformed", "OOXML XML is malformed");
  });
  parser.write(xml).close();
}

function sharedStringsFromXml(xml: string): string[] {
  return Array.from(xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gu), (match) =>
    Array.from(match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gu), (textMatch) => textMatch[1]).join("")
  );
}

async function parseXlsxValues(sourceVersionId: string, bytes: Uint8Array, maximum: Required<StructuredImportLimits>): Promise<TabularRegion> {
  const entries = await preflightZip(bytes, { maxEntries: maximum.maxArchiveEntries, maxExpandedBytes: maximum.maxExpandedBytes });
  const names = entries.map((entry) => entry.name);
  const selectedNames = names.filter((name) =>
    name === "xl/workbook.xml" || name === "xl/sharedStrings.xml" ||
    /^xl\/worksheets\/[^/]+\.xml$/u.test(name) ||
    /^xl\/(?:_rels\/.*\.rels|worksheets\/_rels\/.*\.rels|workbook\.xml\.rels)$/u.test(name) ||
    /(?:externalLink|vbaProject)/iu.test(name)
  );
  const selected = await readZipEntries(bytes, selectedNames, { maxEntries: maximum.maxArchiveEntries, maxExpandedBytes: maximum.maxExpandedBytes });
  const markersSet = new Set<string>();
  for (const [name, value] of selected) {
    if (name.endsWith(".xml") || name.endsWith(".rels")) {scanOoxmlXml(new TextDecoder().decode(value), markersSet);}
  }
  if (names.some((name) => /vbaProject|externalLink/iu.test(name))) {markersSet.add("active-content");}
  const markers = [...markersSet].sort();
  const workbook = new TextDecoder().decode(selected.get("xl/workbook.xml") ?? new Uint8Array());
  const sharedStrings = sharedStringsFromXml(new TextDecoder().decode(selected.get("xl/sharedStrings.xml") ?? new Uint8Array()));
  const sheetNames = Array.from(workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/gu), (match) => ({ name: match[1], id: Number(match[2]) }));
  const values: TabularValue[] = [];
  const diagnostics: string[] = [];
  for (const sheet of sheetNames) {
    if (values.length >= maximum.maxCells) {
      diagnostics.push("cell-limit");
      break;
    }
    const sheetBytes = selected.get(`xl/worksheets/sheet${sheet.id}.xml`);
    const xml = new TextDecoder().decode(sheetBytes ?? new Uint8Array());
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gu;
    if (sheetBytes !== undefined) {
      validateWorksheetXml(xml);
    }
    for (const cell of xml.matchAll(cellPattern)) {
      if (values.length >= maximum.maxCells) {
        diagnostics.push("cell-limit");
        break;
      }
      const attributes = cell[1];
      const address = /\br="([A-Z]+\d+)"/u.exec(attributes)?.[1] ?? `${columnName(values.length)}1`;
      const type = /\bt="([^"]+)"/u.exec(attributes)?.[1];
      const body = cell[2];
      const formula = /<f[^>]*>([\s\S]*?)<\/f>/u.exec(body)?.[1];
      const cachedValue = /<v[^>]*>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      const sharedValue = type === "s" && cachedValue !== undefined ? sharedStrings[Number(cachedValue)] : undefined;
      const rawValue = sharedValue ?? cachedValue ?? /<is[^>]*>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/u.exec(body)?.[1] ?? "";
      if (byteLength(rawValue) > maximum.maxStringBytes) {
        diagnostics.push("string-limit");
        continue;
      }
      values.push({ sourceVersionId, rawValue, normalizedValue: rawValue.trim() === "" ? null : rawValue, locator: { format: "xlsx", sheetName: sheet.name, cellAddress: address }, ...(formula === undefined ? {} : { formula }), ...(cachedValue === undefined ? {} : { cachedValue }), markers });
    }
    if (sheetBytes === undefined) {
      const sheets = await readXlsxFile(Buffer.from(bytes));
      const rows = sheets.find((candidate) => candidate.sheet === sheet.name)?.data ?? [];
      for (const [rowIndex, row] of rows.entries()) {
        for (const [columnIndex, value] of row.entries()) {
          if (values.length >= maximum.maxCells) {break;}
          const rawValue = String(value ?? "");
          if (byteLength(rawValue) > maximum.maxStringBytes) { diagnostics.push("string-limit"); continue; }
          values.push({ sourceVersionId, rawValue, normalizedValue: normalizeCell(value), locator: { format: "xlsx", sheetName: sheet.name, cellAddress: `${columnName(columnIndex)}${rowIndex + 1}` }, markers });
        }
      }
    }
  }
  if (markers.includes("active-content") || markers.includes("external-relationship")) {diagnostics.push("active-content");}
  return { sourceVersionId, format: "xlsx", values, diagnostics: [...new Set(diagnostics)] };
}

export async function parseStructuredPayload(
  sourceVersionId: string,
  format: "bibtex" | "ris" | "csv" | "xlsx",
  bytes: Uint8Array,
  maximum: Required<StructuredImportLimits>
): Promise<BibliographicSourceRecord[] | TabularRegion> {
  if (format === "bibtex" || format === "ris") {
    const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return format === "bibtex" ? bibtexRecords(sourceVersionId, input, maximum) : risRecords(sourceVersionId, input, maximum);
  }
  if (format === "csv") {
    return parseCsvValues(sourceVersionId, new TextDecoder("utf-8", { fatal: true }).decode(bytes), maximum);
  }
  return await parseXlsxValues(sourceVersionId, bytes, maximum);
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

function structuredDerivedArtifact(handle: ProjectHandle, sourceVersionId: string, sourceAccess: "full-text" | "metadata-only" | "abstract-only" | "unavailable", format: "bibtex" | "ris" | "csv" | "xlsx", value: BibliographicSourceRecord[] | TabularRegion): string {
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
  let parsed: BibliographicSourceRecord[] | TabularRegion;
  try {
    const task: StructuredParserTask = { kind: "structured", sourceVersionId, format, bytes, limits: maximum };
    parsed = await runBoundedStructuredParser(task);
  } catch (error) {
    return persistStructuredFailure(handle, sourceVersionId, format, error);
  }
  const extractor = structuredExtractor(format);
  const diagnostics = "diagnostics" in parsed ? parsed.diagnostics : parsed.length === 0 ? ["malformed-record"] : [];
  const status = diagnostics.length === 0 && (!Array.isArray(parsed) || parsed.length > 0) ? "complete" : "partial";
  const derivedId = structuredDerivedArtifact(handle, sourceVersionId, source.access, format, parsed);
  const extraction = insertExtraction(handle, sourceVersionId, derivedId, status, extractor.name, extractor.version, extractor.locator);
  updateSourceExtractionStatus(handle, sourceVersionId, status, extractor.name, extractor.version);
  for (const diagnostic of diagnostics) {
    addDiagnostic(handle, sourceVersionId, diagnostic, status === "partial" ? "warning" : "info", `structured import reported ${diagnostic}`, extraction.id);
  }
  return Array.isArray(parsed) ? persistBibliography(handle, sourceVersionId, parsed) : persistTabular(handle, parsed);
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

export { canonicalDoi };
