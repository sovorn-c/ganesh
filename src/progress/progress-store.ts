import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type {
  ProgressCorrectionRequest,
  ProgressQuery,
  ProgressRecord,
  ProgressRecordRequest
} from "./progress-types.js";
import {
  assertActivity,
  assertBranch,
  assertProgressAccess,
  assertProgressSchema,
  hashPayload,
  isoNow,
  newId,
  optionalText,
  requiredText,
  resolveAttribution,
  resolveOrigin
} from "./progress-utils.js";

function progressFromRow(row: Record<string, unknown>): ProgressRecord {
  return {
    id: String(row.id),
    protocolVersionId: String(row.protocol_version_id),
    summary: String(row.summary),
    occurredOn: row.occurred_on ? String(row.occurred_on) : undefined,
    activity: row.activity ? String(row.activity) as ProgressRecord["activity"] : undefined,
    attribution: String(row.attribution) as ProgressRecord["attribution"],
    origin: String(row.origin) as ProgressRecord["origin"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: String(row.branch_id),
    retrospective: Number(row.retrospective) === 1,
    correctsProgressId: row.corrects_progress_id ? String(row.corrects_progress_id) : undefined,
    createdAt: String(row.created_at)
  };
}

function protocolBranch(handle: ProjectHandle, protocolVersionId: string): string {
  const row = handle.db.prepare("SELECT branch_id FROM protocol_versions WHERE id = ?").get(protocolVersionId) as { branch_id?: unknown } | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `protocol version ${protocolVersionId} was not found`);
  }
  return assertBranch(handle, String(row.branch_id));
}

function progressById(handle: ProjectHandle, id: string): ProgressRecord {
  const row = handle.db.prepare("SELECT * FROM progress_records WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `progress record ${id} was not found`);
  }
  return progressFromRow(row);
}

function operationEntity(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string): string | undefined {
  const row = handle.db.prepare("SELECT kind, payload_hash, entity_id FROM progress_operations WHERE command_id = ?").get(commandId) as
    | { kind?: unknown; payload_hash?: unknown; entity_id?: unknown }
    | undefined;
  if (!row) {
    return undefined;
  }
  if (row.kind !== kind || row.payload_hash !== payloadHash) {
    throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
  }
  return typeof row.entity_id === "string" ? row.entity_id : undefined;
}

function insertOperation(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string, entityId: string, createdAt: string): void {
  handle.db.prepare(`
    INSERT INTO progress_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
    VALUES (?, ?, ?, 'complete', ?, ?, ?)
  `).run(commandId, kind, payloadHash, entityId, createdAt, createdAt);
}

function insertProgress(
  handle: ProjectHandle,
  capability: unknown,
  request: ProgressRecordRequest,
  retrospective: boolean,
  correctsProgressId: string | undefined,
  operationKind: string,
  commandId: string,
  payloadHash: string,
  id: string
): ProgressRecord {
  const summary = requiredText(request.summary, "summary");
  const occurredOn = optionalText(request.occurredOn, "occurredOn");
  assertActivity(request.activity);
  const protocolBranchId = protocolBranch(handle, request.protocolVersionId);
  const branchId = assertBranch(handle, request.branchId ?? protocolBranchId);
  if (branchId !== protocolBranchId) {
    throw new ProjectStoreError("forbidden", "progress must use the protocol version branch");
  }
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const createdAt = isoNow();
  const artifact = registerArtifactVersion(handle, {
    logicalId: `study-progress-${id}`,
    version: "1.0",
    content: JSON.stringify({
      protocolVersionId: request.protocolVersionId,
      summary,
      occurredOn: occurredOn ?? null,
      activity: request.activity ?? null,
      attribution,
      origin,
      retrospective,
      correctsProgressId: correctsProgressId ?? null
    }),
    origin: "study-progress",
    access: "metadata-only"
  });
  try {
    transaction(handle.db, () => {
      handle.db.prepare(`
        INSERT INTO progress_records (
          id, protocol_version_id, summary, occurred_on, activity, attribution, origin,
          artifact_version_id, command_id, branch_id, retrospective, corrects_progress_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        request.protocolVersionId,
        summary,
        occurredOn ?? null,
        request.activity ?? null,
        attribution,
        origin,
        artifact.id,
        commandId,
        branchId,
        retrospective ? 1 : 0,
        correctsProgressId ?? null,
        createdAt
      );
      insertOperation(handle, commandId, operationKind, payloadHash, id, createdAt);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }
  return progressById(handle, id);
}

export function recordProgress(
  handle: ProjectHandle,
  capability: unknown,
  request: ProgressRecordRequest
): ProgressRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  assertIdentifier(request.protocolVersionId, "protocolVersionId");
  const summary = requiredText(request.summary, "summary");
  const occurredOn = optionalText(request.occurredOn, "occurredOn");
  const branchId = request.branchId ?? protocolBranch(handle, request.protocolVersionId);
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({
    protocolVersionId: request.protocolVersionId,
    summary,
    occurredOn: occurredOn ?? null,
    activity: request.activity ?? null,
    attribution,
    origin,
    branchId
  });
  const existingId = operationEntity(handle, commandId, "progress", payloadHash);
  if (existingId) {
    return progressById(handle, existingId);
  }
  return insertProgress(handle, capability, { ...request, summary, occurredOn, branchId, attribution, origin }, false, undefined, "progress", commandId, payloadHash, newId("progress"));
}

export function inspectProgress(
  handle: ProjectHandle,
  capability: unknown,
  query: ProgressQuery = {}
): readonly ProgressRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.id !== undefined) {
    conditions.push("id = ?");
    params.push(query.id);
  }
  if (query.protocolVersionId !== undefined) {
    conditions.push("protocol_version_id = ?");
    params.push(query.protocolVersionId);
  }
  if (query.branchId !== undefined) {
    conditions.push("branch_id = ?");
    params.push(query.branchId);
  }
  if (query.includeRetrospective === false) {
    conditions.push("retrospective = 0");
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = handle.db.prepare(`SELECT * FROM progress_records${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(progressFromRow);
}

export function recordProgressCorrection(
  handle: ProjectHandle,
  capability: unknown,
  request: ProgressCorrectionRequest
): ProgressRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  assertIdentifier(request.progressId, "progressId");
  const original = progressById(handle, request.progressId);
  const summary = requiredText(request.summary, "summary");
  const occurredOn = optionalText(request.occurredOn, "occurredOn") ?? original.occurredOn;
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({ progressId: original.id, summary, occurredOn: occurredOn ?? null, attribution, origin });
  const existingId = operationEntity(handle, commandId, "progress-correction", payloadHash);
  if (existingId) {
    return progressById(handle, existingId);
  }
  return insertProgress(handle, capability, {
    protocolVersionId: original.protocolVersionId,
    summary,
    occurredOn,
    activity: original.activity,
    branchId: original.branchId,
    attribution,
    origin
  }, true, original.id, "progress-correction", commandId, payloadHash, newId("progress"));
}

export function ingestProgressCandidate(
  handle: ProjectHandle,
  capability: unknown,
  request: import("./progress-types.js").ProgressCandidateRequest
): import("./progress-types.js").ProgressCandidateRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  if (!request.payload || typeof request.payload !== "object") {
    throw new ProjectStoreError("invalid-argument", "payload must be an object");
  }
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const validKinds = ["protocol", "progress", "reported-execution", "reported-prior-commitment", "amendment", "deviation"];
  if (!validKinds.includes(request.kind)) {
    throw new ProjectStoreError("invalid-argument", `kind must be one of: ${validKinds.join(", ")}`);
  }
  const payloadHash = hashPayload({ kind: request.kind, payload: request.payload, specialistRole: request.specialistRole ?? "methodology" });
  const existingId = operationEntity(handle, commandId, "candidate", payloadHash);
  if (existingId) {
    const existing = handle.db.prepare("SELECT * FROM progress_candidates WHERE id = ?").get(existingId) as Record<string, unknown> | undefined;
    if (!existing) {
      throw new ProjectStoreError("invalid-transition", "prior candidate operation has no candidate");
    }
    return candidateFromRow(existing);
  }
  const id = newId("progress-candidate");
  const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare(`
      INSERT INTO progress_candidates (id, kind, payload, specialist_role, attribution, origin, status, command_id, created_at)
      VALUES (?, ?, ?, ?, 'agent-inferred', 'specialist-proposed', 'proposed', ?, ?)
    `).run(id, request.kind, JSON.stringify(request.payload), request.specialistRole ?? "methodology", commandId, createdAt);
    insertOperation(handle, commandId, "candidate", payloadHash, id, createdAt);
  });
  return candidateFromRow(handle.db.prepare("SELECT * FROM progress_candidates WHERE id = ?").get(id) as Record<string, unknown>);
}

function candidateFromRow(row: Record<string, unknown>): import("./progress-types.js").ProgressCandidateRecord {
  return {
    id: String(row.id),
    kind: String(row.kind) as import("./progress-types.js").ProgressCandidateRecord["kind"],
    payload: JSON.parse(String(row.payload)),
    specialistRole: String(row.specialist_role),
    attribution: "agent-inferred",
    origin: "specialist-proposed",
    status: "proposed",
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}
