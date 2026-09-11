// story: e06s01
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  ProjectStoreError,
  type ArtifactAccess,
  type ProjectHandle
} from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId, stringValue } from "../persistence/storage-utils.js";
import type {
  ExtractionDiagnostic,
  LocatedSourceSegment,
  SourceDiagnosticSeverity,
  SourceExtractionRecord,
  SourceExtractionStatus,
  SourceFormat,
  SourceImportOperation,
  SourceImportStatus,
  SourceLocator,
  SourceVersionRecord
} from "./source-types.js";

export function sourceSchemaAvailable(handle: ProjectHandle): boolean {
  const row = handle.db.prepare(
    "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'source_versions'"
  ).get() as { present?: unknown } | undefined;
  return row !== undefined;
}

export function assertSourceSchema(handle: ProjectHandle): void {
  if (!sourceSchemaAvailable(handle)) {
    throw new ProjectStoreError("source-schema-unavailable", "source intake tables are unavailable in this project");
  }
}

function rowText(row: Record<string, unknown>, name: string): string {
  return stringValue(row[name], name);
}

function sourceFromRow(row: Record<string, unknown>): SourceVersionRecord {
  return {
    artifactVersionId: rowText(row, "artifact_version_id"),
    format: rowText(row, "format") as SourceFormat,
    mediaType: rowText(row, "media_type"),
    originalName: rowText(row, "original_name"),
    access: rowText(row, "access_level") as ArtifactAccess,
    extractionStatus: rowText(row, "extraction_status") as SourceExtractionStatus,
    parserName: rowText(row, "parser_name"),
    parserVersion: rowText(row, "parser_version"),
    createdAt: rowText(row, "created_at")
  };
}

function operationFromRow(row: Record<string, unknown>): SourceImportOperation {
  const errorCode = typeof row.error_code === "string" ? row.error_code : undefined;
  return {
    commandId: rowText(row, "command_id"),
    payloadHash: rowText(row, "payload_hash"),
    artifactVersionId: rowText(row, "artifact_version_id"),
    status: rowText(row, "status") as SourceImportStatus,
    ...(errorCode === undefined ? {} : { errorCode }),
    createdAt: rowText(row, "created_at"),
    updatedAt: rowText(row, "updated_at")
  };
}

export function getSourceVersion(handle: ProjectHandle, artifactVersionId: string): SourceVersionRecord {
  assertSourceSchema(handle);
  const row = handle.db.prepare("SELECT * FROM source_versions WHERE artifact_version_id = ?").get(artifactVersionId) as Record<string, unknown> | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("source-not-found", `source version ${artifactVersionId} was not found`);
  }
  return sourceFromRow(row);
}

export function getSourceImportOperation(handle: ProjectHandle, commandId: string): SourceImportOperation {
  assertSourceSchema(handle);
  const row = handle.db.prepare("SELECT * FROM source_import_operations WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("source-operation-not-found", `source import operation ${commandId} was not found`);
  }
  return operationFromRow(row);
}

export function listSourceLocators(handle: ProjectHandle, artifactVersionId: string): readonly SourceLocator[] {
  assertSourceSchema(handle);
  const rows = handle.db.prepare(
    "SELECT * FROM source_locators WHERE artifact_version_id = ? ORDER BY start_byte, id"
  ).all(artifactVersionId) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    let coordinates: Record<string, unknown> = {};
    try {
      coordinates = JSON.parse(rowText(row, "coordinates")) as Record<string, unknown>;
    } catch {
      throw new ProjectStoreError("invalid-record", "source locator coordinates are invalid");
    }
    return {
      id: rowText(row, "id"),
      artifactVersionId: rowText(row, "artifact_version_id"),
      kind: rowText(row, "kind") as SourceLocator["kind"],
      algorithm: rowText(row, "algorithm"),
      startByte: Number(row.start_byte),
      endByte: Number(row.end_byte),
      ...coordinates,
      ...(typeof row.raw_value === "string" ? { rawValue: row.raw_value } : {})
    } as SourceLocator;
  });
}

export function listSourceDiagnostics(handle: ProjectHandle, artifactVersionId: string): readonly ExtractionDiagnostic[] {
  assertSourceSchema(handle);
  const rows = handle.db.prepare(
    "SELECT * FROM source_diagnostics WHERE artifact_version_id = ? ORDER BY created_at, id"
  ).all(artifactVersionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: rowText(row, "id"),
    artifactVersionId: rowText(row, "artifact_version_id"),
    ...(typeof row.operation_id === "string" ? { operationId: row.operation_id } : {}),
    code: rowText(row, "code"),
    severity: rowText(row, "severity") as SourceDiagnosticSeverity,
    detail: rowText(row, "detail"),
    count: Number(row.count)
  }));
}

export function listSourceSegments(handle: ProjectHandle, sourceVersionId: string): readonly LocatedSourceSegment[] {
  assertSourceSchema(handle);
  const rows = handle.db.prepare(
    "SELECT * FROM source_segments WHERE source_version_id = ? ORDER BY id"
  ).all(sourceVersionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: rowText(row, "id"),
    sourceVersionId: rowText(row, "source_version_id"),
    derivedVersionId: rowText(row, "derived_version_id"),
    locator: JSON.parse(rowText(row, "locator")) as SourceLocator,
    text: rowText(row, "text")
  }));
}

export function insertSourceRecord(handle: ProjectHandle, sourceVersionId: string, recordKind: string, data: Record<string, unknown>, locator: Record<string, unknown>, access: ArtifactAccess = "metadata-only"): string {
  assertWritable(handle);
  const id = newId("source-record");
  handle.db.prepare(
    "INSERT INTO source_records (id, source_version_id, record_kind, record_data, locator, access_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, sourceVersionId, recordKind, JSON.stringify(data), JSON.stringify(locator), access, isoNow());
  return id;
}

export function listSourceRecords(handle: ProjectHandle, sourceVersionId: string, recordKind?: string): readonly Record<string, unknown>[] {
  assertSourceSchema(handle);
  const rows = recordKind === undefined
    ? handle.db.prepare("SELECT * FROM source_records WHERE source_version_id = ? ORDER BY id").all(sourceVersionId)
    : handle.db.prepare("SELECT * FROM source_records WHERE source_version_id = ? AND record_kind = ? ORDER BY id").all(sourceVersionId, recordKind);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    id: rowText(row, "id"),
    sourceVersionId: rowText(row, "source_version_id"),
    recordKind: rowText(row, "record_kind"),
    data: JSON.parse(rowText(row, "record_data")) as Record<string, unknown>,
    locator: JSON.parse(rowText(row, "locator")) as Record<string, unknown>,
    access: rowText(row, "access_level") as ArtifactAccess,
    createdAt: rowText(row, "created_at")
  }));
}

export function listSourceExtractions(handle: ProjectHandle, sourceVersionId: string): readonly SourceExtractionRecord[] {
  assertSourceSchema(handle);
  const rows = handle.db.prepare(
    "SELECT * FROM source_extractions WHERE source_version_id = ? ORDER BY created_at, id"
  ).all(sourceVersionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: rowText(row, "id"),
    sourceVersionId: rowText(row, "source_version_id"),
    ...(typeof row.derived_version_id === "string" ? { derivedVersionId: row.derived_version_id } : {}),
    status: rowText(row, "status") as SourceExtractionStatus,
    extractor: rowText(row, "extractor"),
    extractorVersion: rowText(row, "extractor_version"),
    locatorAlgorithm: rowText(row, "locator_algorithm"),
    createdAt: rowText(row, "created_at")
  }));
}

export function readSourceBytes(handle: ProjectHandle, artifactVersionId: string): Uint8Array {
  const inspection = inspectArtifactVersion(handle, artifactVersionId);
  if (inspection.contentStatus !== "available" || inspection.storagePath === null) {
    throw new ProjectStoreError("source-content-unavailable", inspection.detail);
  }
  return readFileSync(inspection.storagePath);
}

export function insertPendingImport(
  handle: ProjectHandle,
  commandId: string,
  payloadHash: string,
  artifactVersionId: string
): SourceImportOperation {
  assertWritable(handle);
  assertSourceSchema(handle);
  const existing = handle.db.prepare("SELECT * FROM source_import_operations WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const operation = operationFromRow(existing);
    if (operation.payloadHash !== payloadHash) {
      throw new ProjectStoreError("source-payload-conflict", "command ID was reused with a different payload");
    }
    return operation;
  }
  const now = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare(
      "INSERT INTO source_import_operations (command_id, payload_hash, artifact_version_id, status, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?)"
    ).run(commandId, payloadHash, artifactVersionId, now, now);
  });
  return getSourceImportOperation(handle, commandId);
}

export function completeSourceImport(
  handle: ProjectHandle,
  operation: SourceImportOperation,
  source: SourceVersionRecord,
  locators: readonly SourceLocator[],
  diagnostics: readonly ExtractionDiagnostic[]
): void {
  assertWritable(handle);
  const now = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare(
      `INSERT INTO source_versions (artifact_version_id, format, media_type, original_name, access_level, extraction_status, parser_name, parser_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(source.artifactVersionId, source.format, source.mediaType, source.originalName, source.access, source.extractionStatus, source.parserName, source.parserVersion, source.createdAt);
    const locatorStatement = handle.db.prepare(
      "INSERT INTO source_locators (id, artifact_version_id, kind, algorithm, start_byte, end_byte, coordinates, raw_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const locator of locators) {
      const { id, artifactVersionId, kind, algorithm, startByte, endByte, rawValue, ...coordinates } = locator;
      locatorStatement.run(id, artifactVersionId, kind, algorithm, startByte, endByte, JSON.stringify(coordinates), rawValue ?? null);
    }
    const diagnosticStatement = handle.db.prepare(
      "INSERT INTO source_diagnostics (id, artifact_version_id, operation_id, code, severity, detail, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    );
    for (const diagnostic of diagnostics) {
      diagnosticStatement.run(diagnostic.id, source.artifactVersionId, operation.commandId, diagnostic.code, diagnostic.severity, diagnostic.detail, diagnostic.count, now);
    }
    handle.db.prepare(
      "UPDATE source_import_operations SET status = 'complete', error_code = NULL, updated_at = ? WHERE command_id = ?"
    ).run(now, operation.commandId);
  });
}

export function failSourceImport(handle: ProjectHandle, commandId: string, errorCode: string): void {
  assertWritable(handle);
  handle.db.prepare(
    "UPDATE source_import_operations SET status = 'failed', error_code = ?, updated_at = ? WHERE command_id = ?"
  ).run(errorCode, isoNow(), commandId);
}

export function sourceRecordExists(handle: ProjectHandle, artifactVersionId: string): boolean {
  assertSourceSchema(handle);
  return handle.db.prepare("SELECT 1 AS present FROM source_versions WHERE artifact_version_id = ?").get(artifactVersionId) !== undefined;
}

export function updateSourceExtractionStatus(handle: ProjectHandle, sourceVersionId: string, status: SourceExtractionStatus, parserName: string, parserVersion: string): void {
  assertWritable(handle);
  handle.db.prepare(
    "UPDATE source_versions SET extraction_status = ?, parser_name = ?, parser_version = ? WHERE artifact_version_id = ?"
  ).run(status, parserName, parserVersion, sourceVersionId);
}

export function insertExtraction(
  handle: ProjectHandle,
  sourceVersionId: string,
  derivedVersionId: string | null,
  status: SourceExtractionStatus,
  extractor: string,
  extractorVersion: string,
  locatorAlgorithm: string
): SourceExtractionRecord {
  assertWritable(handle);
  const record: SourceExtractionRecord = {
    id: newId("extraction"),
    sourceVersionId,
    ...(derivedVersionId === null ? {} : { derivedVersionId }),
    status,
    extractor,
    extractorVersion,
    locatorAlgorithm,
    createdAt: isoNow()
  };
  handle.db.prepare(
    "INSERT INTO source_extractions (id, source_version_id, derived_version_id, status, extractor, extractor_version, locator_algorithm, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(record.id, sourceVersionId, derivedVersionId, status, extractor, extractorVersion, locatorAlgorithm, record.createdAt);
  return record;
}

export function addDiagnostic(
  handle: ProjectHandle,
  artifactVersionId: string,
  code: string,
  severity: SourceDiagnosticSeverity,
  detail: string,
  operationId?: string
): ExtractionDiagnostic {
  const diagnostic: ExtractionDiagnostic = {
    id: newId("diagnostic"),
    artifactVersionId,
    ...(operationId === undefined ? {} : { operationId }),
    code,
    severity,
    detail,
    count: 1
  };
  handle.db.prepare(
    "INSERT INTO source_diagnostics (id, artifact_version_id, operation_id, code, severity, detail, count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(diagnostic.id, artifactVersionId, operationId ?? null, code, severity, detail, 1, isoNow());
  return diagnostic;
}

export function addSegment(handle: ProjectHandle, segment: LocatedSourceSegment): void {
  handle.db.prepare(
    "INSERT INTO source_segments (id, source_version_id, derived_version_id, locator, text) VALUES (?, ?, ?, ?, ?)"
  ).run(segment.id, segment.sourceVersionId, segment.derivedVersionId, JSON.stringify(segment.locator), segment.text);
}

export function db(handle: ProjectHandle): DatabaseSync {
  return handle.db;
}
