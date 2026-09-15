import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { RESEARCH_ACTIVITIES, type ResearchActivity } from "../ethics/ethics-types.js";
import { assertIdentifier, isoNow, newId } from "../persistence/storage-utils.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type { ProgressOrigin } from "./progress-types.js";
import type { MethodologyOrigin, ViewAttribution } from "../methodology/methodology-types.js";

const PROGRESS_TABLES = [
  "progress_operations",
  "protocol_versions",
  "progress_records",
  "reported_execution_evidence",
  "progress_candidates",
  "amendments",
  "deviations",
  "reported_prior_commitments"
] as const;
const ATTRIBUTIONS: readonly ViewAttribution[] = ["human-stated", "agent-inferred", "unknown"];
const ORIGINS: readonly ProgressOrigin[] = ["owner-recorded", "specialist-proposed"];

export function progressSchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  const db = "db" in target ? target.db : target;
  try {
    const placeholders = PROGRESS_TABLES.map(() => "?").join(", ");
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})
    `).get(...PROGRESS_TABLES) as { count?: unknown } | undefined;
    return Number(row?.count ?? 0) === PROGRESS_TABLES.length;
  } catch {
    return false;
  }
}

export function assertProgressSchema(target: ProjectHandle | DatabaseSync): void {
  if (!progressSchemaAvailable(target)) {
    throw new ProjectStoreError(
      "progress-schema-unavailable",
      "E12 progress tables are unavailable; open a writable ready project or migrate it"
    );
  }
}

export function assertProgressAccess(
  handle: ProjectHandle,
  capability: unknown,
  operation: "progress:record" | "progress:inspect"
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
  throw new ProjectStoreError("forbidden", "untrusted caller lacks progress authority");
}

export function resolveAttribution(capability: unknown, requested?: ViewAttribution): ViewAttribution {
  const worker = isWorkerCapability(capability);
  if (requested !== undefined && !ATTRIBUTIONS.includes(requested)) {
    throw new ProjectStoreError("invalid-argument", "invalid view attribution");
  }
  if (worker && requested === "human-stated") {
    throw new ProjectStoreError("forbidden", "workers cannot record human-stated attribution");
  }
  return requested ?? (worker ? "agent-inferred" : "human-stated");
}

export function resolveOrigin(capability: unknown, requested?: ProgressOrigin): MethodologyOrigin {
  const worker = isWorkerCapability(capability);
  if (requested !== undefined && !ORIGINS.includes(requested)) {
    throw new ProjectStoreError("invalid-argument", "invalid progress origin");
  }
  if (worker && requested === "owner-recorded") {
    throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded progress");
  }
  return worker ? "specialist-proposed" : (requested ?? "owner-recorded");
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function requiredText(value: unknown, label: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    throw new ProjectStoreError("invalid-argument", `${label} is required`);
  }
  return text;
}

export function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredText(value, label);
}

export function assertActivity(value: unknown, label = "activity"): asserts value is ResearchActivity {
  if (value !== undefined && !(RESEARCH_ACTIVITIES as readonly unknown[]).includes(value)) {
    throw new ProjectStoreError("invalid-argument", `${label} must be a supported research activity`);
  }
}

export function assertReferenceIds(handle: ProjectHandle, ids: readonly string[] | undefined, label: string): string[] {
  return assertIdsExist(handle, "artifact_versions", ids, label, "artifact-not-found");
}

export function assertIdsExist(
  handle: ProjectHandle,
  table: string,
  ids: readonly string[] | undefined,
  label: string,
  errorCode: string = "not-found"
): string[] {
  if (ids === undefined) {
    return [];
  }
  if (!Array.isArray(ids)) {
    throw new ProjectStoreError("invalid-argument", `${label} must be an array`);
  }
  const result = [...ids];
  for (const id of result) {
    assertIdentifier(id, label);
    if (handle.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) === undefined) {
      throw new ProjectStoreError(errorCode, `${label} ${id} was not found`);
    }
  }
  return result;
}

export function assertBranch(handle: ProjectHandle, branchId: string): string {
  assertIdentifier(branchId, "branchId");
  if (handle.db.prepare("SELECT id FROM branches WHERE id = ?").get(branchId) === undefined) {
    throw new ProjectStoreError("branch-not-found", `branch ${branchId} was not found`);
  }
  return branchId;
}

export { isoNow, newId };
