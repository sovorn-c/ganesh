import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { assertWritable } from "../project/project-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import {
  ConsultationLimit,
  ConsultationLimitRequest,
  ConsultationStatus,
  ResearchActivity
} from "./ethics-types.js";
import {
  assertEthicsSchema,
  assertActivity,
  assertEthicsAccess,
  resolveAttribution,
  resolveOrigin,
  parseViewAttribution,
  parseEthicsOrigin,
  hashPayload,
  newId,
  isoNow,
  parseConsultationStatus
} from "./ethics-utils.js";
import { assertNotGenericCertification } from "./guidance-store.js";

export function recordConsultationLimit(
  handle: ProjectHandle,
  capability: unknown,
  request: ConsultationLimitRequest
): ConsultationLimit {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");
  assertActivity(request.activity);

  assertNotGenericCertification([
    ...request.consultedParties,
    ...request.questionsAsked,
    ...request.claimsNotMade,
    request.notes
  ]);

  if (request.status === "recorded-complete") {
    if (!isOwnerCapability(capability)) {
      throw new ProjectStoreError(
        "forbidden",
        "Worker capability cannot set consultation limit status to recorded-complete"
      );
    }
  }

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const status: ConsultationStatus = request.status === undefined
    ? "unknown"
    : parseConsultationStatus(request.status);
  const commandId = request.commandId ?? newId("cmd_consult");

  const payloadHash = hashPayload({
    activity: request.activity,
    consultedParties: request.consultedParties,
    questionsAsked: request.questionsAsked,
    claimsNotMade: request.claimsNotMade,
    status,
    notes: request.notes,
    attribution,
    origin
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash, result_data FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; payload_hash: string; entity_id: string; result_data: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "consultation-limit" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", `Command ${commandId} payload conflict`);
    }
    const row = handle.db.prepare("SELECT * FROM consultation_limits WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior consultation operation has no recorded limit");
    }
    return mapConsultationRow(row);
  }

  const id = newId("consult");
  const now = isoNow();

  const artifactContent = JSON.stringify({
    id,
    activity: request.activity,
    consultedParties: request.consultedParties,
    questionsAsked: request.questionsAsked,
    claimsNotMade: request.claimsNotMade,
    status,
    notes: request.notes ?? null
  });

  const artifactVersion = registerArtifactVersion(handle, {
    logicalId: `consultation-limit-${id}`,
    version: "1.0",
    content: artifactContent,
    origin: "ethics-consultation",
    access: "metadata-only"
  });

  const limit: ConsultationLimit = {
    id,
    activity: request.activity,
    consultedParties: [...request.consultedParties],
    questionsAsked: [...request.questionsAsked],
    claimsNotMade: [...request.claimsNotMade],
    status,
    notes: request.notes,
    attribution,
    origin,
    artifactVersionId: artifactVersion.id,
    commandId,
    createdAt: now,
    updatedAt: now
  };

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(
          `INSERT INTO consultation_limits (
            id, activity, consulted_parties, questions_asked, claims_not_made,
            status, notes, attribution, origin, artifact_version_id, command_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          limit.id,
          limit.activity,
          JSON.stringify(limit.consultedParties),
          JSON.stringify(limit.questionsAsked),
          JSON.stringify(limit.claimsNotMade),
          limit.status,
          limit.notes ?? null,
          limit.attribution,
          limit.origin,
          limit.artifactVersionId,
          limit.commandId,
          limit.createdAt,
          limit.updatedAt
        );

      handle.db
        .prepare(
          `INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, result_data, created_at, updated_at)
           VALUES (?, 'consultation-limit', ?, 'recorded', ?, ?, ?, ?)`
        )
        .run(commandId, payloadHash, id, JSON.stringify(limit), now, now);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifactVersion.id);
    throw error;
  }

  return limit;
}

export function inspectConsultationLimits(
  handle: ProjectHandle,
  capability: unknown,
  query?: { activity?: ResearchActivity; status?: ConsultationStatus }
): readonly ConsultationLimit[] {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  let sql = "SELECT * FROM consultation_limits";
  const params: (string | number | null)[] = [];
  const conditions: string[] = [];

  if (query?.activity) {
    conditions.push("activity = ?");
    params.push(query.activity);
  }
  if (query?.status) {
    conditions.push("status = ?");
    params.push(query.status);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at ASC";

  const rows = handle.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapConsultationRow);
}

export function inspectConsultationLimit(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): ConsultationLimit {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const row = handle.db.prepare("SELECT * FROM consultation_limits WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `Consultation limit ${id} not found`);
  }
  return mapConsultationRow(row);
}

function mapConsultationRow(row: Record<string, unknown>): ConsultationLimit {
  return {
    id: row.id as string,
    activity: row.activity as ResearchActivity,
    consultedParties: JSON.parse(row.consulted_parties as string),
    questionsAsked: JSON.parse(row.questions_asked as string),
    claimsNotMade: JSON.parse(row.claims_not_made as string),
    status: parseConsultationStatus(row.status),
    notes: (row.notes as string | undefined) ?? undefined,
    attribution: parseViewAttribution(row.attribution),
    origin: parseEthicsOrigin(row.origin),
    artifactVersionId: row.artifact_version_id as string,
    commandId: row.command_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}
