import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability, protectCanonicalWrite } from "../authority/capability-broker.js";
import { assertWritable } from "../project/project-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import {
  ExternalAuthorizationRecord,
  ExternalAuthorizationRequest,
  ResearchActivity
} from "./ethics-types.js";
import { ExternalAuthorizationStatus } from "../decisions/override-types.js";
import {
  assertEthicsSchema,
  assertActivity,
  assertEthicsAccess,
  resolveAttribution,
  resolveOrigin,
  hashPayload,
  newId,
  isoNow,
  parseExternalAuthorizationStatus,
  parseViewAttribution,
  parseEthicsOrigin,
  validateEvidenceVersionIds,
  normalizeApplicabilityBasis
} from "./ethics-utils.js";

export function recordExternalAuthorization(
  handle: ProjectHandle,
  capability: unknown,
  request: ExternalAuthorizationRequest
): ExternalAuthorizationRecord {
  assertWritable(handle);
  assertEthicsSchema(handle);
  return protectCanonicalWrite(capability, () => {
    if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", "Only the matching owner can record external authorization");
    }
    return recordExternalAuthorizationImpl(handle, capability, request);
  });
}

function recordExternalAuthorizationImpl(
  handle: ProjectHandle,
  capability: unknown,
  request: ExternalAuthorizationRequest
): ExternalAuthorizationRecord {
  if (!request.activities || request.activities.length === 0) {
    throw new ProjectStoreError("invalid-argument", "At least one activity is required");
  }
  for (const act of request.activities) {
    assertActivity(act);
  }
  if (typeof request.populationOrDataUse !== "string" && (request.populationOrDataUse === null || typeof request.populationOrDataUse !== "object" || Array.isArray(request.populationOrDataUse))) {
    throw new ProjectStoreError("invalid-argument", "populationOrDataUse must be a non-empty label or scope object");
  }
  if (typeof request.populationOrDataUse === "string" && request.populationOrDataUse.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "populationOrDataUse must be a non-empty label or scope object");
  }
  if (typeof request.populationOrDataUse === "object") {
    const scope = request.populationOrDataUse;
    const hasPopulation = Object.prototype.hasOwnProperty.call(scope, "population") || Object.prototype.hasOwnProperty.call(scope, "populations");
    const hasDataUse = Object.prototype.hasOwnProperty.call(scope, "dataUse") || Object.prototype.hasOwnProperty.call(scope, "data-use");
    if (!hasPopulation && !hasDataUse) {
      throw new ProjectStoreError("invalid-argument", "populationOrDataUse scope must identify a population or data use");
    }
    for (const key of ["population", "populations", "dataUse", "data-use", "dataClasses", "destination", "destinations", "purpose", "purposes"] as const) {
      const value = scope[key];
      if (Object.prototype.hasOwnProperty.call(scope, key) && (value === undefined || (typeof value !== "string" && !Array.isArray(value)) || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && (value.length === 0 || !value.every((item) => typeof item === "string" && item.trim() !== ""))))) {
        throw new ProjectStoreError("invalid-argument", `populationOrDataUse scope ${key} is malformed`);
      }
    }
    if (Object.prototype.hasOwnProperty.call(scope, "conditions") && (scope.conditions === null || scope.conditions === undefined)) {
      throw new ProjectStoreError("invalid-argument", "populationOrDataUse scope conditions are malformed");
    }
  }

  const status = parseExternalAuthorizationStatus(request.status ?? "documented-approved");
  const applicabilityBasis = normalizeApplicabilityBasis(request.applicabilityBasis);
  if (request.expiresAt !== undefined && Number.isNaN(Date.parse(request.expiresAt))) {
    throw new ProjectStoreError("invalid-argument", "expiresAt must be a valid timestamp");
  }
  const evidenceVersionIds = validateEvidenceVersionIds(handle, request.evidenceVersionIds);

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd_auth");
  const payloadHash = hashPayload({
    activities: request.activities,
    populationOrDataUse: request.populationOrDataUse,
    applicabilityBasis,
    status,
    evidenceVersionIds,
    expiresAt: request.expiresAt,
    attribution,
    origin
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash, result_data FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; payload_hash: string; entity_id: string; result_data: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "external-authorization" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", `Command ${commandId} payload conflict`);
    }
    const row = handle.db.prepare("SELECT * FROM external_authorizations WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior authorization operation has no recorded grant");
    }
    return mapAuthRow(row);
  }

  const id = newId("auth");
  const now = isoNow();
  const artifactContent = JSON.stringify({
    id, activities: request.activities, populationOrDataUse: request.populationOrDataUse,
    applicabilityBasis, status, evidenceVersionIds, expiresAt: request.expiresAt ?? null
  });

  const artifactVersion = registerArtifactVersion(handle, {
    logicalId: `external-auth-${id}`,
    version: "1.0",
    content: artifactContent,
    origin: "ethics-authorization",
    access: "metadata-only"
  });

  const record: ExternalAuthorizationRecord = {
    id, activities: [...request.activities], populationOrDataUse: request.populationOrDataUse,
    applicabilityBasis, status, evidenceVersionIds,
    expiresAt: request.expiresAt, attribution, origin,
    artifactVersionId: artifactVersion.id, commandId, createdAt: now, updatedAt: now
  };

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(
          `INSERT INTO external_authorizations (
            id, activities, population_or_data_use, applicability_basis, status,
            evidence_version_ids, expires_at, withdrawn_at, withdrawal_reason,
            attribution, origin, artifact_version_id, command_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id, JSON.stringify(record.activities),
          typeof record.populationOrDataUse === "string" ? record.populationOrDataUse : JSON.stringify(record.populationOrDataUse),
          record.applicabilityBasis, record.status, JSON.stringify(record.evidenceVersionIds),
          record.expiresAt ?? null, record.attribution, record.origin, record.artifactVersionId,
          record.commandId, record.createdAt, record.updatedAt
        );

      handle.db
        .prepare(
          `INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, result_data, created_at, updated_at)
           VALUES (?, 'external-authorization', ?, 'recorded', ?, ?, ?, ?)`
        )
        .run(commandId, payloadHash, id, JSON.stringify(record), now, now);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifactVersion.id);
    throw error;
  }

  return record;
}

export function inspectAuthorization(
  handle: ProjectHandle,
  capability: unknown,
  query?: { id?: string; activity?: ResearchActivity; status?: ExternalAuthorizationStatus }
): readonly ExternalAuthorizationRecord[] {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  let sql = "SELECT * FROM external_authorizations";
  const params: (string | number | null)[] = [];
  const conditions: string[] = [];

  if (query?.id) {
    conditions.push("id = ?");
    params.push(query.id);
  }
  if (query?.status) {
    conditions.push("status = ?");
    params.push(parseExternalAuthorizationStatus(query.status));
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at ASC";

  const rows = handle.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  const records = rows.map(mapAuthRow);

  if (query?.activity) {
    return records.filter((r) => r.activities.includes(query.activity!));
  }
  return records;
}

function recordStatusTransition(
  handle: ProjectHandle,
  capability: unknown,
  targetStatus: "withdrawn" | "expired",
  request: { authorizationId: string; reason?: string; commandId?: string }
): ExternalAuthorizationRecord {
  assertWritable(handle);
  assertEthicsSchema(handle);
  return protectCanonicalWrite(capability, () => {
    if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", `Only the matching owner can transition external authorization to ${targetStatus}`);
    }
    return recordStatusTransitionImpl(handle, targetStatus, request);
  });
}

function recordStatusTransitionImpl(
  handle: ProjectHandle,
  targetStatus: "withdrawn" | "expired",
  request: { authorizationId: string; reason?: string; commandId?: string }
): ExternalAuthorizationRecord {
  const originalRow = handle.db
    .prepare("SELECT * FROM external_authorizations WHERE id = ?")
    .get(request.authorizationId) as Record<string, unknown> | undefined;
  if (!originalRow) {
    throw new ProjectStoreError("not-found", `External authorization ${request.authorizationId} not found`);
  }
  const original = mapAuthRow(originalRow);
  const commandId = request.commandId ?? newId(`cmd_${targetStatus}`);
  const payloadHash = hashPayload({
    authorizationId: request.authorizationId,
    targetStatus,
    reason: request.reason ?? null
  });

  // Check the operation ledger before registering an immutable artifact. This is
  // the replay fence: same payload returns the original transition, while a
  // conflicting command fails without creating an orphan artifact.
  const existingOperation = handle.db
    .prepare("SELECT kind, payload_hash, result_data FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind?: unknown; payload_hash?: unknown; result_data?: unknown } | undefined;
  if (existingOperation) {
    if (existingOperation.kind !== `external-authorization-${targetStatus}` || existingOperation.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", `Command ${commandId} payload conflict`);
    }
    if (typeof existingOperation.result_data !== "string") {
      throw new ProjectStoreError("invalid-transition", `Command ${commandId} has no transition result`);
    }
    return JSON.parse(existingOperation.result_data) as ExternalAuthorizationRecord;
  }

  const existingTransitionRow = handle.db
    .prepare("SELECT * FROM external_authorizations WHERE command_id = ?")
    .get(commandId) as Record<string, unknown> | undefined;
  if (existingTransitionRow) {
    const existingTransition = mapAuthRow(existingTransitionRow);
    const existingReason = existingTransition.withdrawalReason ?? undefined;
    const samePayload = existingTransition.status === targetStatus &&
      existingTransition.evidenceVersionIds[0] === request.authorizationId &&
      existingReason === request.reason;
    if (samePayload) {
      return existingTransition;
    }
    throw new ProjectStoreError("payload-conflict", `Command ${commandId} payload conflict`);
  }

  const now = isoNow();
  const id = newId("auth");
  const evidenceVersionIds = [original.artifactVersionId, ...original.evidenceVersionIds];
  const artifactVersion = registerArtifactVersion(handle, {
    logicalId: `external-auth-${targetStatus}-${id}`,
    version: "1.0",
    content: JSON.stringify({ id, targetAuthorizationId: original.id, reason: request.reason ?? null, transitionedAt: now }),
    origin: "ethics-authorization",
    access: "metadata-only"
  });

  const record: ExternalAuthorizationRecord = {
    id,
    activities: original.activities,
    populationOrDataUse: original.populationOrDataUse,
    applicabilityBasis: original.applicabilityBasis,
    status: targetStatus,
    evidenceVersionIds,
    expiresAt: targetStatus === "expired" ? now : original.expiresAt,
    withdrawnAt: targetStatus === "withdrawn" ? now : undefined,
    withdrawalReason: request.reason,
    attribution: "human-stated",
    origin: "owner-recorded",
    artifactVersionId: artifactVersion.id,
    commandId,
    createdAt: now,
    updatedAt: now
  };

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(
          `INSERT INTO external_authorizations (
            id, activities, population_or_data_use, applicability_basis, status,
            evidence_version_ids, expires_at, withdrawn_at, withdrawal_reason,
            attribution, origin, artifact_version_id, command_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          record.id,
          JSON.stringify(record.activities),
          typeof record.populationOrDataUse === "string" ? record.populationOrDataUse : JSON.stringify(record.populationOrDataUse),
          record.applicabilityBasis,
          record.status,
          JSON.stringify(record.evidenceVersionIds),
          record.expiresAt ?? null,
          record.withdrawnAt ?? null,
          record.withdrawalReason ?? null,
          record.attribution,
          record.origin,
          record.artifactVersionId,
          record.commandId,
          record.createdAt,
          record.updatedAt
        );
      handle.db
        .prepare(
          `INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, result_data, created_at, updated_at)
           VALUES (?, ?, ?, 'recorded', ?, ?, ?, ?)`
        )
        .run(commandId, `external-authorization-${targetStatus}`, payloadHash, id, JSON.stringify(record), now, now);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifactVersion.id);
    throw error;
  }

  return record;
}

export function withdrawExternalAuthorization(
  handle: ProjectHandle,
  capability: unknown,
  request: { authorizationId: string; reason: string; commandId?: string }
): ExternalAuthorizationRecord {
  return recordStatusTransition(handle, capability, "withdrawn", request);
}

export function expireExternalAuthorization(
  handle: ProjectHandle,
  capability: unknown,
  request: { authorizationId: string; reason?: string; commandId?: string }
): ExternalAuthorizationRecord {
  return recordStatusTransition(handle, capability, "expired", request);
}

export function mapAuthRow(row: Record<string, unknown>): ExternalAuthorizationRecord {
  let populationOrDataUse: Record<string, unknown> | string;
  try {
    populationOrDataUse = JSON.parse(row.population_or_data_use as string);
  } catch {
    populationOrDataUse = row.population_or_data_use as string;
  }

  return {
    id: row.id as string,
    activities: JSON.parse(row.activities as string),
    populationOrDataUse,
    applicabilityBasis: row.applicability_basis as string,
    status: parseExternalAuthorizationStatus(row.status),
    evidenceVersionIds: JSON.parse(row.evidence_version_ids as string),
    expiresAt: (row.expires_at as string | undefined) ?? undefined,
    withdrawnAt: (row.withdrawn_at as string | undefined) ?? undefined,
    withdrawalReason: (row.withdrawal_reason as string | undefined) ?? undefined,
    attribution: parseViewAttribution(row.attribution),
    origin: parseEthicsOrigin(row.origin),
    artifactVersionId: row.artifact_version_id as string,
    commandId: row.command_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}
