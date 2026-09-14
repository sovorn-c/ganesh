// story: e09s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  OrientationRecord,
  OrientationRequest,
  ViewAttribution,
  MethodologyOrigin
} from "./methodology-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  hashPayload,
  newId,
  isoNow
} from "./methodology-utils.js";

export function resolveAttribution(capability: unknown, requested?: ViewAttribution): ViewAttribution {
  const isOwner = isOwnerCapability(capability);
  if (!isOwner && requested === "human-stated") {
    throw new ProjectStoreError("forbidden", "workers cannot record human-stated attribution");
  }
  if (requested) {
    return requested;
  }
  return isOwner ? "human-stated" : "agent-inferred";
}

export function resolveOrigin(capability: unknown, requested?: MethodologyOrigin): MethodologyOrigin {
  const isOwner = isOwnerCapability(capability);
  if (!isOwner && requested === "owner-recorded") {
    throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded origin");
  }
  if (requested) {
    return requested;
  }
  return isOwner ? "owner-recorded" : "specialist-proposed";
}

export function recordOrientation(
  handle: ProjectHandle,
  capability: unknown,
  request: OrientationRequest
): OrientationRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const topic = String(request.topic ?? "").trim();
  const discipline = String(request.discipline ?? "").trim();
  const immediateGoal = String(request.immediateGoal ?? "").trim();
  if (!topic || !discipline || !immediateGoal) {
    throw new ProjectStoreError("invalid-argument", "topic, discipline, and immediateGoal are required");
  }

  const unknowns = request.unknowns ? [...request.unknowns] : [];
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({ topic, discipline, immediateGoal, unknowns, attribution, origin });

  const existingOp = handle.db
    .prepare("SELECT entity_id, payload_hash FROM methodology_operations WHERE command_id = ?")
    .get(commandId) as { entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    return inspectOrientation(handle, capability, existingOp.entity_id);
  }

  const id = newId("orient");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-orientation-${id}`,
    version: "1.0",
    content: JSON.stringify({ topic, discipline, immediateGoal, unknowns }),
    origin: "methodology-orientation",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO orientations (id, topic, discipline, immediate_goal, unknowns, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, topic, discipline, immediateGoal, JSON.stringify(unknowns), attribution, origin, artifact.id, commandId, createdAt);

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'orientation', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    topic,
    discipline,
    immediateGoal,
    unknowns,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}

export function inspectOrientation(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): OrientationRecord {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:inspect");

  const row = handle.db
    .prepare("SELECT * FROM orientations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `orientation not found: ${id}`);
  }

  return {
    id: String(row.id),
    topic: String(row.topic),
    discipline: String(row.discipline),
    immediateGoal: String(row.immediate_goal),
    unknowns: JSON.parse(String(row.unknowns)),
    attribution: String(row.attribution) as ViewAttribution,
    origin: String(row.origin) as MethodologyOrigin,
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}
