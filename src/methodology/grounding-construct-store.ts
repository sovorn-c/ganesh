// story: e09s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  ConstructRecord,
  ConstructRequest,
  FrameworkRecord,
  FrameworkRequest,
  ViewAttribution,
  MethodologyOrigin
} from "./methodology-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  hashPayload,
  newId,
  isoNow,
  validateRqVersionIds
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

export function recordConstruct(
  handle: ProjectHandle,
  capability: unknown,
  request: ConstructRequest
): ConstructRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const name = String(request.name ?? "").trim();
  const definition = String(request.definition ?? "").trim();
  const rqVersionIds = request.rqVersionIds ? [...request.rqVersionIds] : [];

  if (!name || !definition) {
    throw new ProjectStoreError("invalid-argument", "name and definition are required");
  }
  if (rqVersionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "at least one rqVersionId is required");
  }
  validateRqVersionIds(handle.db, rqVersionIds);

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({ name, definition, rqVersionIds, attribution, origin });

  const existingOp = handle.db
    .prepare("SELECT entity_id, payload_hash FROM methodology_operations WHERE command_id = ?")
    .get(commandId) as { entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db
      .prepare("SELECT * FROM constructs WHERE id = ?")
      .get(existingOp.entity_id) as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      definition: String(row.definition),
      rqVersionIds: JSON.parse(String(row.rq_version_ids)),
      attribution: String(row.attribution) as ViewAttribution,
      origin: String(row.origin) as MethodologyOrigin,
      artifactVersionId: String(row.artifact_version_id),
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("construct");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-construct-${id}`,
    version: "1.0",
    content: JSON.stringify({ name, definition, rqVersionIds }),
    origin: "methodology-construct",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO constructs (id, name, definition, rq_version_ids, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, name, definition, JSON.stringify(rqVersionIds), attribution, origin, artifact.id, commandId, createdAt);

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'construct', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    name,
    definition,
    rqVersionIds,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}

export function recordTheoreticalFramework(
  handle: ProjectHandle,
  capability: unknown,
  request: FrameworkRequest
): FrameworkRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const name = String(request.name ?? "").trim();
  const description = String(request.description ?? "").trim();
  const rqVersionIds = request.rqVersionIds ? [...request.rqVersionIds] : [];
  const constructRelations = request.constructRelations ? [...request.constructRelations] : [];

  if (!name || !description) {
    throw new ProjectStoreError("invalid-argument", "name and description are required");
  }
  if (rqVersionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "at least one rqVersionId is required");
  }
  validateRqVersionIds(handle.db, rqVersionIds);

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({ name, description, constructRelations, rqVersionIds, attribution, origin });

  const existingOp = handle.db
    .prepare("SELECT entity_id, payload_hash FROM methodology_operations WHERE command_id = ?")
    .get(commandId) as { entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db
      .prepare("SELECT * FROM theoretical_frameworks WHERE id = ?")
      .get(existingOp.entity_id) as Record<string, unknown>;
    return {
      id: String(row.id),
      name: String(row.name),
      description: String(row.description),
      constructRelations: JSON.parse(String(row.construct_relations)),
      rqVersionIds: JSON.parse(String(row.rq_version_ids)),
      attribution: String(row.attribution) as ViewAttribution,
      origin: String(row.origin) as MethodologyOrigin,
      artifactVersionId: String(row.artifact_version_id),
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("framework");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-framework-${id}`,
    version: "1.0",
    content: JSON.stringify({ name, description, constructRelations, rqVersionIds }),
    origin: "methodology-framework",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO theoretical_frameworks (id, name, description, construct_relations, rq_version_ids, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        name,
        description,
        JSON.stringify(constructRelations),
        JSON.stringify(rqVersionIds),
        attribution,
        origin,
        artifact.id,
        commandId,
        createdAt
      );

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'framework', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    name,
    description,
    constructRelations,
    rqVersionIds,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}
