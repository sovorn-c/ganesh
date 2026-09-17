// story: e13s01, e13s02, e13s03, e13s04
import type { DatabaseSync } from "node:sqlite";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { sha256 } from "../persistence/storage-utils.js";

export const WRITING_SCHEMA_TABLES = [
  "writing_operations",
  "drafts",
  "draft_assertion_links",
  "draft_limitations",
  "ai_contributions",
  "writing_candidates",
  "review_issues",
  "review_cycles",
  "supervisor_feedbacks",
  "draft_tables",
  "writing_exports",
  "review_packet_exports"
] as const;

function resolveDatabase(target: ProjectHandle | DatabaseSync): DatabaseSync {
  return "db" in target ? target.db : target;
}

export function writingSchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  try {
    const db = resolveDatabase(target);
    const placeholders = WRITING_SCHEMA_TABLES.map(() => "?").join(", ");
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})
    `).get(...WRITING_SCHEMA_TABLES) as { count?: unknown } | undefined;
    return Number(row?.count ?? 0) === WRITING_SCHEMA_TABLES.length;
  } catch {
    return false;
  }
}

export function assertWritingSchema(target: ProjectHandle | DatabaseSync): void {
  if (!writingSchemaAvailable(target)) {
    throw new ProjectStoreError(
      "writing-schema-unavailable",
      "E13 writing tables are unavailable; open a writable ready project or migrate it"
    );
  }
}

export function assertOwner(handle: ProjectHandle, capability: unknown, actionName = "writing operation"): void {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", `forbidden: ${actionName} requires trusted OwnerCapability; forged credentials or agent roles are rejected`);
  }
  if (capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", `forbidden: ${actionName} requires the matching owner capability`);
  }
}

export function assertWritingRecordAccess(handle: ProjectHandle, capability: unknown): { isOwner: boolean } {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", "forbidden: owner capability belongs to another project");
    }
    return { isOwner: true };
  }
  if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id) {
      throw new ProjectStoreError("forbidden", "forbidden: worker capability belongs to another project");
    }
    if (!capability.canPerform("writing:record")) {
      throw new ProjectStoreError("forbidden", "forbidden: worker lacks writing:record capability");
    }
    return { isOwner: false };
  }
  throw new ProjectStoreError("forbidden", "forbidden: writing record requires matching owner or worker writing:record capability");
}

export function assertWritingInspectAccess(handle: ProjectHandle, capability: unknown): void {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", "forbidden: owner capability belongs to another project");
    }
    return;
  }
  if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id) {
      throw new ProjectStoreError("forbidden", "forbidden: worker capability belongs to another project");
    }
    if (!capability.canPerform("writing:inspect")) {
      throw new ProjectStoreError("forbidden", "forbidden: worker lacks writing:inspect capability");
    }
    return;
  }
  throw new ProjectStoreError("forbidden", "forbidden: writing inspection requires matching owner or worker writing:inspect capability");
}

export function assertWritingReviewAccess(handle: ProjectHandle, capability: unknown): { isOwner: boolean } {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", "forbidden: owner capability belongs to another project");
    }
    return { isOwner: true };
  }
  if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id) {
      throw new ProjectStoreError("forbidden", "forbidden: worker capability belongs to another project");
    }
    if (!capability.canPerform("writing:review")) {
      throw new ProjectStoreError("forbidden", "forbidden: worker lacks writing:review capability");
    }
    return { isOwner: false };
  }
  throw new ProjectStoreError("forbidden", "forbidden: writing review requires matching owner or worker writing:review capability");
}

export function findWritingOperation(
  db: DatabaseSync,
  commandId: string,
  kind: string
): { entityId: string | null; resultData: string | null; payloadHash: string } | undefined {
  const row = db.prepare(
    "SELECT entity_id, result_data, payload_hash FROM writing_operations WHERE command_id = ? AND kind = ?"
  ).get(commandId, kind) as { entity_id?: unknown; result_data?: unknown; payload_hash?: unknown } | undefined;
  if (!row) {
    return undefined;
  }
  return {
    entityId: typeof row.entity_id === "string" ? row.entity_id : null,
    resultData: typeof row.result_data === "string" ? row.result_data : null,
    payloadHash: String(row.payload_hash)
  };
}

export function recordWritingOperation(
  db: DatabaseSync,
  commandId: string,
  kind: string,
  payloadHash: string,
  entityId: string | null,
  resultData: string | null
): void {
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO writing_operations (command_id, kind, payload_hash, status, entity_id, result_data, created_at, updated_at)
    VALUES (?, ?, ?, 'completed', ?, ?, ?, ?)
    ON CONFLICT(command_id) DO UPDATE SET
      payload_hash = excluded.payload_hash,
      status = 'completed',
      entity_id = excluded.entity_id,
      result_data = excluded.result_data,
      updated_at = excluded.updated_at
  `).run(commandId, kind, payloadHash, entityId, resultData, now, now);
}
