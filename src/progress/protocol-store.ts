import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { getBranch, snapshotReferences } from "../branches/branch-store.js";
import { getCommitment, listCommitments } from "../decisions/commitment-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type {
  BindProtocolInForceRequest,
  ProtocolVersionQuery,
  ProtocolVersionRecord,
  ProtocolVersionRequest
} from "./progress-types.js";
import {
  assertActivity,
  assertBranch,
  assertProgressAccess,
  assertProgressSchema,
  assertIdsExist,
  hashPayload,
  isoNow,
  newId,
  optionalText,
  requiredText,
  resolveAttribution,
  resolveOrigin
} from "./progress-utils.js";

const PROTOCOL_LOGICAL_ID = "study-protocol";

function optionalReference(handle: ProjectHandle, table: string, id: string | undefined, label: string): string | undefined {
  if (id === undefined) {
    return undefined;
  }
  assertIdentifier(id, label);
  if (handle.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) === undefined) {
    throw new ProjectStoreError("not-found", `${label} ${id} was not found`);
  }
  return id;
}

function artifactDependencies(handle: ProjectHandle, references: ReadonlyArray<{ table: string; ids: readonly string[] }>): string[] {
  const dependencies = new Set<string>();
  for (const reference of references) {
    for (const id of reference.ids) {
      const row = handle.db.prepare(`SELECT artifact_version_id FROM ${reference.table} WHERE id = ?`).get(id) as { artifact_version_id?: unknown } | undefined;
      if (typeof row?.artifact_version_id === "string") {
        dependencies.add(row.artifact_version_id);
      }
    }
  }
  return [...dependencies];
}

function protocolFromRow(row: Record<string, unknown>): ProtocolVersionRecord {
  return {
    id: String(row.id),
    versionLabel: String(row.version_label),
    procedureText: String(row.procedure_text),
    rqVersionIds: JSON.parse(String(row.rq_version_ids ?? "[]")),
    designComparisonId: row.design_comparison_id ? String(row.design_comparison_id) : undefined,
    samplingPlanId: row.sampling_plan_id ? String(row.sampling_plan_id) : undefined,
    analysisPlanId: row.analysis_plan_id ? String(row.analysis_plan_id) : undefined,
    riskRegisterItemIds: JSON.parse(String(row.risk_register_item_ids ?? "[]")),
    authorizationId: row.authorization_id ? String(row.authorization_id) : undefined,
    activity: row.activity ? String(row.activity) as ProtocolVersionRecord["activity"] : undefined,
    population: row.population ? String(row.population) : undefined,
    dataUse: row.data_use ? String(row.data_use) : undefined,
    attribution: String(row.attribution) as ProtocolVersionRecord["attribution"],
    origin: String(row.origin) as ProtocolVersionRecord["origin"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: String(row.branch_id),
    status: String(row.status) as ProtocolVersionRecord["status"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function protocolById(handle: ProjectHandle, id: string): ProtocolVersionRecord {
  const row = handle.db.prepare("SELECT * FROM protocol_versions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `protocol version ${id} was not found`);
  }
  return protocolFromRow(row);
}

function operationResult(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string): string | undefined {
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

function recordOperation(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string, entityId: string, createdAt: string): void {
  handle.db.prepare(`
    INSERT INTO progress_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
    VALUES (?, ?, ?, 'complete', ?, ?, ?)
  `).run(commandId, kind, payloadHash, entityId, createdAt, createdAt);
}

export function recordProtocolVersion(
  handle: ProjectHandle,
  capability: unknown,
  request: ProtocolVersionRequest
): ProtocolVersionRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");

  const procedureText = requiredText(request.procedureText, "procedureText");
  const versionLabel = requiredText(request.versionLabel ?? request.version ?? "", "versionLabel");
  assertIdentifier(versionLabel, "versionLabel");
  const branchId = assertBranch(handle, request.branchId ?? "main");
  assertActivity(request.activity);
  const population = optionalText(request.population, "population");
  const dataUse = optionalText(request.dataUse, "dataUse");
  const rqVersionIds = assertIdsExist(handle, "research_questions", request.rqVersionIds, "rqVersionId");
  const riskRegisterItemIds = assertIdsExist(handle, "risk_register_items", request.riskRegisterItemIds, "riskRegisterItemId");
  const designComparisonId = optionalReference(handle, "design_comparisons", request.designComparisonId, "designComparisonId");
  const samplingPlanId = optionalReference(handle, "sampling_plans", request.samplingPlanId, "samplingPlanId");
  const analysisPlanId = optionalReference(handle, "analysis_plans", request.analysisPlanId, "analysisPlanId");
  const authorizationId = optionalReference(handle, "external_authorizations", request.authorizationId, "authorizationId");
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payload = {
    versionLabel,
    procedureText,
    rqVersionIds,
    designComparisonId: designComparisonId ?? null,
    samplingPlanId: samplingPlanId ?? null,
    analysisPlanId: analysisPlanId ?? null,
    riskRegisterItemIds,
    authorizationId: authorizationId ?? null,
    activity: request.activity ?? null,
    population: population ?? null,
    dataUse: dataUse ?? null,
    attribution,
    origin,
    branchId
  };
  const payloadHash = hashPayload(payload);
  const existingId = operationResult(handle, commandId, "protocol", payloadHash);
  if (existingId) {
    return protocolById(handle, existingId);
  }

  const id = newId("protocol");
  const createdAt = isoNow();
  const dependencies = artifactDependencies(handle, [
    { table: "research_questions", ids: rqVersionIds },
    { table: "risk_register_items", ids: riskRegisterItemIds },
    { table: "design_comparisons", ids: designComparisonId ? [designComparisonId] : [] },
    { table: "sampling_plans", ids: samplingPlanId ? [samplingPlanId] : [] },
    { table: "analysis_plans", ids: analysisPlanId ? [analysisPlanId] : [] },
    { table: "external_authorizations", ids: authorizationId ? [authorizationId] : [] }
  ]);
  const artifact = registerArtifactVersion(handle, {
    logicalId: PROTOCOL_LOGICAL_ID,
    version: versionLabel,
    content: JSON.stringify(payload),
    origin: "study-protocol",
    access: "metadata-only",
    dependencies: dependencies.map((versionId) => ({ versionId, relation: "protocol-reference" }))
  });
  try {
    transaction(handle.db, () => {
      handle.db.prepare(`
        INSERT INTO protocol_versions (
          id, version_label, procedure_text, rq_version_ids, design_comparison_id,
          sampling_plan_id, analysis_plan_id, risk_register_item_ids, authorization_id,
          activity, population, data_use, attribution, origin, artifact_version_id,
          command_id, branch_id, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?)
      `).run(
        id,
        versionLabel,
        procedureText,
        JSON.stringify(rqVersionIds),
        designComparisonId ?? null,
        samplingPlanId ?? null,
        analysisPlanId ?? null,
        JSON.stringify(riskRegisterItemIds),
        authorizationId ?? null,
        request.activity ?? null,
        population ?? null,
        dataUse ?? null,
        attribution,
        origin,
        artifact.id,
        commandId,
        branchId,
        createdAt,
        createdAt
      );
      recordOperation(handle, commandId, "protocol", payloadHash, id, createdAt);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }
  return protocolById(handle, id);
}

export function inspectProtocol(
  handle: ProjectHandle,
  capability: unknown,
  query: ProtocolVersionQuery = {}
): readonly ProtocolVersionRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.id !== undefined) {
    conditions.push("id = ?");
    params.push(query.id);
  }
  if (query.branchId !== undefined) {
    conditions.push("branch_id = ?");
    params.push(query.branchId);
  }
  if (query.status !== undefined) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const rows = handle.db.prepare(`SELECT * FROM protocol_versions${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>;
  return rows.map(protocolFromRow);
}

export function bindProtocolInForce(
  handle: ProjectHandle,
  capability: unknown,
  request: BindProtocolInForceRequest
): ProtocolVersionRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "binding a protocol in force requires the matching owner capability");
  }
  assertIdentifier(request.protocolVersionId, "protocolVersionId");
  const protocol = protocolById(handle, request.protocolVersionId);
  const branchId = assertBranch(handle, request.branchId ?? protocol.branchId);
  if (protocol.branchId !== branchId) {
    throw new ProjectStoreError("forbidden", "a protocol can only be bound on its recorded branch");
  }
  const commitments = request.commitmentId === undefined
    ? listCommitments(handle).filter((item) => item.status === "active" && item.branchId === branchId && item.selectedCandidateVersionIds.includes(protocol.artifactVersionId))
    : [getCommitment(handle, request.commitmentId)].filter((item): item is NonNullable<typeof item> => item !== null);
  const commitment = commitments.find((item) => item.status === "active" && item.branchId === branchId && item.selectedCandidateVersionIds.includes(protocol.artifactVersionId));
  if (!commitment) {
    throw new ProjectStoreError("invalid-transition", "an active E04 commitment selecting this protocol artifact is required");
  }
  const branch = getBranch(handle, branchId);
  const reference = snapshotReferences(handle, branch.currentSnapshotId).find((item) => item.logicalId === PROTOCOL_LOGICAL_ID);
  if (!reference || reference.artifactVersionId !== protocol.artifactVersionId) {
    throw new ProjectStoreError("invalid-transition", "the protocol artifact must be the current branch reference before it can be in force");
  }
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({ protocolVersionId: protocol.id, commitmentId: commitment.id, branchId });
  const existingId = operationResult(handle, commandId, "bind-protocol", payloadHash);
  if (existingId) {
    return protocolById(handle, existingId);
  }
  const now = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare("UPDATE protocol_versions SET status = 'superseded', updated_at = ? WHERE branch_id = ? AND status = 'in-force' AND id <> ?").run(now, branchId, protocol.id);
    handle.db.prepare("UPDATE protocol_versions SET status = 'in-force', updated_at = ? WHERE id = ?").run(now, protocol.id);
    handle.db.prepare("UPDATE amendments SET status = 'adopted', updated_at = ? WHERE successor_protocol_version_id = ? AND status = 'proposed'").run(now, protocol.id);
    handle.db.prepare(`
      UPDATE amendments SET status = 'superseded', updated_at = ?
      WHERE branch_id = ? AND successor_protocol_version_id <> ? AND status = 'proposed'
        AND from_protocol_version_id = (
          SELECT from_protocol_version_id FROM amendments
          WHERE successor_protocol_version_id = ? AND branch_id = ? LIMIT 1
        )
    `).run(now, branchId, protocol.id, protocol.id, branchId);
    recordOperation(handle, commandId, "bind-protocol", payloadHash, protocol.id, now);
  });
  return protocolById(handle, protocol.id);
}

export { PROTOCOL_LOGICAL_ID };
