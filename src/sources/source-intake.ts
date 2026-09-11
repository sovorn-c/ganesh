// story: e06s01
import { basename, resolve } from "node:path";
import { closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { registerArtifactVersion, getArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { pathInside, sha256 } from "../persistence/storage-utils.js";
import type {
  ExtractionDiagnostic,
  SourceImportLimits,
  SourceImportRequest,
  SourceImportResult,
  SourceLocator,
  SourceVersionRecord
} from "./source-types.js";
import {
  assertSourceSchema,
  completeSourceImport,
  failSourceImport,
  getSourceImportOperation,
  getSourceVersion,
  insertPendingImport,
  listSourceDiagnostics,
  sourceRecordExists
} from "./source-store.js";

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const MAX_NAME_LENGTH = 160;

interface StableRead {
  readonly bytes: Uint8Array;
  readonly safeName: string;
}

function deny(code: string, detail: string): never {
  throw new ProjectStoreError(code, detail);
}

function validateCapability(handle: ProjectHandle, capability: unknown, path: string): void {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {
      deny("forbidden", "owner capability does not belong to this project");
    }
    return;
  }
  if (!isWorkerCapability(capability)) {
    deny("forbidden", "source import requires an owner or worker capability");
  }
  if (capability.projectId !== handle.project.id || !capability.canPerform("source:import")) {
    deny("forbidden", "worker capability lacks this project or source:import operation");
  }
  if (!capability.isPathAllowed(path)) {
    deny("forbidden", "worker capability does not authorize this path");
  }
}

function pathIsContained(handle: ProjectHandle, path: string): void {
  const root = realpathSync(handle.project.rootPath);
  const target = realpathSync(path);
  if (!pathInside(root, target)) {
    deny("path-escape", "source path resolves outside the project root");
  }
}

function readStableFile(path: string, maxBytes: number): StableRead {
  const initial = lstatSync(path);
  if (!initial.isFile() || initial.isSymbolicLink()) {
    deny("invalid-source-file", "source path must be a regular non-symlink file");
  }
  if (initial.size > maxBytes) {
    deny("source-too-large", "source file exceeds the configured byte limit");
  }
  const fd = openSync(path, "r");
  try {
    const before = fstatSync(fd);
    const output = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < output.byteLength) {
      const read = readSync(fd, output, offset, output.byteLength - offset, offset);
      if (read === 0) {
        break;
      }
      offset += read;
    }
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ino !== after.ino || offset !== before.size) {
      deny("source-mutated", "source file changed while it was being read");
    }
    return { bytes: output.subarray(0, offset), safeName: basename(path).slice(0, MAX_NAME_LENGTH) };
  } finally {
    closeSync(fd);
  }
}

function payloadHash(request: SourceImportRequest, bytes: Uint8Array): string {
  const identity = JSON.stringify({
    commandId: request.commandId,
    path: resolve(request.path),
    logicalId: request.logicalId,
    version: request.version,
    format: request.format,
    mediaType: request.mediaType,
    contentHash: sha256(bytes)
  });
  return sha256(new TextEncoder().encode(identity));
}

function deterministicVersionId(commandId: string, hash: string): string {
  return `source-version-${sha256(new TextEncoder().encode(`${commandId}:${hash}`))}`;
}

function sourceName(request: SourceImportRequest, safeName: string): string {
  return (request.originalName ?? safeName).replace(/[\\/\u0000-\u001f]/g, "_").slice(0, MAX_NAME_LENGTH);
}

function lineLocators(artifactVersionId: string, text: string, markdown: boolean): SourceLocator[] {
  const locators: SourceLocator[] = [];
  const encoder = new TextEncoder();
  let character = 0;
  let byte = 0;
  let lineNumber = 1;
  const headingStack: string[] = [];
  const occurrences = new Map<string, number>();
  while (character < text.length || (text.length === 0 && lineNumber === 1)) {
    const startCharacter = character;
    let contentEnd = character;
    while (contentEnd < text.length && text[contentEnd] !== "\r" && text[contentEnd] !== "\n") {
      contentEnd += 1;
    }
    let next = contentEnd;
    if (text[next] === "\r" && text[next + 1] === "\n") {
      next += 2;
    } else if (text[next] === "\r" || text[next] === "\n") {
      next += 1;
    }
    const content = text.slice(startCharacter, contentEnd);
    const contentBytes = encoder.encode(content).byteLength;
    const locatorBase = {
      id: `locator-${artifactVersionId}-${lineNumber}`,
      artifactVersionId,
      kind: "line" as const,
      algorithm: "text-line-v1",
      startByte: byte,
      endByte: byte + contentBytes,
      lineNumber
    };
    locators.push(locatorBase);
    if (markdown) {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(content);
      if (match) {
        const level = match[1].length;
        const heading = match[2].trim();
        headingStack.length = level - 1;
        headingStack.push(heading);
        const parent = headingStack.slice(0, -1).join("/");
        const key = `${parent}/${heading}`;
        const occurrence = (occurrences.get(key) ?? 0) + 1;
        occurrences.set(key, occurrence);
        locators.push({
          id: `heading-${artifactVersionId}-${lineNumber}`,
          artifactVersionId,
          kind: "heading",
          algorithm: "markdown-heading-v1",
          startByte: byte,
          endByte: byte + contentBytes,
          lineNumber,
          headingPath: [...headingStack],
          occurrence
        });
      }
    }
    byte += contentBytes + encoder.encode(text.slice(contentEnd, next)).byteLength;
    character = next;
    lineNumber += 1;
  }
  return locators;
}

function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    deny("invalid-utf8", "source bytes are not valid UTF-8");
  }
}

function expectedMediaType(format: SourceImportRequest["format"]): string {
  return {
    text: "text/plain",
    markdown: "text/markdown",
    pdf: "application/pdf",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    bibtex: "application/x-bibtex",
    ris: "application/x-research-info-systems",
    csv: "text/csv",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  }[format];
}

function diagnosticsFor(
  artifactVersionId: string,
  operationId: string,
  request: SourceImportRequest,
  detailLimit: number
): ExtractionDiagnostic[] {
  return [{
    id: `diagnostic-${artifactVersionId}`,
    artifactVersionId,
    operationId,
    code: "local-only-unclassified",
    severity: "info",
    detail: `source ${sourceName(request, basename(request.path)).slice(0, detailLimit)} remains local-only until classified`,
    count: 1
  }];
}

function resultFor(handle: ProjectHandle, commandId: string, source: SourceVersionRecord): SourceImportResult {
  const operation = getSourceImportOperation(handle, commandId);
  return {
    status: operation.status,
    operation,
    source,
    artifactVersionId: source.artifactVersionId,
    diagnostics: listSourceDiagnostics(handle, source.artifactVersionId)
  };
}

export function importLocalSource(
  handle: ProjectHandle,
  capability: unknown,
  request: SourceImportRequest
): SourceImportResult {
  assertWritable(handle);
  assertSourceSchema(handle);
  validateCapability(handle, capability, request.path);
  if (!request.commandId || !request.logicalId || !request.version) {
    deny("invalid-source-request", "commandId, logicalId and version are required");
  }
  const limits: Required<SourceImportLimits> = {
    maxBytes: request.limits?.maxBytes ?? DEFAULT_MAX_BYTES,
    maxDiagnosticCount: request.limits?.maxDiagnosticCount ?? 16,
    maxDiagnosticDetailLength: request.limits?.maxDiagnosticDetailLength ?? 160
  };
  // Resolve and contain the path before opening it. This prevents a parent-directory
  // symlink or an outside realpath from being read before the boundary check.
  pathIsContained(handle, request.path);
  const stable = readStableFile(request.path, limits.maxBytes);
  const bytes = stable.bytes;
  const hash = payloadHash(request, bytes);
  const artifactVersionId = deterministicVersionId(request.commandId, hash);
  const operation = insertPendingImport(handle, request.commandId, hash, artifactVersionId);
  if (operation.status === "complete" && sourceRecordExists(handle, artifactVersionId)) {
    return resultFor(handle, request.commandId, getSourceVersion(handle, artifactVersionId));
  }
  if (operation.status === "failed") {
    handle.db.prepare("UPDATE source_import_operations SET status = 'pending', error_code = NULL, updated_at = ? WHERE command_id = ?").run(new Date().toISOString(), request.commandId);
  }
  const expected = expectedMediaType(request.format);
  if (request.mediaType !== expected) {
    failSourceImport(handle, request.commandId, "unsupported-media");
    deny("unsupported-media", "source media type does not match the declared format");
  }
  let text = "";
  if (request.format === "text" || request.format === "markdown") {
    try {
      text = decodeText(bytes);
    } catch (error) {
      failSourceImport(handle, request.commandId, error instanceof ProjectStoreError ? error.code : "decode-failed");
      throw error;
    }
  }
  let artifact;
  try {
    artifact = getArtifactVersion(handle, artifactVersionId);
  } catch (error) {
    if (!(error instanceof ProjectStoreError) || error.code !== "artifact-not-found") {
      throw error;
    }
    artifact = registerArtifactVersion(handle, {
      logicalId: request.logicalId,
      version: request.version,
      versionId: artifactVersionId,
      content: bytes,
      origin: "local-source",
      access: request.access ?? "full-text"
    });
  }
  const source: SourceVersionRecord = {
    artifactVersionId: artifact.id,
    format: request.format,
    mediaType: request.mediaType,
    originalName: sourceName(request, stable.safeName),
    access: artifact.access,
    extractionStatus: request.format === "text" || request.format === "markdown" ? "complete" : "pending",
    parserName: request.format === "markdown" ? "markdown-text" : request.format === "text" ? "utf8-text" : "pending",
    parserVersion: "1",
    createdAt: new Date().toISOString()
  };
  const diagnostics = diagnosticsFor(artifact.id, request.commandId, request, limits.maxDiagnosticDetailLength).slice(0, limits.maxDiagnosticCount);
  const locators = request.format === "text" || request.format === "markdown"
    ? lineLocators(artifact.id, text, request.format === "markdown")
    : [];
  completeSourceImport(handle, operation, source, locators, diagnostics);
  return resultFor(handle, request.commandId, source);
}

export function inspectSourceImport(handle: ProjectHandle, commandId: string) {
  assertSourceSchema(handle);
  return getSourceImportOperation(handle, commandId);
}
