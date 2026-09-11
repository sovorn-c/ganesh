import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { bytesFor, isoNow, newId, sha256 } from "../persistence/storage-utils.js";
import type { ExternalExtractionRequest, LocatedSourceSegment, SourceExtractionRecord, SourceExtractionStatus, SourceLocator } from "./source-types.js";
import {
  addDiagnostic,
  addSegment,
  getSourceVersion,
  insertExtraction,
  listSourceDiagnostics,
  readSourceBytes,
  updateSourceExtractionStatus
} from "./source-store.js";
import { preflightZip, readZipEntries } from "./archive-preflight.js";
import { assertParserOutput, parserLimits, runBoundedParser, type ParserLimits } from "./parser-worker.js";

export interface DocumentExtractionLimits extends ParserLimits {
  readonly maxArchiveEntries?: number;
  readonly maxExpandedBytes?: number;
  readonly maxCompressionRatio?: number;
}

interface ParsedSegment {
  readonly text: string;
  readonly locator: Omit<SourceLocator, "id" | "artifactVersionId" | "startByte" | "endByte">;
}

type ParserDiagnostic = { code: string; severity: "info" | "warning" | "error"; detail: string };

interface ParsedDocument {
  readonly status: SourceExtractionStatus;
  readonly extractor: string;
  readonly extractorVersion: string;
  readonly locatorAlgorithm: string;
  readonly text: string;
  readonly segments: readonly ParsedSegment[];
  readonly diagnostics: readonly ParserDiagnostic[];
}

export interface DocumentExtractionResult {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly derivedVersionId?: string;
  readonly status: SourceExtractionStatus;
  readonly extractor: string;
  readonly extractorVersion: string;
  readonly locatorAlgorithm: string;
  readonly segments: readonly LocatedSourceSegment[];
  readonly diagnostics: readonly ReturnType<typeof listSourceDiagnostics>[number][];
  readonly createdAt: string;
}

function decodeXml(value: string): string {
  return value.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");
}

function textInXml(xml: string): string {
  return Array.from(xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu), (match) => decodeXml(match[1])).join("");
}

function pdfString(value: string): string {
  return value.replace(/\\([\\()nrt])/gu, (_match, escaped: string) => ({ "n": "\n", "r": "\r", "t": "\t", "\\": "\\", "(": "(", ")": ")" }[escaped] ?? escaped));
}

async function parsePdfWithLibrary(bytes: Uint8Array): Promise<ParsedSegment[]> {
  const task = getDocument({ data: bytes, isEvalSupported: false, disableWorker: true, useSystemFonts: false });
  const document = await task.promise;
  const segments: ParsedSegment[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let itemOrdinal = 0;
      for (const item of content.items) {
        itemOrdinal += 1;
        if (item.str === "") {
          continue;
        }
        segments.push({
          text: item.str,
          locator: { kind: "page", algorithm: "pdf-page-item-v1", pageNumber, itemOrdinal }
        });
        if (item.hasEOL) {
          segments.push({
            text: "\n",
            locator: { kind: "page", algorithm: "pdf-page-item-v1", pageNumber, itemOrdinal }
          });
        }
      }
    }
  } finally {
    await document.destroy();
  }
  return segments;
}

function parsePdfFallback(bytes: Uint8Array): ParsedSegment[] {
  const raw = new TextDecoder("latin1").decode(bytes);
  const strings = Array.from(raw.matchAll(/\(((?:\\.|[^\\)])*)\)\s*T[jJ]/gu), (match) => pdfString(match[1]));
  return strings.filter((text) => text !== "").map((text, index) => ({
    text,
    locator: { kind: "page", algorithm: "pdf-page-item-v1", pageNumber: 1, itemOrdinal: index + 1 }
  }));
}

async function parsePdf(bytes: Uint8Array, limits: DocumentExtractionLimits): Promise<ParsedDocument> {
  const raw = new TextDecoder("latin1").decode(bytes);
  if (!raw.startsWith("%PDF-")) {
    throw new ProjectStoreError("pdf-corrupt", "input does not have a PDF signature");
  }
  const diagnostics: ParserDiagnostic[] = [];
  if (/\/Encrypt\b/iu.test(raw)) {
    throw new ProjectStoreError("pdf-encrypted", "encrypted PDF text extraction is unsupported");
  }
  if (/\/(?:JavaScript|JS|OpenAction|AA)\b/iu.test(raw)) {
    diagnostics.push({ code: "active-content-present", severity: "warning", detail: "PDF active-content markers were detected and were not executed" });
  }
  let segments: ParsedSegment[] = [];
  try {
    segments = await parsePdfWithLibrary(bytes);
  } catch {
    segments = parsePdfFallback(bytes);
  }
  if (segments.length === 0) {
    diagnostics.push({ code: "unsupported-image-only", severity: "warning", detail: "PDF contained no usable embedded text" });
    return { status: "unsupported", extractor: "pdfjs-dist", extractorVersion: "6.3.289", locatorAlgorithm: "pdf-page-item-v1", text: "", segments, diagnostics };
  }
  return {
    status: "complete",
    extractor: "pdfjs-dist",
    extractorVersion: "6.3.289",
    locatorAlgorithm: "pdf-page-item-v1",
    text: segments.map((segment) => segment.text).join(""),
    segments,
    diagnostics
  };
}

function docxDiagnostics(xml: string, names: readonly string[]): ParserDiagnostic[] {
  const diagnostics: ParserDiagnostic[] = [];
  if (names.some((name) => /vbaProject|externalLink|embeddings/i.test(name)) || /TargetMode\s*=\s*["']External|<w:altChunk/iu.test(xml)) {
    diagnostics.push({ code: "active-content-present", severity: "warning", detail: "DOCX active-content or external relationship markers were detected and not executed" });
  }
  if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    throw new ProjectStoreError("xml-doctype", "DOCX XML declarations are unsupported");
  }
  return diagnostics;
}

function parseDocxXml(xml: string, diagnostics: ParserDiagnostic[]): ParsedDocument {
  const segments: ParsedSegment[] = [];
  const tables = Array.from(xml.matchAll(/<w:tbl\b[\s\S]*?<\/w:tbl>/gu), (match) => match[0]);
  const withoutTables = xml.replace(/<w:tbl\b[\s\S]*?<\/w:tbl>/gu, "");
  let paragraphNumber = 0;
  for (const match of withoutTables.matchAll(/<w:p\b[\s\S]*?<\/w:p>/gu)) {
    const text = textInXml(match[0]);
    if (text !== "") {
      paragraphNumber += 1;
      segments.push({ text, locator: { kind: "paragraph", algorithm: "docx-structure-v1", paragraphNumber } });
    }
  }
  let tableNumber = 0;
  for (const table of tables) {
    tableNumber += 1;
    let rowNumber = 0;
    for (const row of table.matchAll(/<w:tr\b[\s\S]*?<\/w:tr>/gu)) {
      rowNumber += 1;
      let cellNumber = 0;
      for (const cell of row[0].matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/gu)) {
        cellNumber += 1;
        const text = textInXml(cell[0]);
        if (text !== "") {
          segments.push({ text, locator: { kind: "table-cell", algorithm: "docx-structure-v1", tableNumber, rowNumber, cellNumber } });
        }
      }
    }
  }
  if (segments.length === 0) {
    diagnostics.push({ code: "unsupported-empty-document", severity: "warning", detail: "DOCX contained no supported paragraph or table text" });
    return { status: "unsupported", extractor: "mammoth", extractorVersion: "1.12.2", locatorAlgorithm: "docx-structure-v1", text: "", segments, diagnostics };
  }
  return {
    status: "complete",
    extractor: "mammoth",
    extractorVersion: "1.12.2",
    locatorAlgorithm: "docx-structure-v1",
    text: segments.map((segment) => segment.text).join("\n"),
    segments,
    diagnostics
  };
}

async function parseDocx(bytes: Uint8Array, limits: DocumentExtractionLimits): Promise<ParsedDocument> {
  const entries = await preflightZip(bytes, {
    maxEntries: limits.maxArchiveEntries,
    maxExpandedBytes: limits.maxExpandedBytes,
    maxCompressionRatio: limits.maxCompressionRatio
  });
  const names = entries.map((entry) => entry.name);
  const selected = await readZipEntries(bytes, ["word/document.xml"], {
    maxEntries: limits.maxArchiveEntries,
    maxExpandedBytes: limits.maxExpandedBytes,
    maxCompressionRatio: limits.maxCompressionRatio
  });
  const document = selected.get("word/document.xml");
  if (document === undefined) {
    throw new ProjectStoreError("docx-missing-document", "DOCX does not contain word/document.xml");
  }
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(document);
  return parseDocxXml(xml, docxDiagnostics(xml, names));
}

function derivedVersionId(sourceVersionId: string, text: string, extractorVersion: string): string {
  return `derived-${sha256(new TextEncoder().encode(`${sourceVersionId}:${extractorVersion}:${text}`))}`;
}

function derivedArtifact(handle: ProjectHandle, sourceVersionId: string, parsed: ParsedDocument): string {
  const id = derivedVersionId(sourceVersionId, parsed.text, parsed.extractorVersion);
  try {
    return getArtifactVersion(handle, id).id;
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "artifact-not-found") {
      throw error;
    }
    return registerArtifactVersion(handle, {
      logicalId: `derived-${sourceVersionId}`,
      version: parsed.extractorVersion,
      versionId: id,
      content: parsed.text,
      origin: "source-extraction",
      dependencies: [{ versionId: sourceVersionId, relation: "derived-from" }]
    }).id;
  }
}

function segmentWithBytes(sourceVersionId: string, derivedId: string, parsed: ParsedDocument): LocatedSourceSegment[] {
  const segments: LocatedSourceSegment[] = [];
  let offset = 0;
  for (const [index, parsedSegment] of parsed.segments.entries()) {
    const bytes = new TextEncoder().encode(parsedSegment.text).byteLength;
    const locator: SourceLocator = {
      id: `segment-locator-${derivedId}-${index + 1}`,
      artifactVersionId: derivedId,
      ...parsedSegment.locator,
      startByte: offset,
      endByte: offset + bytes
    } as SourceLocator;
    segments.push({ id: `segment-${derivedId}-${index + 1}`, sourceVersionId, derivedVersionId: derivedId, locator, text: parsedSegment.text });
    offset += bytes;
  }
  return segments;
}

function failedResult(sourceVersionId: string, parsed: ParsedDocument, handle: ProjectHandle): DocumentExtractionResult {
  const extraction = insertExtraction(handle, sourceVersionId, null, parsed.status, parsed.extractor, parsed.extractorVersion, parsed.locatorAlgorithm);
  for (const diagnostic of parsed.diagnostics) {
    addDiagnostic(handle, sourceVersionId, diagnostic.code, diagnostic.severity, diagnostic.detail, extraction.id);
  }
  updateSourceExtractionStatus(handle, sourceVersionId, parsed.status, parsed.extractor, parsed.extractorVersion);
  return {
    ...extraction,
    status: parsed.status,
    segments: [],
    diagnostics: listSourceDiagnostics(handle, sourceVersionId)
  };
}

export async function extractDocumentSource(
  handle: ProjectHandle,
  sourceVersionId: string,
  limits: DocumentExtractionLimits = {}
): Promise<DocumentExtractionResult> {
  const source = getSourceVersion(handle, sourceVersionId);
  if (source.format !== "pdf" && source.format !== "docx") {
    throw new ProjectStoreError("unsupported-format", "document extraction accepts only PDF and DOCX sources");
  }
  const bytes = readSourceBytes(handle, sourceVersionId);
  let parsed: ParsedDocument;
  try {
    parsed = await runBoundedParser(bytes.byteLength, limits, () => source.format === "pdf" ? parsePdf(bytes, limits) : parseDocx(bytes, limits));
    assertParserOutput(new TextEncoder().encode(parsed.text).byteLength, parsed.segments.length, limits);
  } catch (error) {
    const failure: ParsedDocument = {
      status: "failed", extractor: source.format === "pdf" ? "pdfjs-dist" : "mammoth", extractorVersion: source.format === "pdf" ? "6.3.289" : "1.12.2", locatorAlgorithm: source.format === "pdf" ? "pdf-page-item-v1" : "docx-structure-v1", text: "", segments: [], diagnostics: [{ code: error instanceof ProjectStoreError ? error.code : "parser-failed", severity: "error", detail: error instanceof ProjectStoreError ? error.message : "document parser failed" }]
    };
    return failedResult(sourceVersionId, failure, handle);
  }
  if (parsed.status !== "complete") {
    return failedResult(sourceVersionId, parsed, handle);
  }
  const derivedId = derivedArtifact(handle, sourceVersionId, parsed);
  const segments = segmentWithBytes(sourceVersionId, derivedId, parsed);
  const extraction = insertExtraction(handle, sourceVersionId, derivedId, "complete", parsed.extractor, parsed.extractorVersion, parsed.locatorAlgorithm);
  for (const segment of segments) {
    addSegment(handle, segment);
  }
  for (const diagnostic of parsed.diagnostics) {
    addDiagnostic(handle, sourceVersionId, diagnostic.code, diagnostic.severity, diagnostic.detail, extraction.id);
  }
  updateSourceExtractionStatus(handle, sourceVersionId, "complete", parsed.extractor, parsed.extractorVersion);
  return {
    ...extraction,
    derivedVersionId: derivedId,
    status: "complete",
    segments,
    diagnostics: listSourceDiagnostics(handle, sourceVersionId)
  };
}

function authorizeExternalExtraction(handle: ProjectHandle, capability: unknown): void {
  if (isOwnerCapability(capability) && capability.ownerId === handle.project.ownerId) {
    return;
  }
  if (isWorkerCapability(capability) && capability.projectId === handle.project.id && capability.canPerform("source:import")) {
    return;
  }
  throw new ProjectStoreError("forbidden", "external extraction requires a matching project capability");
}

export function registerExternalExtraction(
  handle: ProjectHandle,
  capability: unknown,
  request: ExternalExtractionRequest
): SourceExtractionRecord {
  assertWritable(handle);
  authorizeExternalExtraction(handle, capability);
  const source = getSourceVersion(handle, request.sourceVersionId);
  const content = bytesFor(request.content);
  const derivedId = `ocr-${sha256(new TextEncoder().encode(`${request.sourceVersionId}:${request.tool}:${request.version}:${sha256(content)}`))}`;
  let artifactId: string;
  try {
    artifactId = getArtifactVersion(handle, derivedId).id;
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "artifact-not-found") {
      throw error;
    }
    artifactId = registerArtifactVersion(handle, {
      logicalId: `derived-${request.sourceVersionId}`,
      version: `ocr-${request.version}`,
      versionId: derivedId,
      content,
      origin: `external-ocr:${request.tool}`,
      access: source.access,
      dependencies: [{ versionId: request.sourceVersionId, relation: "derived-from" }]
    }).id;
  }
  const extraction = insertExtraction(handle, request.sourceVersionId, artifactId, "complete", request.tool, request.version, "external-ocr-v1");
  addDiagnostic(handle, request.sourceVersionId, "external-ocr-provenance", "info", `external OCR supplied by ${request.actor.slice(0, 120)}`, extraction.id);
  updateSourceExtractionStatus(handle, request.sourceVersionId, "complete", request.tool, request.version);
  return extraction;
}
