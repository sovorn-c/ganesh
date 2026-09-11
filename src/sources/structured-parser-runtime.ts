// story: e06s03
import { parse as parseCsv } from "csv-parse/sync";
import { parse as parseBiblatex, parseRIS } from "biblatex-csl-converter";
import { SaxesParser } from "saxes";
import { ProjectStoreError } from "../project/project-types.js";
import { preflightZip, readZipEntries } from "./archive-preflight.js";
import type { BibliographicSourceRecord, StructuredImportLimits, TabularRegion, TabularValue } from "./structured-types.js";

export interface BibliographyResult {
  readonly kind: "bibliography";
  readonly records: BibliographicSourceRecord[];
  readonly diagnostics: readonly string[];
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

export function canonicalDoi(value: string): string | undefined {
  const candidate = value.trim().replace(/^doi:\s*/iu, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate).normalize("NFC").toLowerCase();
  } catch {
    return undefined;
  }
  return /^10\.\d{4,9}\/\S+$/u.test(decoded) && !/[\s\u0000-\u001f]/u.test(decoded) ? decoded : undefined;
}

function readBibtexValue(input: string, start: number): { value: string; next: number } | undefined {
  if (input[start] === "{") {
    let depth = 1;
    let escaped = false;
    for (let index = start + 1; index < input.length; index += 1) {
      const character = input[index];
      if (escaped) {escaped = false; continue;}
      if (character === "\\") {escaped = true; continue;}
      if (character === "{") {depth += 1; continue;}
      if (character === "}") {
        depth -= 1;
        if (depth === 0) {return { value: input.slice(start + 1, index).trim(), next: index + 1 };}
      }
    }
    return undefined;
  }
  if (input[start] === '"') {
    let escaped = false;
    for (let index = start + 1; index < input.length; index += 1) {
      const character = input[index];
      if (escaped) {escaped = false; continue;}
      if (character === "\\") {escaped = true; continue;}
      if (character === '"') {return { value: input.slice(start + 1, index).trim(), next: index + 1 };}
    }
    return undefined;
  }
  const end = input.slice(start).search(/[,}\n]/u);
  return { value: input.slice(start, end < 0 ? input.length : start + end).trim(), next: end < 0 ? input.length : start + end };
}

function rawBibtexFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let index = body.indexOf(",");
  if (index < 0) {return fields;}
  index += 1;
  while (index < body.length) {
    while (/\s|,/u.test(body[index] ?? "")) {index += 1;}
    const key = /^[A-Za-z][\w-]*/u.exec(body.slice(index));
    if (key === null) {break;}
    index += key[0].length;
    while (/\s/u.test(body[index] ?? "")) {index += 1;}
    if (body[index] !== "=") {break;}
    index += 1;
    while (/\s/u.test(body[index] ?? "")) {index += 1;}
    const value = readBibtexValue(body, index);
    if (value === undefined) {break;}
    fields[key[0].toLowerCase()] = value.value;
    index = value.next;
  }
  return fields;
}

function bibtexRecords(sourceVersionId: string, input: string, maximum: Required<StructuredImportLimits>): BibliographyResult {
  const parsed = parseBiblatex(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const records: BibliographicSourceRecord[] = [];
  let recordNumber = 0;
  let totalFields = 0;
  let truncated = false;
  for (const entry of entries) {
    if (recordNumber >= maximum.maxRecords) {truncated = true; break;}
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
  return { kind: "bibliography", records, diagnostics: truncated ? ["record-limit"] : [] };
}

function risRecords(sourceVersionId: string, input: string, maximum: Required<StructuredImportLimits>): BibliographyResult {
  const parsed = parseRIS(input);
  const entries = Object.values(parsed.entries) as unknown as Array<Record<string, unknown>>;
  const groups = input.split(/(?:^|\n)ER\s*[- ]\s*/gu).filter((value) => value.trim() !== "");
  let totalFields = 0;
  const records: BibliographicSourceRecord[] = entries.slice(0, maximum.maxRecords).map((entry, index) => {
    const rawFields: Record<string, string> = {};
    for (const match of (groups[index] ?? "").matchAll(/^([A-Z0-9]{2})\s{2}-\s?(.*)$/gmu)) {
      rawFields[match[1]] = rawFields[match[1]] === undefined ? match[2].trim() : `${rawFields[match[1]]}\n${match[2].trim()}`;
    }
    totalFields = enforceFieldLimits(rawFields, maximum, totalFields);
    const doi = canonicalDoi(rawFields.DO ?? rawFields.DOI ?? "");
    const normalizedIdentifiers: Record<string, string> = {};
    if (doi !== undefined) {normalizedIdentifiers.doi = doi;}
    const recordNumber = index + 1;
    return { id: `bibliography-${sourceVersionId}-${recordNumber}`, sourceVersionId, format: "ris" as const, entryKey: text(entry.entry_key), recordNumber, rawFields, normalizedIdentifiers, access: "metadata-only" as const, locator: { format: "ris", recordNumber, tags: Object.keys(rawFields).sort() } };
  });
  return { kind: "bibliography", records, diagnostics: entries.length > maximum.maxRecords ? ["record-limit"] : [] };
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

interface WorkbookSheet {
  readonly name: string;
  readonly relationshipId: string;
}

function xmlAttribute(attributes: Record<string, unknown>, name: string): string | undefined {
  const value = attributes[name];
  return value === undefined ? undefined : String(value);
}

function parseWorkbookSheets(xml: string): WorkbookSheet[] {
  validateWorksheetXml(xml);
  const sheets: WorkbookSheet[] = [];
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    if (String(tag.name).toLowerCase() !== "sheet") {return;}
    const attributes = tag.attributes as Record<string, unknown>;
    const name = xmlAttribute(attributes, "name");
    const relationshipId = xmlAttribute(attributes, "r:id") ?? xmlAttribute(attributes, "id");
    if (name !== undefined && relationshipId !== undefined) {
      sheets.push({ name, relationshipId });
    }
  });
  parser.on("error", () => {
    throw new ProjectStoreError("xml-malformed", "OOXML workbook XML is malformed");
  });
  parser.write(xml).close();
  return sheets;
}

function decodeXmlAttribute(value: string): string {
  return value.replace(/&amp;/gu, "&").replace(/&quot;/gu, '"').replace(/&apos;/gu, "'").replace(/&lt;/gu, "<").replace(/&gt;/gu, ">");
}

function parseWorkbookRelationships(xml: string): Map<string, string> {
  validateWorksheetXml(xml);
  const relationships = new Map<string, string>();
  const parser = new SaxesParser({ xmlns: false });
  parser.on("opentag", (tag) => {
    if (String(tag.name).toLowerCase() !== "relationship") {return;}
    const attributes = tag.attributes as Record<string, unknown>;
    const id = xmlAttribute(attributes, "Id");
    const target = xmlAttribute(attributes, "Target");
    const targetMode = xmlAttribute(attributes, "TargetMode");
    if (id !== undefined && target !== undefined && targetMode?.toLowerCase() !== "external") {
      relationships.set(id, decodeXmlAttribute(target));
    }
  });
  parser.on("error", () => {
    throw new ProjectStoreError("xml-malformed", "OOXML relationship XML is malformed");
  });
  parser.write(xml).close();
  return relationships;
}

function resolveZipTarget(baseName: string, target: string): string | undefined {
  const parts = baseName.split("/").slice(0, -1);
  for (const segment of target.replace(/^\/+/, "").split("/")) {
    if (segment === "" || segment === ".") {continue;}
    if (segment === "..") {
      if (parts.length === 0) {return undefined;}
      parts.pop();
    } else {
      parts.push(segment);
    }
  }
  return parts.length === 0 ? undefined : parts.join("/");
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
  const workbookRelationships = parseWorkbookRelationships(new TextDecoder().decode(selected.get("xl/_rels/workbook.xml.rels") ?? new Uint8Array()));
  const sharedStrings = sharedStringsFromXml(new TextDecoder().decode(selected.get("xl/sharedStrings.xml") ?? new Uint8Array()));
  const sheetNames = parseWorkbookSheets(workbook);
  const values: TabularValue[] = [];
  const diagnostics: string[] = [];
  for (const sheet of sheetNames) {
    if (values.length >= maximum.maxCells) {
      diagnostics.push("cell-limit");
      break;
    }
    const sheetPath = workbookRelationships.has(sheet.relationshipId)
      ? resolveZipTarget("xl/workbook.xml", workbookRelationships.get(sheet.relationshipId) ?? "")
      : undefined;
    const sheetBytes = sheetPath === undefined ? undefined : selected.get(sheetPath);
    if (sheetBytes === undefined) {
      diagnostics.push("worksheet-relationship-missing");
      continue;
    }
    const xml = new TextDecoder().decode(sheetBytes);
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/gu;
    validateWorksheetXml(xml);
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
  }
  if (markers.includes("active-content") || markers.includes("external-relationship")) {diagnostics.push("active-content");}
  return { sourceVersionId, format: "xlsx", values, diagnostics: [...new Set(diagnostics)] };
}

export async function parseStructuredPayload(
  sourceVersionId: string,
  format: "bibtex" | "ris" | "csv" | "xlsx",
  bytes: Uint8Array,
  maximum: Required<StructuredImportLimits>
): Promise<BibliographyResult | TabularRegion> {
  if (format === "bibtex" || format === "ris") {
    const input = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return format === "bibtex" ? bibtexRecords(sourceVersionId, input, maximum) : risRecords(sourceVersionId, input, maximum);
  }
  if (format === "csv") {
    return parseCsvValues(sourceVersionId, new TextDecoder("utf-8", { fatal: true }).decode(bytes), maximum);
  }
  return await parseXlsxValues(sourceVersionId, bytes, maximum);
}
