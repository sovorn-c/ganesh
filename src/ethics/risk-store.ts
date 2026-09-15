// story: e10s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  RiskRegisterItem,
  RiskRegisterItemRequest,
  RiskRegisterQuery,
  EthicsCandidateRequest,
  EthicsCandidateRecord,
  MethodologyRef
} from "./ethics-types.js";
import {
  assertEthicsSchema,
  assertEthicsAccess,
  assertActivity,
  resolveAttribution,
  resolveOrigin,
  hashPayload,
  newId,
  isoNow,
  validateMethodologyRef,
  validateEvidenceVersionIds
} from "./ethics-utils.js";

function parseRiskRow(row: Record<string, unknown>): RiskRegisterItem {
  return {
    id: String(row.id),
    activity: row.activity as RiskRegisterItem["activity"],
    requirementText: String(row.requirement_text),
    institutionOrCommunity: String(row.institution_or_community),
    evidenceVersionIds: JSON.parse(String(row.evidence_version_ids || "[]")),
    methodologyRef: row.methodology_ref ? JSON.parse(String(row.methodology_ref)) : undefined,
    residualRisk: row.residual_risk ? String(row.residual_risk) : undefined,
    mitigations: JSON.parse(String(row.mitigations || "[]")),
    attribution: row.attribution as RiskRegisterItem["attribution"],
    origin: row.origin as RiskRegisterItem["origin"],
    status: row.status as RiskRegisterItem["status"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function recordRiskRegisterItem(
  handle: ProjectHandle,
  capability: unknown,
  request: RiskRegisterItemRequest
): RiskRegisterItem {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");
  assertActivity(request.activity);

  const requirementText = String(request.requirementText ?? "").trim();
  if (!requirementText) {
    throw new ProjectStoreError("invalid-argument", "requirementText is required");
  }

  const institutionOrCommunity = String(request.institutionOrCommunity ?? "").trim();
  if (!institutionOrCommunity) {
    throw new ProjectStoreError("invalid-argument", "institutionOrCommunity is required");
  }

  validateMethodologyRef(handle, request.methodologyRef);

  const evidenceVersionIds = validateEvidenceVersionIds(handle, request.evidenceVersionIds);
  const mitigations = request.mitigations ? [...request.mitigations] : [];
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const branchId = request.branchId;

  const payloadHash = hashPayload({
    activity: request.activity,
    requirementText,
    institutionOrCommunity,
    evidenceVersionIds,
    methodologyRef: request.methodologyRef ?? null,
    residualRisk: request.residualRisk ?? null,
    mitigations,
    attribution,
    origin,
    branchId: branchId ?? null
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "risk-register" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db.prepare("SELECT * FROM risk_register_items WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior risk register operation has no recorded item");
    }
    return parseRiskRow(row);
  }

  const id = newId("risk");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `ethics-risk-${id}`,
    version: "1.0",
    content: JSON.stringify({
      activity: request.activity,
      requirementText,
      institutionOrCommunity,
      evidenceVersionIds,
      methodologyRef: request.methodologyRef,
      residualRisk: request.residualRisk,
      mitigations
    }),
    origin: "ethics-risk",
    access: "metadata-only"
  });

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(`
          INSERT INTO risk_register_items (
            id, activity, requirement_text, institution_or_community, evidence_version_ids,
            methodology_ref, residual_risk, mitigations, attribution, origin, status,
            artifact_version_id, command_id, branch_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          request.activity,
          requirementText,
          institutionOrCommunity,
          JSON.stringify(evidenceVersionIds),
          request.methodologyRef ? JSON.stringify(request.methodologyRef) : null,
          request.residualRisk ?? null,
          JSON.stringify(mitigations),
          attribution,
          origin,
          artifact.id,
          commandId,
          branchId ?? null,
          createdAt,
          createdAt
        );

      handle.db
        .prepare(`
          INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
          VALUES (?, 'risk-register', ?, 'complete', ?, ?, ?)
        `)
        .run(commandId, payloadHash, id, createdAt, createdAt);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }

  return {
    id,
    activity: request.activity,
    requirementText,
    institutionOrCommunity,
    evidenceVersionIds,
    methodologyRef: request.methodologyRef,
    residualRisk: request.residualRisk,
    mitigations,
    attribution,
    origin,
    status: "recorded",
    artifactVersionId: artifact.id,
    commandId,
    branchId,
    createdAt,
    updatedAt: createdAt
  };
}

export function inspectRiskRegister(
  handle: ProjectHandle,
  capability: unknown,
  query?: RiskRegisterQuery
): readonly RiskRegisterItem[] {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (query?.activity) {
    conditions.push("activity = ?");
    params.push(query.activity);
  }
  if (query?.branchId !== undefined) {
    conditions.push("branch_id = ?");
    params.push(query.branchId);
  }
  if (!query?.includeSuperseded) {
    conditions.push("status = 'recorded'");
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = handle.db
    .prepare(`SELECT * FROM risk_register_items ${whereClause} ORDER BY created_at ASC, id ASC`)
    .all(...params) as Array<Record<string, unknown>>;

  return rows.map(parseRiskRow);
}

export function inspectRiskRegisterItem(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): RiskRegisterItem {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const row = handle.db
    .prepare("SELECT * FROM risk_register_items WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `risk register item ${id} was not found`);
  }

  return parseRiskRow(row);
}

export function ingestEthicsCandidate(
  handle: ProjectHandle,
  capability: unknown,
  request: EthicsCandidateRequest
): EthicsCandidateRecord {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");

  const validKinds = [
    "risk-register",
    "data-management-plan",
    "retention-plan",
    "guidance-citation",
    "consultation-limit"
  ];
  if (!validKinds.includes(request.kind)) {
    throw new ProjectStoreError("invalid-argument", `kind must be one of: ${validKinds.join(", ")}`);
  }
  if (!request.payload || typeof request.payload !== "object") {
    throw new ProjectStoreError("invalid-argument", "payload must be an object");
  }

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({ kind: request.kind, payload: request.payload, attribution, origin });

  const existing = handle.db
    .prepare("SELECT kind, entity_id, payload_hash FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; entity_id: string; payload_hash: string } | undefined;

  if (existing) {
    if (existing.kind !== "candidate" || existing.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db.prepare("SELECT * FROM ethics_candidates WHERE id = ?").get(existing.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior candidate operation has no recorded candidate");
    }
    return {
      id: String(row.id),
      kind: String(row.kind),
      payload: JSON.parse(String(row.payload)),
      attribution: row.attribution as EthicsCandidateRecord["attribution"],
      origin: row.origin as EthicsCandidateRecord["origin"],
      status: row.status as EthicsCandidateRecord["status"],
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("cand");
  const createdAt = isoNow();

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO ethics_candidates (id, kind, payload, attribution, origin, status, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, 'proposed', ?, ?)
      `)
      .run(id, request.kind, JSON.stringify(request.payload), attribution, origin, commandId, createdAt);

    handle.db
      .prepare(`
        INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'candidate', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    kind: request.kind,
    payload: request.payload,
    attribution,
    origin,
    status: "proposed",
    commandId,
    createdAt
  };
}
