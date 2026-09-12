import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { inspectSource } from "../sources/source-access.js";
import { getSourceVersion, listSourceLocators, listSourceSegments } from "../sources/source-store.js";
import { payloadHash } from "../persistence/history-store.js";
import { sha256, isoNow, newId, stringValue } from "../persistence/storage-utils.js";
import { transaction } from "../persistence/schema.js";
import type {
  EvidenceCandidateRequest,
  EvidenceItem,
  EvidenceItemFilter,
  EvidenceItemRequest,
  EvidenceLocationKind,
  EvidenceLocationRef,
  EvidenceOperation,
  EvidenceStatementKind,
  LocatedExcerptRequest,
  LocatedExcerptResult,
  EvidenceOrigin
} from "./evidence-types.js";

const STATEMENT_KINDS: readonly EvidenceStatementKind[] = ["author-claim", "measured-finding", "inference", "human-interpretation"];

export function evidenceSchemaAvailable(handle: ProjectHandle): boolean {
  const row = handle.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'evidence_items'").get();
  return row !== undefined;
}

export function assertEvidenceSchema(handle: ProjectHandle): void {
  if (!evidenceSchemaAvailable(handle)) {
    throw new ProjectStoreError("evidence-schema-unavailable", "E07 evidence tables are unavailable in this project");
  }
}

function json<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function locationOf(request: { readonly location?: EvidenceLocationRef; readonly locationRef?: EvidenceLocationRef; readonly locationKind?: EvidenceLocationKind; readonly locationId?: string }): EvidenceLocationRef {
  const location = request.location ?? request.locationRef ?? (request.locationKind !== undefined && request.locationId !== undefined
    ? { kind: request.locationKind, id: request.locationId }
    : undefined);
  if (location === undefined || (location.kind !== "source-locator" && location.kind !== "source-segment") || location.id.trim() === "") {
    throw new ProjectStoreError("invalid-location", "a tagged source-locator or source-segment reference is required");
  }
  return location;
}

function operationFromRow(row: Record<string, unknown>): EvidenceOperation {
  return {
    commandId: stringValue(row.command_id, "evidence command id"),
    payloadHash: stringValue(row.payload_hash, "evidence payload hash"),
    ...(typeof row.evidence_item_id === "string" ? { evidenceItemId: row.evidence_item_id } : {}),
    status: stringValue(row.status, "evidence operation status") as EvidenceOperation["status"],
    ...(typeof row.error_code === "string" ? { errorCode: row.error_code } : {}),
    createdAt: stringValue(row.created_at, "evidence operation creation time"),
    updatedAt: stringValue(row.updated_at, "evidence operation update time")
  };
}

function itemFromRow(row: Record<string, unknown>): EvidenceItem {
  const locationKind = stringValue(row.location_kind, "evidence location kind") as EvidenceLocationKind;
  const locator = json<Record<string, unknown>>(row.locator_snapshot, {});
  const excerpt = typeof row.excerpt === "string" ? row.excerpt : undefined;
  const excerptHash = typeof row.excerpt_hash === "string" ? row.excerpt_hash : undefined;
  return {
    id: stringValue(row.id, "evidence item id"),
    sourceVersionId: stringValue(row.source_version_id, "evidence source version id"),
    location: { kind: locationKind, id: stringValue(row.location_id, "evidence location id") },
    locator,
    statementKind: stringValue(row.statement_kind, "evidence statement kind") as EvidenceStatementKind,
    origin: stringValue(row.origin, "evidence origin") as EvidenceOrigin,
    limitations: json<string[]>(row.limitations, []),
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(excerptHash === undefined ? {} : { excerptHash }),
    createdAt: stringValue(row.created_at, "evidence creation time")
  };
}

function allowed(handle: ProjectHandle, capability: unknown, operation: string): boolean {
  if (isOwnerCapability(capability)) {return capability.ownerId === handle.project.ownerId;}
  return isWorkerCapability(capability)
    && capability.projectId === handle.project.id
    && capability.canPerform(operation);
}

function deniedExcerpt(sourceVersionId: string, location: EvidenceLocationRef | undefined, reason: string, limitations: readonly string[] = []): LocatedExcerptResult {
  return { status: "denied", sourceVersionId, ...(location === undefined ? {} : { location }), limitations, reason };
}

function sourceLimitations(inspection: ReturnType<typeof inspectSource>): string[] {
  const limitations = [...inspection.limitations];
  if (inspection.contentStatus !== undefined && inspection.contentStatus !== "available" && !limitations.includes(`integrity-${inspection.contentStatus}`)) {
    limitations.push(`integrity-${inspection.contentStatus}`);
  }
  return limitations;
}

function locationSnapshot(handle: ProjectHandle, sourceVersionId: string, location: EvidenceLocationRef): Record<string, unknown> {
  const source = getSourceVersion(handle, sourceVersionId);
  if (location.kind === "source-locator") {
    if (source.format !== "text" && source.format !== "markdown") {
      throw new ProjectStoreError("invalid-location", "source-locator refs are only valid for text or Markdown sources");
    }
    const locator = listSourceLocators(handle, sourceVersionId).find((candidate) => candidate.id === location.id);
    if (locator === undefined) {throw new ProjectStoreError("location-not-found", "source locator was not found");}
    return { ...locator } as unknown as Record<string, unknown>;
  }
  const segment = listSourceSegments(handle, sourceVersionId).find((candidate) => candidate.id === location.id);
  if (segment === undefined) {throw new ProjectStoreError("location-not-found", "source segment was not found");}
  return { ...segment.locator, segmentId: segment.id } as unknown as Record<string, unknown>;
}

export function readLocatedExcerpt(handle: ProjectHandle, capability: unknown, request: LocatedExcerptRequest): LocatedExcerptResult {
  const location = locationOf(request);
  if (!allowed(handle, capability, "source:inspect")) {
    return deniedExcerpt(request.sourceVersionId, location, "denied: caller lacks current source inspection capability");
  }
  const gate = inspectSource(handle, capability, { sourceVersionId: request.sourceVersionId, includeContent: false });
  if (gate.status === "denied" || gate.source === undefined || gate.integrity !== "verified") {
    return deniedExcerpt(request.sourceVersionId, location, gate.reason ?? "denied: source integrity is not verified", sourceLimitations(gate));
  }
  const limitations = sourceLimitations(gate);
  if (location.kind === "source-segment") {
    const segment = listSourceSegments(handle, request.sourceVersionId).find((candidate) => candidate.id === location.id);
    if (segment === undefined) {return deniedExcerpt(request.sourceVersionId, location, "denied: source segment is unavailable", limitations);}
    const inspected = inspectSource(handle, capability, { sourceVersionId: request.sourceVersionId, locatorId: segment.id, includeContent: true });
    if (inspected.status === "denied" || inspected.content === undefined) {
      return deniedExcerpt(request.sourceVersionId, location, inspected.reason ?? "denied: located segment is unavailable", [...limitations, ...sourceLimitations(inspected)]);
    }
    return { status: "allowed", sourceVersionId: request.sourceVersionId, location, text: inspected.content, locator: { ...segment.locator, segmentId: segment.id }, limitations };
  }
  if (gate.source.format !== "text" && gate.source.format !== "markdown") {
    return deniedExcerpt(request.sourceVersionId, location, "denied: source-locator refs require text or Markdown", limitations);
  }
  const locator = listSourceLocators(handle, request.sourceVersionId).find((candidate) => candidate.id === location.id);
  if (locator === undefined) {return deniedExcerpt(request.sourceVersionId, location, "denied: source locator is unavailable", limitations);}
  const inspected = inspectSource(handle, capability, { sourceVersionId: request.sourceVersionId, includeContent: true });
  if (inspected.status === "denied" || inspected.content === undefined) {
    return deniedExcerpt(request.sourceVersionId, location, inspected.reason ?? "denied: source content is unavailable", [...limitations, ...sourceLimitations(inspected)]);
  }
  try {
    const bytes = new TextEncoder().encode(inspected.content);
    const start = Number(locator.startByte);
    const end = Number(locator.endByte);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > bytes.byteLength) {
      return deniedExcerpt(request.sourceVersionId, location, "denied: locator byte span is invalid", limitations);
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(start, end));
    return { status: "allowed", sourceVersionId: request.sourceVersionId, location, text, locator: { ...locator } as unknown as Record<string, unknown>, limitations };
  } catch {
    return deniedExcerpt(request.sourceVersionId, location, "denied: locator text is not valid UTF-8", limitations);
  }
}

function beginOperation(handle: ProjectHandle, commandId: string, hash: string): EvidenceOperation {
  const existing = handle.db.prepare("SELECT * FROM evidence_operations WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const operation = operationFromRow(existing);
    if (operation.payloadHash !== hash) {throw new ProjectStoreError("evidence-payload-conflict", "command ID was reused with a different payload");}
    return operation;
  }
  const now = isoNow();
  handle.db.prepare("INSERT INTO evidence_operations (command_id, payload_hash, evidence_item_id, status, error_code, created_at, updated_at) VALUES (?, ?, NULL, 'pending', NULL, ?, ?)").run(commandId, hash, now, now);
  return inspectEvidenceOperation(handle, commandId);
}

function failOperation(handle: ProjectHandle, commandId: string, code: string): void {
  handle.db.prepare("UPDATE evidence_operations SET status = 'failed', error_code = ?, updated_at = ? WHERE command_id = ?").run(code, isoNow(), commandId);
}

export function inspectEvidenceOperation(handle: ProjectHandle, commandId: string): EvidenceOperation {
  assertEvidenceSchema(handle);
  const row = handle.db.prepare("SELECT * FROM evidence_operations WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  if (row === undefined) {throw new ProjectStoreError("evidence-operation-not-found", "evidence operation was not found");}
  return operationFromRow(row);
}

export function recordEvidenceItem(handle: ProjectHandle, capability: unknown, request: EvidenceItemRequest): EvidenceItem {
  assertWritable(handle);
  assertEvidenceSchema(handle);
  if (!allowed(handle, capability, "evidence:record") && !isOwnerCapability(capability)) {throw new ProjectStoreError("forbidden", "evidence recording requires evidence:record capability");}
  if (isOwnerCapability(capability) && capability.ownerId !== handle.project.ownerId) {throw new ProjectStoreError("forbidden", "owner capability belongs to another project");}
  if (request.statementKind === undefined || !STATEMENT_KINDS.includes(request.statementKind)) {throw new ProjectStoreError("invalid-statement-kind", "unsupported evidence statement kind");}
  const location = locationOf(request);
  const origin: EvidenceOrigin = request.origin ?? (isOwnerCapability(capability) ? "owner-recorded" : "specialist-proposed");
  if (origin === "owner-recorded" && !isOwnerCapability(capability)) {throw new ProjectStoreError("forbidden", "only the owner may record owner-origin evidence");}
  if (!request.commandId) {throw new ProjectStoreError("invalid-command", "commandId is required");}
  const hash = payloadHash(request);
  const existing = handle.db.prepare("SELECT * FROM evidence_operations WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const operation = operationFromRow(existing);
    if (operation.payloadHash !== hash) {throw new ProjectStoreError("evidence-payload-conflict", "command ID was reused with a different payload");}
    if (operation.evidenceItemId !== undefined && operation.status === "complete") {return getEvidenceItem(handle, capability, operation.evidenceItemId);}
  }
  beginOperation(handle, request.commandId, hash);
  try {
    const inspection = inspectSource(handle, capability, { sourceVersionId: request.sourceVersionId, includeContent: false });
    if (inspection.status === "denied" || inspection.source === undefined) {throw new ProjectStoreError("source-inspection-denied", inspection.reason ?? "source inspection was denied");}
    const locator = locationSnapshot(handle, request.sourceVersionId, location);
    const wantsExcerpt = request.includeExcerpt === true || request.excerpt !== undefined;
    let excerpt: string | undefined;
    let limitations = sourceLimitations(inspection);
    if (wantsExcerpt) {
      const located = readLocatedExcerpt(handle, capability, { sourceVersionId: request.sourceVersionId, location });
      if (located.status !== "allowed" || located.text === undefined) {throw new ProjectStoreError("excerpt-unavailable", located.reason ?? "located excerpt is unavailable");}
      if (request.excerpt !== undefined && request.excerpt !== located.text) {throw new ProjectStoreError("excerpt-mismatch", "stored excerpt must equal readLocatedExcerpt text");}
      excerpt = located.text;
      limitations = [...new Set([...limitations, ...located.limitations])];
    }
    const itemId = newId("evidence");
    const createdAt = isoNow();
    transaction(handle.db, () => {
      handle.db.prepare("INSERT INTO evidence_items (id, source_version_id, location_kind, location_id, locator_snapshot, statement_kind, origin, limitations, excerpt, excerpt_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(itemId, request.sourceVersionId, location.kind, location.id, JSON.stringify(locator), request.statementKind, origin, JSON.stringify([...new Set(limitations)]), excerpt ?? null, excerpt === undefined ? null : sha256(new TextEncoder().encode(excerpt)), createdAt);
      handle.db.prepare("UPDATE evidence_operations SET evidence_item_id = ?, status = 'complete', error_code = NULL, updated_at = ? WHERE command_id = ?").run(itemId, createdAt, request.commandId);
    });
    return getEvidenceItem(handle, capability, itemId);
  } catch (error) {
    const code = error instanceof ProjectStoreError ? error.code : "evidence-record-failed";
    failOperation(handle, request.commandId, code);
    throw error;
  }
}

export function ingestEvidenceCandidate(handle: ProjectHandle, capability: unknown, request: EvidenceCandidateRequest): EvidenceItem {
  const payload = request.candidate ?? request.payload ?? {};
  const sourceVersionId = request.sourceVersionId ?? payload.sourceVersionId ?? payload.sourceVersionIds?.[0];
  if (sourceVersionId === undefined) {throw new ProjectStoreError("invalid-candidate", "candidate has no source version");}
  const location = (request.location ?? (request.locationRef as EvidenceLocationRef | undefined) ?? (request.locationKind !== undefined && request.locationId !== undefined
    ? { kind: request.locationKind, id: request.locationId }
    : (payload.location ?? payload.locationRef))) as EvidenceLocationRef | undefined;
  const statementKind = request.statementKind ?? payload.statementKind;
  if (statementKind === undefined) {throw new ProjectStoreError("invalid-candidate", "candidate has no statement kind");}
  return recordEvidenceItem(handle, capability, {
    commandId: request.commandId,
    sourceVersionId,
    ...(location === undefined ? {} : { location }),
    statementKind,
    origin: "specialist-proposed",
    includeExcerpt: request.includeExcerpt ?? payload.includeExcerpt ?? payload.excerpt !== undefined,
    ...(payload.excerpt === undefined ? {} : { excerpt: payload.excerpt })
  });
}

export function getEvidenceItem(handle: ProjectHandle, capability: unknown, evidenceItemId: string): EvidenceItem {
  assertEvidenceSchema(handle);
  if (!allowed(handle, capability, "evidence:inspect")) {throw new ProjectStoreError("forbidden", "evidence inspection requires evidence:inspect capability");}
  const row = handle.db.prepare("SELECT * FROM evidence_items WHERE id = ?").get(evidenceItemId) as Record<string, unknown> | undefined;
  if (row === undefined) {throw new ProjectStoreError("evidence-not-found", "evidence item was not found");}
  return itemFromRow(row);
}

export function listEvidenceItems(handle: ProjectHandle, capability: unknown, filter: EvidenceItemFilter = {}): readonly EvidenceItem[] {
  assertEvidenceSchema(handle);
  if (!allowed(handle, capability, "evidence:inspect")) {throw new ProjectStoreError("forbidden", "evidence inspection requires evidence:inspect capability");}
  const clauses: string[] = [];
  const values: string[] = [];
  if (filter.sourceVersionId !== undefined) { clauses.push("source_version_id = ?"); values.push(filter.sourceVersionId); }
  if (filter.statementKind !== undefined) { clauses.push("statement_kind = ?"); values.push(filter.statementKind); }
  if (filter.origin !== undefined) { clauses.push("origin = ?"); values.push(filter.origin); }
  const sql = `SELECT * FROM evidence_items${clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`} ORDER BY created_at, id`;
  return (handle.db.prepare(sql).all(...values) as Array<Record<string, unknown>>).map(itemFromRow);
}
