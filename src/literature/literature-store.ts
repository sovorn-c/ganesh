import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import { assertWritable, type ProjectHandle } from "../project/project-store.js";
import { ProjectStoreError } from "../project/project-types.js";
import { isoNow } from "../persistence/storage-utils.js";
import type {
  CorpusIdentityRequest, CorpusRecord, LandscapeMap, LandscapeMapRequest, LiteratureOrigin, QueryVersion, QueryVersionRequest,
  ReviewProtocol, ReviewProtocolRequest, SpecialistCandidateRequest
} from "./literature-types.js";
import {
  allowed, assertLiteratureSchema, beginOperation, completeOperation, json, optionalText, operation, parse, payloadHash,
  recordId, requireCapability, requireCommand, requireText, resultIdFor, stableObject, text
} from "./literature-utils.js";

function originFor(handle: ProjectHandle, capability: unknown, requested?: LiteratureOrigin): LiteratureOrigin {
  const owner = isOwnerCapability(capability) && capability.ownerId === handle.project.ownerId;
  if (requested === "owner-recorded" && !owner) {throw new ProjectStoreError("forbidden", "only the owner may record owner-origin literature");}
  return owner ? (requested ?? "owner-recorded") : "specialist-proposed";
}

function protocolRow(row: Record<string, unknown>): ReviewProtocol {
  return {
    id: text(row, "id"), versionLabel: text(row, "version_label"), artifactVersionId: text(row, "artifact_version_id"),
    eligibility: parse(row.eligibility, {}), scope: parse(row.scope, {}), origin: text(row, "origin") as LiteratureOrigin, createdAt: text(row, "created_at")
  };
}
function queryRow(row: Record<string, unknown>): QueryVersion {
  const parent = optionalText(row, "parent_query_version_id");
  const supersedes = optionalText(row, "supersedes_query_version_id");
  return {
    id: text(row, "id"), protocolVersionId: text(row, "protocol_version_id"), versionLabel: text(row, "version_label"), expression: text(row, "expression"),
    destination: text(row, "destination"), purpose: text(row, "purpose"), ...(parent ? { parentQueryVersionId: parent } : {}),
    ...(supersedes ? { supersedesQueryVersionId: supersedes } : {}), artifactVersionId: text(row, "artifact_version_id"),
    origin: text(row, "origin") as LiteratureOrigin, createdAt: text(row, "created_at")
  };
}
function landscapeRow(row: Record<string, unknown>): LandscapeMap {
  return {
    id: text(row, "id"), protocolVersionId: text(row, "protocol_version_id"), queryVersionIds: parse(row.query_version_ids, []),
    description: text(row, "description"), searchedAt: text(row, "searched_at"), origin: text(row, "origin") as LiteratureOrigin, createdAt: text(row, "created_at")
  };
}
function corpusRow(row: Record<string, unknown>): CorpusRecord {
  const source = optionalText(row, "source_version_id");
  return {
    id: text(row, "id"), protocolVersionId: text(row, "protocol_version_id"), ...(source ? { sourceVersionId: source } : {}),
    bibliographicIdentity: parse(row.bibliographic_identity, {}), origin: text(row, "origin") as CorpusRecord["origin"], createdAt: text(row, "created_at")
  };
}
function rowById(handle: ProjectHandle, table: string, id: string): Record<string, unknown> {
  const row = handle.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (!row) {throw new ProjectStoreError("literature-not-found", `${table} record was not found`);}
  return row;
}
function existingResult<T>(handle: ProjectHandle, commandId: string, convert: (row: Record<string, unknown>) => T, table: string): T | undefined {
  const op = operation(handle, commandId);
  if (!op || op.status !== "complete") {return undefined;}
  return convert(rowById(handle, table, resultIdFor(handle, commandId)));
}
function ensureCandidateObject(candidate: unknown): Record<string, unknown> {
  const value = stableObject(candidate);
  if (Object.keys(value).length === 0) {throw new ProjectStoreError("invalid-candidate", "specialist candidate payload is required");}
  return value;
}

export function literatureSchemaAvailable(handle: ProjectHandle): boolean {
  try { assertLiteratureSchema(handle); return true; } catch { return false; }
}
export function assertLiteratureStoreSchema(handle: ProjectHandle): void { assertLiteratureSchema(handle); }

export function recordReviewProtocol(handle: ProjectHandle, capability: unknown, request: ReviewProtocolRequest): ReviewProtocol {
  assertWritable(handle); assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:protocol"], "literature protocol recording requires literature:protocol capability");
  const commandId = requireCommand(request.commandId);
  const eligibility = stableObject(request.eligibility);
  if (Object.keys(eligibility).length === 0) {throw new ProjectStoreError("invalid-argument", "eligibility is required");}
  const origin = originFor(handle, capability, request.origin);
  const payload = { id: request.id, versionLabel: request.versionLabel ?? "v1", eligibility, scope: request.scope ?? {}, origin };
  const hash = payloadHash(payload);
  const existing = beginOperation(handle, commandId, hash);
  if (existing?.status === "complete") {return protocolRow(rowById(handle, "review_protocols", resultIdFor(handle, commandId)));}
  const id = recordId("protocol", request.id);
  const versionLabel = request.versionLabel ?? "v1";
  const artifact = registerArtifactVersion(handle, {
    logicalId: `review-protocol-${id}`, version: versionLabel, content: json({ eligibility, scope: request.scope ?? {}, versionLabel }), origin: "literature-review-protocol", access: "metadata-only"
  });
  try {
    const createdAt = isoNow();
    transaction(handle.db, () => handle.db.prepare(
      "INSERT INTO review_protocols (id, version_label, artifact_version_id, eligibility, scope, origin, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, versionLabel, artifact.id, json(eligibility), json(request.scope ?? {}), origin, commandId, createdAt));
    completeOperation(handle, commandId, id, "review-protocol");
    return protocolRow(rowById(handle, "review_protocols", id));
  } catch (error) {
    handle.db.prepare("DELETE FROM artifact_versions WHERE id = ?").run(artifact.id);
    throw error;
  }
}

export function getReviewProtocol(handle: ProjectHandle, capability: unknown, id: string): ReviewProtocol {
  assertLiteratureSchema(handle); if (!allowed(handle, capability, ["literature:inspect"]) && !allowed(handle, capability, ["literature:protocol"]) && !allowed(handle, capability, ["literature:screen"]) && !allowed(handle, capability, ["literature:retrieve"]) && !allowed(handle, capability, ["literature:assess-gap"])) {throw new ProjectStoreError("forbidden", "literature inspection requires a literature capability");}
  return protocolRow(rowById(handle, "review_protocols", id));
}
export function listReviewProtocols(handle: ProjectHandle, capability: unknown): readonly ReviewProtocol[] {
  assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "literature inspection requires literature:inspect capability");
  return (handle.db.prepare("SELECT * FROM review_protocols ORDER BY created_at, id").all() as Array<Record<string, unknown>>).map(protocolRow);
}

export function recordQueryVersion(handle: ProjectHandle, capability: unknown, request: QueryVersionRequest): QueryVersion {
  assertWritable(handle); assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:protocol"], "query recording requires literature:protocol capability");
  const commandId = requireCommand(request.commandId); const expression = requireText(request.expression, "expression");
  const protocol = rowById(handle, "review_protocols", request.protocolVersionId); const origin = originFor(handle, capability, request.origin);
  const payload = { protocolVersionId: request.protocolVersionId, versionLabel: request.versionLabel ?? "v1", expression, destination: request.destination ?? "local", purpose: request.purpose ?? "literature-search", parentQueryVersionId: request.parentQueryVersionId, supersedesQueryVersionId: request.supersedesQueryVersionId, origin };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {return queryRow(rowById(handle, "query_versions", resultIdFor(handle, commandId)));}
  const id = recordId("query", request.id); const versionLabel = request.versionLabel ?? "v1";
  if (request.parentQueryVersionId) {rowById(handle, "query_versions", request.parentQueryVersionId);}
  if (request.supersedesQueryVersionId) {rowById(handle, "query_versions", request.supersedesQueryVersionId);}
  const artifact = registerArtifactVersion(handle, { logicalId: `literature-query-${id}`, version: versionLabel, content: json({ expression, destination: payload.destination, purpose: payload.purpose, protocolVersionId: request.protocolVersionId }), origin: "literature-query", access: "metadata-only" });
  const createdAt = isoNow();
  transaction(handle.db, () => handle.db.prepare(
    "INSERT INTO query_versions (id, protocol_version_id, version_label, expression, destination, purpose, parent_query_version_id, supersedes_query_version_id, artifact_version_id, origin, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, text(protocol, "id"), versionLabel, expression, payload.destination, payload.purpose, request.parentQueryVersionId ?? null, request.supersedesQueryVersionId ?? null, artifact.id, origin, commandId, createdAt));
  completeOperation(handle, commandId, id, "query-version"); return queryRow(rowById(handle, "query_versions", id));
}
export function getQueryVersion(handle: ProjectHandle, capability: unknown, id: string): QueryVersion { assertLiteratureSchema(handle); if (!allowed(handle, capability, ["literature:inspect"]) && !allowed(handle, capability, ["literature:retrieve"]) && !allowed(handle, capability, ["literature:assess-gap"])) {throw new ProjectStoreError("forbidden", "query inspection requires a literature capability");} return queryRow(rowById(handle, "query_versions", id)); }
export function listQueryVersions(handle: ProjectHandle, capability: unknown, protocolVersionId?: string): readonly QueryVersion[] {
  assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "literature inspection requires literature:inspect capability");
  const rows = (protocolVersionId === undefined ? handle.db.prepare("SELECT * FROM query_versions ORDER BY created_at, id").all() : handle.db.prepare("SELECT * FROM query_versions WHERE protocol_version_id = ? ORDER BY created_at, id").all(protocolVersionId)) as Array<Record<string, unknown>>;
  return rows.map(queryRow);
}

export function recordLandscapeMap(handle: ProjectHandle, capability: unknown, request: LandscapeMapRequest): LandscapeMap {
  assertWritable(handle); assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:protocol"], "landscape recording requires literature:protocol capability");
  const commandId = requireCommand(request.commandId); const protocol = rowById(handle, "review_protocols", request.protocolVersionId);
  if (!Array.isArray(request.queryVersionIds) || request.queryVersionIds.length === 0) {throw new ProjectStoreError("invalid-landscape", "landscape maps require query versions");}
  for (const queryId of request.queryVersionIds) {
    const query = rowById(handle, "query_versions", queryId);
    if (text(query, "protocol_version_id") !== text(protocol, "id")) {throw new ProjectStoreError("invalid-landscape", "query version does not belong to the landscape protocol");}
  }
  const description = requireText(request.description, "description"); const origin = originFor(handle, capability, request.origin);
  const payload = { protocolVersionId: request.protocolVersionId, queryVersionIds: request.queryVersionIds, description, searchedAt: request.searchedAt ?? isoNow().slice(0, 10), origin };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {return landscapeRow(rowById(handle, "landscape_maps", resultIdFor(handle, commandId)));}
  const id = recordId("landscape", request.id); const createdAt = isoNow();
  transaction(handle.db, () => handle.db.prepare("INSERT INTO landscape_maps (id, protocol_version_id, query_version_ids, description, searched_at, origin, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(id, text(protocol, "id"), json(request.queryVersionIds), description, payload.searchedAt, origin, commandId, createdAt));
  completeOperation(handle, commandId, id, "landscape-map"); return landscapeRow(rowById(handle, "landscape_maps", id));
}
export function getLandscapeMap(handle: ProjectHandle, capability: unknown, id: string): LandscapeMap { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "landscape inspection requires literature:inspect capability"); return landscapeRow(rowById(handle, "landscape_maps", id)); }
export function listLandscapeMaps(handle: ProjectHandle, capability: unknown): readonly LandscapeMap[] { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "landscape inspection requires literature:inspect capability"); return (handle.db.prepare("SELECT * FROM landscape_maps ORDER BY created_at, id").all() as Array<Record<string, unknown>>).map(landscapeRow); }

export function recordCorpusIdentity(handle: ProjectHandle, capability: unknown, request: CorpusIdentityRequest): CorpusRecord {
  assertWritable(handle); assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:protocol"], "corpus recording requires literature:protocol capability");
  const commandId = requireCommand(request.commandId); rowById(handle, "review_protocols", request.protocolVersionId);
  if (request.sourceVersionId !== undefined && handle.db.prepare("SELECT 1 FROM source_versions WHERE artifact_version_id = ?").get(request.sourceVersionId) === undefined) {throw new ProjectStoreError("source-not-found", "source version was not found");}
  const identity = stableObject(request.bibliographicIdentity); if (Object.keys(identity).length === 0) {throw new ProjectStoreError("invalid-corpus", "bibliographic identity is required");}
  const origin = originFor(handle, capability);
  const payload = { protocolVersionId: request.protocolVersionId, sourceVersionId: request.sourceVersionId, bibliographicIdentity: identity, origin };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {return corpusRow(rowById(handle, "corpus_records", resultIdFor(handle, commandId)));}
  const id = recordId("corpus", request.id); const createdAt = isoNow();
  transaction(handle.db, () => handle.db.prepare("INSERT INTO corpus_records (id, protocol_version_id, source_version_id, bibliographic_identity, origin, created_at, command_id) VALUES (?, ?, ?, ?, ?, ?, ?)").run(id, request.protocolVersionId, request.sourceVersionId ?? null, json(identity), origin, createdAt, commandId));
  completeOperation(handle, commandId, id, "corpus-record"); return corpusRow(rowById(handle, "corpus_records", id));
}
export function getCorpusRecord(handle: ProjectHandle, capability: unknown, id: string): CorpusRecord { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "corpus inspection requires literature:inspect capability"); return corpusRow(rowById(handle, "corpus_records", id)); }
export function listCorpusRecords(handle: ProjectHandle, capability: unknown, protocolVersionId?: string): readonly CorpusRecord[] {
  assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "corpus inspection requires literature:inspect capability");
  const rows = (protocolVersionId === undefined ? handle.db.prepare("SELECT * FROM corpus_records ORDER BY created_at, id").all() : handle.db.prepare("SELECT * FROM corpus_records WHERE protocol_version_id = ? ORDER BY created_at, id").all(protocolVersionId)) as Array<Record<string, unknown>>;
  return rows.map(corpusRow);
}

export function ingestDiscoveryCandidate(handle: ProjectHandle, capability: unknown, request: SpecialistCandidateRequest): ReviewProtocol | QueryVersion {
  const candidate = ensureCandidateObject(request.candidate);
  const kind = String(candidate.kind ?? candidate.type ?? "");
  if (kind === "query" || typeof candidate.expression === "string") {
    const protocolVersionId = String(candidate.protocolVersionId ?? candidate.protocolId ?? "");
    if (!protocolVersionId || typeof candidate.expression !== "string" || !candidate.expression.trim()) {throw new ProjectStoreError("invalid-candidate", "Discovery query candidates require protocolVersionId and expression");}
    return recordQueryVersion(handle, capability, { commandId: request.commandId, protocolVersionId, expression: candidate.expression, versionLabel: typeof candidate.versionLabel === "string" ? candidate.versionLabel : undefined, destination: typeof candidate.destination === "string" ? candidate.destination : undefined, purpose: typeof candidate.purpose === "string" ? candidate.purpose : undefined, origin: "specialist-proposed", candidate });
  }
  const eligibility = stableObject(candidate.eligibility); if (Object.keys(eligibility).length === 0) {throw new ProjectStoreError("invalid-candidate", "Discovery protocol candidates require eligibility");}
  return recordReviewProtocol(handle, capability, { commandId: request.commandId, eligibility, scope: stableObject(candidate.scope), versionLabel: typeof candidate.versionLabel === "string" ? candidate.versionLabel : undefined, origin: "specialist-proposed", candidate });
}

export function inspectLiteratureOperation(handle: ProjectHandle, capability: unknown, commandId: string): import("./literature-types.js").LiteratureOperation {
  assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "literature operation inspection requires literature:inspect capability");
  const found = operation(handle, requireCommand(commandId)); if (!found) {throw new ProjectStoreError("literature-operation-not-found", "literature operation was not found");} return found;
}
