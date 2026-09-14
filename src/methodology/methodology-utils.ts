// story: e09s01
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";

export function methodologySchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  const db = "db" in target ? target.db : target;
  try {
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (
        'methodology_operations',
        'orientations',
        'problem_framings',
        'research_questions'
      )
    `).get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) === 4;
  } catch {
    return false;
  }
}

export function assertMethodologySchema(target: ProjectHandle | DatabaseSync): void {
  if (!methodologySchemaAvailable(target)) {
    throw new ProjectStoreError(
      "methodology-schema-unavailable",
      "E09 methodology tables are unavailable; open a writable ready project or migrate it"
    );
  }
}

export function allowedMethodology(
  handle: ProjectHandle,
  capability: unknown,
  operation: string
): boolean {
  if (isOwnerCapability(capability)) {
    return capability.ownerId === handle.project.ownerId;
  }
  return (
    isWorkerCapability(capability) &&
    capability.projectId === handle.project.id &&
    capability.canPerform(operation)
  );
}

export function assertMethodologyAccess(
  handle: ProjectHandle,
  capability: unknown,
  operation: string
): void {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {
      throw new ProjectStoreError("forbidden", "owner capability belongs to another project");
    }
    return;
  }
  if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id) {
      throw new ProjectStoreError("forbidden", "worker capability belongs to another project");
    }
    if (!capability.canPerform(operation)) {
      throw new ProjectStoreError("forbidden", `worker lacks ${operation} capability`);
    }
    return;
  }
  throw new ProjectStoreError("forbidden", "untrusted caller lacks methodology authority");
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function validateRqVersionIds(
  db: DatabaseSync,
  rqVersionIds: readonly string[]
): string {
  if (!Array.isArray(rqVersionIds) || rqVersionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "at least one rqVersionId is required");
  }

  let orientationId: string | undefined;

  for (const id of rqVersionIds) {
    const row = db
      .prepare(
        "SELECT id, orientation_id, artifact_version_id FROM research_questions WHERE id = ? OR artifact_version_id = ?"
      )
      .get(id, id) as { id: string; orientation_id: string; artifact_version_id: string } | undefined;

    if (!row) {
      throw new ProjectStoreError("not-found", `research question not found: ${id}`);
    }

    if (orientationId === undefined) {
      orientationId = row.orientation_id;
    } else if (row.orientation_id !== orientationId) {
      throw new ProjectStoreError("invalid-argument", "research questions belong to different orientations");
    }
  }

  return orientationId!;
}
