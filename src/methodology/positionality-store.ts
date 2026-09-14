// story: e09s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import type {
  PositionalityRecord,
  PositionalityRequest,
  ViewAttribution
} from "./methodology-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  hashPayload,
  newId,
  isoNow
} from "./methodology-utils.js";
import { resolveOrigin } from "./grounding-construct-store.js";
import { inspectOrientation } from "./framing-store.js";

export function recordPositionality(
  handle: ProjectHandle,
  capability: unknown,
  request: PositionalityRequest
): PositionalityRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  if (!request.orientationId) {
    throw new ProjectStoreError("invalid-argument", "orientationId is required");
  }
  inspectOrientation(handle, capability, request.orientationId);

  const philosophicalStance = String(request.philosophicalStance ?? "").trim();
  const situatedStance = String(request.situatedStance ?? "").trim();

  let attribution: ViewAttribution;
  const isOwner = isOwnerCapability(capability);

  if (!isOwner) {
    if (request.attribution === "human-stated") {
      throw new ProjectStoreError("forbidden", "workers cannot record human-stated attribution");
    }
    attribution = request.attribution ?? "agent-inferred";
  } else {
    if (request.attribution) {
      attribution = request.attribution;
    } else if (!philosophicalStance && !situatedStance) {
      attribution = "unknown";
    } else {
      attribution = "human-stated";
    }
  }

  if (attribution === "agent-inferred" && !philosophicalStance && !situatedStance) {
    throw new ProjectStoreError("invalid-argument", "agent-inferred positionality cannot have empty stance text");
  }

  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({
    orientationId: request.orientationId,
    philosophicalStance,
    situatedStance,
    attribution,
    origin
  });

  const existingOp = handle.db
    .prepare("SELECT entity_id, payload_hash FROM methodology_operations WHERE command_id = ?")
    .get(commandId) as { entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    const row = handle.db
      .prepare("SELECT * FROM positionality_records WHERE id = ?")
      .get(existingOp.entity_id) as Record<string, unknown>;
    return {
      id: String(row.id),
      orientationId: String(row.orientation_id),
      philosophicalStance: String(row.philosophical_stance),
      situatedStance: String(row.situated_stance),
      attribution: String(row.attribution) as ViewAttribution,
      origin: String(row.origin) as PositionalityRecord["origin"],
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("pos");
  const createdAt = isoNow();

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO positionality_records (id, orientation_id, philosophical_stance, situated_stance, attribution, origin, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, request.orientationId, philosophicalStance, situatedStance, attribution, origin, commandId, createdAt);

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'positionality', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    orientationId: request.orientationId,
    philosophicalStance,
    situatedStance,
    attribution,
    origin,
    commandId,
    createdAt
  };
}
