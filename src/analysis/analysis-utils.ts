// story: e11s01, e11s02, e11s03, e11s04, e11s05
import { createHash } from "node:crypto";
import { realpathSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { assessActivityAuthorization } from "../ethics/authorization-assessment.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier, pathInside } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type { AnalysisAttribution, AnalysisOrigin, AnalysisRunRequest } from "./analysis-types.js";

export const ANALYSIS_SCHEMA_TABLES = [
  "analysis_operations",
  "analysis_execution_policies",
  "analysis_command_confirmations",
  "analysis_runs",
  "analysis_candidates",
  "analysis_tool_probes",
  "analysis_diagnostics",
  "external_analysis_outputs",
  "analysis_quarantined_outputs"
] as const;

export function analysisSchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  const db = "db" in target ? target.db : target;
  try {
    const placeholders = ANALYSIS_SCHEMA_TABLES.map(() => "?").join(", ");
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM sqlite_master
      WHERE type = 'table' AND name IN (${placeholders})
    `).get(...ANALYSIS_SCHEMA_TABLES) as { count?: unknown } | undefined;
    return Number(row?.count ?? 0) === ANALYSIS_SCHEMA_TABLES.length;
  } catch {
    return false;
  }
}

export function assertAnalysisSchema(target: ProjectHandle | DatabaseSync): void {
  if (!analysisSchemaAvailable(target)) {
    throw new ProjectStoreError(
      "analysis-schema-unavailable",
      "E11 analysis tables are unavailable; open a writable ready project or migrate it"
    );
  }
}

export function assertOwner(handle: ProjectHandle, capability: unknown): void {
  if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: analysis operation requires the matching owner capability");
  }
}

export function assertInspectionAccess(handle: ProjectHandle, capability: unknown): void {
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
    if (!capability.canPerform("analysis:inspect")) {
      throw new ProjectStoreError("forbidden", "worker lacks analysis:inspect capability");
    }
    return;
  }
  throw new ProjectStoreError("forbidden", "untrusted caller lacks analysis inspection authority");
}

export function assertProbeAccess(handle: ProjectHandle, capability: unknown): void {
  if (isOwnerCapability(capability)) {
    assertOwner(handle, capability);
    return;
  }
  if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id) {
      throw new ProjectStoreError("forbidden", "worker capability belongs to another project");
    }
    if (!capability.canPerform("analysis:probe")) {
      throw new ProjectStoreError("forbidden", "worker lacks analysis:probe capability");
    }
    return;
  }
  throw new ProjectStoreError("forbidden", "untrusted caller lacks analysis probe authority");
}

export function assertId(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ProjectStoreError("invalid-argument", `${label} is required`);
  }
  return assertIdentifier(value, label);
}

export function assertArgv(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.length === 0)) {
    throw new ProjectStoreError("invalid-argument", "argv must be a non-empty array of non-empty strings");
  }
  return [...value] as string[];
}

export function commandText(argv: readonly string[]): string {
  return argv.join(" ");
}

export function argvDigest(argv: readonly string[]): string {
  return createHash("sha256").update(JSON.stringify([...argv])).digest("hex");
}

export function hashPayload(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export function now(): string {
  return new Date().toISOString();
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function optionalText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

export function assertVersionIds(handle: ProjectHandle, ids: readonly string[] | undefined): string[] {
  if (ids === undefined) {
    return [];
  }
  if (!Array.isArray(ids)) {
    throw new ProjectStoreError("invalid-argument", "inputVersionIds must be an array");
  }
  const result = [...ids];
  for (const id of result) {
    assertIdentifier(id, "inputVersionId");
    if (!handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(id)) {
      throw new ProjectStoreError("artifact-not-found", `artifact version ${id} was not found`);
    }
  }
  return result;
}

export function assertCwd(handle: ProjectHandle, cwd: string | undefined): string {
  const value = resolve(cwd ?? handle.project.rootPath);
  if (!pathInside(handle.project.rootPath, value)) {
    throw new ProjectStoreError("path-escape", "analysis command cwd must remain inside the project root");
  }
  if (!existsSync(value)) {
    throw new ProjectStoreError("invalid-path", "analysis command cwd does not exist");
  }
  try {
    if (!pathInside(realpathSync(handle.project.rootPath), realpathSync(value))) {
      throw new ProjectStoreError("path-escape", "analysis command cwd resolves outside the project root");
    }
  } catch (error) {
    if (error instanceof ProjectStoreError) {
      throw error;
    }
    throw new ProjectStoreError("invalid-path", "analysis command cwd could not be inspected safely");
  }
  return value;
}

export function assertOptionalReferences(handle: ProjectHandle, request: AnalysisRunRequest): void {
  if (request.scriptVersionId !== undefined || request.scriptArtifactVersionId !== undefined) {
    const id = request.scriptVersionId ?? request.scriptArtifactVersionId;
    if (id === undefined) {
      throw new ProjectStoreError("invalid-argument", "scriptVersionId must be a string");
    }
    assertVersionIds(handle, [id]);
  }
  if (request.analysisPlanId !== undefined) {
    assertId(request.analysisPlanId, "analysisPlanId");
    if (!handle.db.prepare("SELECT id FROM analysis_plans WHERE id = ?").get(request.analysisPlanId)) {
      throw new ProjectStoreError("not-found", `analysis plan ${request.analysisPlanId} was not found`);
    }
  }
  if (request.protocolVersionId !== undefined) {
    assertId(request.protocolVersionId, "protocolVersionId");
    const protocol = handle.db.prepare("SELECT status FROM protocol_versions WHERE id = ?").get(request.protocolVersionId) as { status?: unknown } | undefined;
    if (!protocol) {
      throw new ProjectStoreError("not-found", `protocol version ${request.protocolVersionId} was not found`);
    }
    if (protocol.status !== "in-force") {
      throw new ProjectStoreError("protocol-not-current", "analysis requires an in-force protocol version");
    }
  }
}

export function assertCurrentActivity(handle: ProjectHandle, request: AnalysisRunRequest): void {
  if (request.activity === undefined) {
    return;
  }
  const assessment = assessActivityAuthorization(handle, {
    activity: request.activity,
    population: request.population,
    dataClasses: request.dataClasses,
    dataUse: request.dataUse,
    destination: request.destination ?? "local",
    purpose: request.purpose ?? "analysis",
    conditions: request.conditions
  });
  if (!assessment.permitted) {
    throw new ProjectStoreError("activity-unauthorized", assessment.reason);
  }
}

export function resolveAttribution(capability: unknown, requested?: AnalysisAttribution): AnalysisAttribution {
  if (requested !== undefined && !["human-stated", "agent-inferred", "unknown"].includes(requested)) {
    throw new ProjectStoreError("invalid-argument", "invalid analysis attribution");
  }
  if (isWorkerCapability(capability)) {
    if (requested === "human-stated") {
      throw new ProjectStoreError("forbidden", "workers cannot record human-stated analysis attribution");
    }
    return requested ?? "agent-inferred";
  }
  return requested ?? "human-stated";
}

export function resolveOrigin(capability: unknown, requested?: AnalysisOrigin): AnalysisOrigin {
  if (requested !== undefined && !["owner-recorded", "specialist-proposed"].includes(requested)) {
    throw new ProjectStoreError("invalid-argument", "invalid analysis origin");
  }
  if (isWorkerCapability(capability)) {
    if (requested === "owner-recorded") {
      throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded analysis");
    }
    return "specialist-proposed";
  }
  return requested ?? "owner-recorded";
}

export function operationResult(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string): string | undefined {
  const row = handle.db.prepare("SELECT kind, payload_hash, entity_id FROM analysis_operations WHERE command_id = ?").get(commandId) as { kind?: unknown; payload_hash?: unknown; entity_id?: unknown } | undefined;
  if (!row) {
    return undefined;
  }
  if (row.kind !== kind || row.payload_hash !== payloadHash) {
    throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
  }
  return typeof row.entity_id === "string" ? row.entity_id : undefined;
}

export function recordOperation(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string, entityId: string, createdAt: string): void {
  handle.db.prepare(`
    INSERT INTO analysis_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
    VALUES (?, ?, ?, 'complete', ?, ?, ?)
  `).run(commandId, kind, payloadHash, entityId, createdAt, createdAt);
}

export function ensureWritableAnalysis(handle: ProjectHandle): void {
  assertWritable(handle);
  assertAnalysisSchema(handle);
}

export { transaction };
