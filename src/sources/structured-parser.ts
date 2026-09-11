// story: e06s03
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseBiblatex, parseRIS } from "biblatex-csl-converter";
import readXlsxFile from "read-excel-file/node";
import { SaxesParser } from "saxes";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { sha256 } from "../persistence/storage-utils.js";
import { addDiagnostic, getSourceVersion, insertExtraction, insertSourceRecord, listSourceRecords, readSourceBytes, updateSourceExtractionStatus } from "./source-store.js";
import { preflightZip, readZipEntries } from "./archive-preflight.js";
import type { BibliographicSourceRecord, StructuredImportLimits, TabularRegion, TabularValue } from "./structured-types.js";

const DEFAULT_LIMITS: Required<StructuredImportLimits> = {
  maxRecords: 10_000,
  maxFields: 100_000,
  maxCells: 100_000,
  maxStringBytes: 2 * 1024 * 1024,
  maxArchiveEntries: 4096,
  maxExpandedBytes: 128 * 1024 * 1024
};

type StoredRecord = Record<string, unknown>;

function limits(provided: StructuredImportLimits = {}): Required<StructuredImportLimits> {
  return { ...DEFAULT_LIMITS, ...provided };
}

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

function bibtexRecords(sourceVersionId: string, input: string, maxRecords: number): BibliographicSourceRecord[] {
  const parsed = parseBiblatex(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const records: BibliographicSourceRecord[] = [];
  let recordNumber = 0;
  for (const entry of entries) {
    if (recordNumber >= maxRecords) {break;}
    recordNumber += 1;
    const key = text(entry.entry_key);
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const entryStart = input.search(new RegExp(`@[^\\{]+\\{${escapedKey}\\s*,`, "iu"));
    const nextEntry = entryStart < 0 ? -1 : input.indexOf("@", entryStart + 1);
    const entryText = entryStart < 0 ? "" : input.slice(entryStart, nextEntry < 0 ? input.length : nextEntry);
    const rawFields = rawBibtexFields(entryText);
    const fields = (entry.fields ?? {}) as Record<string, unknown>;
    const normalizedIdentifiers: Record<string, string> = {};
    const doi = canonicalDoi(rawFields.doi ?? text(fields.doi));
    if (doi !== undefined) {normalizedIdentifiers.doi = doi;}
    if (rawFields.title !== undefined) {normalizedIdentifiers.title = rawFields.title.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();}
    const locator = { format: "bibtex", entryNumber: recordNumber, entryKey: key, fieldNames: Object.keys(rawFields).sort() };
    records.push({ id: `bibliography-${sourceVersionId}-${recordNumber}`, sourceVersionId, format: "bibtex", entryKey: key, recordNumber, rawFields, normalizedIdentifiers, access: "metadata-only", locator });
  }
  return records;
}

function risRecords(sourceVersionId: string, input: string, maxRecords: number): BibliographicSourceRecord[] {
  const parsed = parseRIS(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const groups = input.split(/(?:^|\n)ER\s*[- ]\s*/gu).filter((value) => value.trim() !== "");
  return entries.slice(0, maxRecords).map((entry, index) => {
    const rawFields: Record<string, string> = {};
    for (const match of (groups[index] ?? "").matchAll(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/gmu)) {
      rawFields[match[1]] = rawFields[match[1]] === undefined ? match[2].trim() : `${rawFields[match[1]]}\n${match[2].trim()}`;
    }
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
      const rawValue = String(row[columnIndex] ?? "");
      if (new TextEncoder().encode(rawValue).byteLength > maximum.maxStringBytes) {
        diagnostics.push("string-limit");
        continue;
      }
      values.push({ sourceVersionId, rawValue, normalizedValue: rawValue.trim(), locator: { format: "csv", recordNumber: rowIndex, columnNumber: columnIndex + 1, rawHeader: headers[columnIndex] ?? "", logicalRecord: rowIndex } , markers: [] });
    }
  }
  return { sourceVersionId, format: "csv", values, diagnostics };
}

async function parseXlsxValues(sourceVersionId: string, bytes: Uint8Array, maximum: Required<StructuredImportLimits>): Promise<TabularRegion> {
  const entries = await preflightZip(bytes, { maxEntries: maximum.maxArchiveEntries, maxExpandedBytes: maximum.maxExpandedBytes });
  const names = entries.map((entry) => entry.name);
  const selected = await readZipEntries(bytes, names.filter((name) => name === "xl/workbook.xml" || name.startsWith("xl/worksheets/") || name.includes("externalLink") || name.includes("vbaProject")));
  const workbook = new TextDecoder().decode(selected.get("xl/workbook.xml") ?? new Uint8Array());
  const sheetNames = Array.from(workbook.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*sheetId="(\d+)"/gu), (match) => ({ name: match[1], id: Number(match[2]) }));
  const values: TabularValue[] = [];
  const diagnostics: string[] = [];
  const markers = names.some((name) => /vbaProject|externalLink/iu.test(name)) ? ["active-content"] : [];
  for (const sheet of sheetNames) {
    if (values.length >= maximum.maxCells) {
      diagnostics.push("cell-limit");
      break;
    }
    const sheetBytes = selected.get(`xl/worksheets/sheet${sheet.id}.xml`);
    const xml = new TextDecoder().decode(sheetBytes ?? new Uint8Array());
    if (sheetBytes !== undefined) {
      validateWorksheetXml(xml);
    }
    for (const cell of xml.matchAll(/<c\b[^>]*r="([A-Z]+\d+)"[^>]*>([\s\S]*?)<\/c>/gu)) {
      if (values.length >= maximum.maxCells) {
        diagnostics.push("cell-limit");
        break;
      }
      const body = cell[2];
      const formula = /<f[^>]*>([\s\S]*?)<\/f>/u.exec(body)?.[1];
      const cachedValue = /<v[^>]*>([\s\S]*?)<\/v>/u.exec(body)?.[1];
      values.push({ sourceVersionId, rawValue: cachedValue ?? "", normalizedValue: cachedValue ?? null, locator: { format: "xlsx", sheetName: sheet.name, cellAddress: cell[1] }, ...(formula === undefined ? {} : { formula }), ...(cachedValue === undefined ? {} : { cachedValue }), markers });
    }
    if (sheetBytes === undefined) {
      const sheets = await readXlsxFile(Buffer.from(bytes));
      const rows = sheets.find((candidate) => candidate.sheet === sheet.name)?.data ?? [];
      for (const [rowIndex, row] of rows.entries()) {
        for (const [columnIndex, value] of row.entries()) {
          if (values.length >= maximum.maxCells) {break;}
          const normalizedValue = normalizeCell(value);
          values.push({ sourceVersionId, rawValue: String(value ?? ""), normalizedValue, locator: { format: "xlsx", sheetName: sheet.name, cellAddress: `${columnName(columnIndex)}${rowIndex + 1}` }, markers });
        }
      }
    }
  }
  if (names.some((name) => /vbaProject|externalLink/iu.test(name))) {diagnostics.push("active-content");}
  return { sourceVersionId, format: "xlsx", values, diagnostics };
}

function persistTabular(handle: ProjectHandle, region: TabularRegion): TabularRegion {
  if (listSourceRecords(handle, region.sourceVersionId, "tabular").length > 0) {return region;}
  for (const value of region.values) {
    insertSourceRecord(handle, region.sourceVersionId, "tabular", { rawValue: value.rawValue, normalizedValue: value.normalizedValue, formula: value.formula, cachedValue: value.cachedValue, markers: value.markers }, value.locator);
  }
  return region;
}

export async function importStructuredSource(handle: ProjectHandle, sourceVersionId: string, provided: StructuredImportLimits = {}): Promise<BibliographicSourceRecord[] | TabularRegion> {
  const source = getSourceVersion(handle, sourceVersionId);
  const maximum = limits(provided);
  const bytes = readSourceBytes(handle, sourceVersionId);
  if (source.format === "bibtex" || source.format === "ris") {
    const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const records = source.format === "bibtex" ? bibtexRecords(sourceVersionId, input, maximum.maxRecords) : risRecords(sourceVersionId, input, maximum.maxRecords);
    const extraction = insertExtraction(handle, sourceVersionId, null, records.length === 0 ? "partial" : "complete", "biblatex-csl-converter", "3.6.0", "bibliography-entry-v1");
    updateSourceExtractionStatus(handle, sourceVersionId, records.length === 0 ? "partial" : "complete", "biblatex-csl-converter", "3.6.0");
    if (records.length === 0) {addDiagnostic(handle, sourceVersionId, "malformed-record", "warning", "no bibliographic entries were parsed", extraction.id);}
    return persistBibliography(handle, sourceVersionId, records);
  }
  if (source.format === "csv") {
    const region = parseCsvValues(sourceVersionId, new TextDecoder("utf-8", { fatal: true }).decode(bytes), maximum);
    const extraction = insertExtraction(handle, sourceVersionId, region.diagnostics.length === 0 ? null : null, region.diagnostics.length === 0 ? "complete" : "partial", "csv-parse", "7.0.2", "csv-logical-cell-v1");
    updateSourceExtractionStatus(handle, sourceVersionId, region.diagnostics.length === 0 ? "complete" : "partial", "csv-parse", "7.0.2");
    for (const diagnostic of region.diagnostics) {addDiagnostic(handle, sourceVersionId, diagnostic, "warning", `CSV import reported ${diagnostic}`, extraction.id);}
    return persistTabular(handle, region);
  }
  if (source.format === "xlsx") {
    const region = await parseXlsxValues(sourceVersionId, bytes, maximum);
    const extraction = insertExtraction(handle, sourceVersionId, null, region.diagnostics.length === 0 ? "complete" : "partial", "read-excel-file+saxes", "9.3.10+6.0.0", "xlsx-sheet-a1-v1");
    updateSourceExtractionStatus(handle, sourceVersionId, region.diagnostics.length === 0 ? "complete" : "partial", "read-excel-file+saxes", "9.3.10+6.0.0");
    for (const diagnostic of region.diagnostics) {addDiagnostic(handle, sourceVersionId, diagnostic, "warning", `XLSX import reported ${diagnostic}`, extraction.id);}
    return persistTabular(handle, region);
  }
  throw new ProjectStoreError("unsupported-format", "structured import accepts BibTeX, RIS, CSV or XLSX sources");
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
