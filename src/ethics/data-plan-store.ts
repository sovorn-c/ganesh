// story: e10s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { evaluatePolicy } from "../policy/policy-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  DataManagementPlan,
  DataManagementPlanRequest,
  ResearchRetentionPlan,
  ResearchRetentionPlanRequest
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
  validateEvidenceVersionIds
} from "./ethics-utils.js";

function checkDataUsePolicy(
  handle: ProjectHandle,
  destinations: readonly string[],
  purposes: readonly string[],
  storageLocation: string,
  inputVersionIds: readonly string[],
  branchId?: string
): { permitted: boolean; denied: readonly string[] } {
  const denied = new Set<string>();
  const checkedDestinations = [...new Set([storageLocation, ...destinations])];

  for (const destination of checkedDestinations) {
    for (const purpose of purposes) {
      if (destination === "local") {
        continue;
      }
      if (inputVersionIds.length === 0) {
        denied.add(destination);
        continue;
      }
      const decision = evaluatePolicy(handle, {
        inputVersions: inputVersionIds,
        destination,
        purpose,
        branchId,
        actor: "ethics-dmp"
      });
      if (decision.result === "deny") {
        denied.add(destination);
      }
    }
  }

  return { permitted: denied.size === 0, denied: [...denied] };
}

function parseDmpRow(row: Record<string, unknown>): DataManagementPlan {
  return {
    id: String(row.id),
    activity: row.activity as DataManagementPlan["activity"],
    dataClasses: JSON.parse(String(row.data_classes || "[]")),
    intendedDestinations: JSON.parse(String(row.intended_destinations || "[]")),
    purposes: JSON.parse(String(row.purposes || "[]")),
    storageLocation: String(row.storage_location || "local"),
    issues: JSON.parse(String(row.issues || "[]")),
    evidenceVersionIds: JSON.parse(String(row.evidence_version_ids || "[]")),
    status: row.status as DataManagementPlan["status"],
    deniedDestinations: row.denied_destinations ? JSON.parse(String(row.denied_destinations)) : undefined,
    attribution: row.attribution as DataManagementPlan["attribution"],
    origin: row.origin as DataManagementPlan["origin"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function parseRetentionRow(row: Record<string, unknown>): ResearchRetentionPlan {
  return {
    id: String(row.id),
    activity: row.activity as ResearchRetentionPlan["activity"],
    dataClasses: JSON.parse(String(row.data_classes || "[]")),
    retainUntil: String(row.retain_until),
    destructionIntent: String(row.destruction_intent),
    evidenceVersionIds: JSON.parse(String(row.evidence_version_ids || "[]")),
    status: row.status as ResearchRetentionPlan["status"],
    attribution: row.attribution as ResearchRetentionPlan["attribution"],
    origin: row.origin as ResearchRetentionPlan["origin"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: row.branch_id ? String(row.branch_id) : undefined,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function recordDataManagementPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: DataManagementPlanRequest
): DataManagementPlan {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");
  assertActivity(request.activity);

  if (!Array.isArray(request.dataClasses) || request.dataClasses.length === 0 || !request.dataClasses.every((dataClass) => typeof dataClass === "string" && dataClass.trim() !== "")) {
    throw new ProjectStoreError("invalid-argument", "dataClasses must contain at least one non-empty data class");
  }

  const intendedDestinations = request.intendedDestinations ? [...request.intendedDestinations] : [];
  if (intendedDestinations.length === 0 || intendedDestinations.some((destination) => !destination.trim())) {
    throw new ProjectStoreError("invalid-argument", "intendedDestinations must contain non-empty destinations");
  }

  const purposes = request.purposes ? [...request.purposes] : [];
  if (purposes.length === 0 || purposes.some((purpose) => !purpose.trim())) {
    throw new ProjectStoreError("invalid-argument", "purposes must contain non-empty purposes");
  }

  const storageLocation = String(request.storageLocation ?? "").trim();
  if (!storageLocation) {
    throw new ProjectStoreError("invalid-argument", "storageLocation is required");
  }

  const evidenceVersionIds = validateEvidenceVersionIds(handle, request.evidenceVersionIds);
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const branchId = request.branchId;

  const policyCheck = checkDataUsePolicy(
    handle,
    intendedDestinations,
    purposes,
    storageLocation,
    evidenceVersionIds,
    branchId
  );
  const status = policyCheck.permitted ? "recorded" : "destination-not-permitted";
  const deniedDestinations = policyCheck.permitted ? undefined : policyCheck.denied;
  const issues = [...new Set([
    ...(request.issues ?? []),
    ...(policyCheck.permitted ? [] : ["destination-not-permitted"])
  ])];

  const payloadHash = hashPayload({
    activity: request.activity,
    dataClasses: request.dataClasses,
    intendedDestinations,
    purposes,
    storageLocation,
    issues,
    evidenceVersionIds,
    status,
    deniedDestinations,
    attribution,
    origin,
    branchId: branchId ?? null
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "data-management-plan" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db.prepare("SELECT * FROM data_management_plans WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior data-management operation has no recorded plan");
    }
    return parseDmpRow(row);
  }

  const id = newId("dmp");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `ethics-dmp-${id}`,
    version: "1.0",
    content: JSON.stringify({
      activity: request.activity,
      dataClasses: request.dataClasses,
      intendedDestinations,
      purposes,
      storageLocation,
      issues,
      evidenceVersionIds,
      status,
      deniedDestinations
    }),
    origin: "ethics-dmp",
    access: "metadata-only"
  });

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(`
          INSERT INTO data_management_plans (
            id, activity, data_classes, intended_destinations, purposes, storage_location, issues,
            evidence_version_ids, status, denied_destinations, attribution, origin, artifact_version_id,
            command_id, branch_id, created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          request.activity,
          JSON.stringify(request.dataClasses),
          JSON.stringify(intendedDestinations),
          JSON.stringify(purposes),
          storageLocation,
          JSON.stringify(issues),
          JSON.stringify(evidenceVersionIds),
          status,
          deniedDestinations ? JSON.stringify(deniedDestinations) : null,
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
          VALUES (?, 'data-management-plan', ?, 'complete', ?, ?, ?)
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
    dataClasses: [...request.dataClasses],
    intendedDestinations,
    purposes,
    storageLocation,
    issues,
    evidenceVersionIds,
    status,
    deniedDestinations,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    branchId,
    createdAt,
    updatedAt: createdAt
  };
}

export function inspectDataManagementPlan(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): DataManagementPlan {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const row = handle.db
    .prepare("SELECT * FROM data_management_plans WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `data management plan ${id} was not found`);
  }

  return parseDmpRow(row);
}

export function recordResearchRetentionPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: ResearchRetentionPlanRequest
): ResearchRetentionPlan {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");
  assertActivity(request.activity);

  if (!Array.isArray(request.dataClasses) || request.dataClasses.length === 0 || request.dataClasses.some((item) => typeof item !== "string" || item.trim() === "")) {
    throw new ProjectStoreError("invalid-argument", "dataClasses must contain at least one non-empty data class");
  }
  const dataClasses = request.dataClasses.map((item) => item.trim());

  const retainUntil = String(request.retainUntil ?? "").trim();
  if (!retainUntil) {
    throw new ProjectStoreError("invalid-argument", "retainUntil is required");
  }

  const destructionIntent = String(request.destructionIntent ?? "").trim();
  if (!destructionIntent) {
    throw new ProjectStoreError("invalid-argument", "destructionIntent is required");
  }

  const evidenceVersionIds = validateEvidenceVersionIds(handle, request.evidenceVersionIds);
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const branchId = request.branchId;

  const payloadHash = hashPayload({
    activity: request.activity,
    dataClasses,
    retainUntil,
    destructionIntent,
    evidenceVersionIds,
    attribution,
    origin,
    branchId: branchId ?? null
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "retention-plan" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db.prepare("SELECT * FROM research_retention_plans WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior retention operation has no recorded plan");
    }
    return parseRetentionRow(row);
  }

  const id = newId("retention");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `ethics-retention-${id}`,
    version: "1.0",
    content: JSON.stringify({
      activity: request.activity,
      dataClasses,
      retainUntil,
      destructionIntent,
      evidenceVersionIds
    }),
    origin: "ethics-retention",
    access: "metadata-only"
  });

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(`
          INSERT INTO research_retention_plans (
            id, activity, data_classes, retain_until, destruction_intent, evidence_version_ids,
            status, attribution, origin, artifact_version_id, command_id, branch_id,
            created_at, updated_at
          )
          VALUES (?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?, ?, ?, ?, ?)
        `)
        .run(
          id,
          request.activity,
          JSON.stringify(dataClasses),
          retainUntil,
          destructionIntent,
          JSON.stringify(evidenceVersionIds),
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
          VALUES (?, 'retention-plan', ?, 'complete', ?, ?, ?)
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
    dataClasses,
    retainUntil,
    destructionIntent,
    evidenceVersionIds,
    status: "recorded",
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    branchId,
    createdAt,
    updatedAt: createdAt
  };
}

export function inspectResearchRetentionPlan(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): ResearchRetentionPlan {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const row = handle.db
    .prepare("SELECT * FROM research_retention_plans WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `research retention plan ${id} was not found`);
  }

  return parseRetentionRow(row);
}
