// story: e10s01
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import type { ViewAttribution } from "../methodology/methodology-types.js";
import type { ExternalAuthorizationStatus } from "../decisions/override-types.js";
import {
  RESEARCH_ACTIVITIES,
  type ResearchActivity,
  type EthicsOrigin,
  type ConsultationStatus
} from "./ethics-types.js";

const VIEW_ATTRIBUTIONS: readonly ViewAttribution[] = ["human-stated", "agent-inferred", "unknown"];
const ETHICS_ORIGINS: readonly EthicsOrigin[] = ["owner-recorded", "specialist-proposed"];
const CONSULTATION_STATUSES: readonly ConsultationStatus[] = ["unknown", "partial", "recorded-complete"];
const EXTERNAL_AUTHORIZATION_STATUSES: readonly ExternalAuthorizationStatus[] = [
  "not-required",
  "documented-approved",
  "unknown",
  "pending",
  "expired",
  "withdrawn"
];

export function ethicsSchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  const db = "db" in target ? target.db : target;
  try {
    const row = db
      .prepare(`
        SELECT COUNT(*) AS count FROM sqlite_master
        WHERE type = 'table' AND name IN (
          'ethics_operations',
          'risk_register_items',
          'ethics_candidates',
          'data_management_plans',
          'research_retention_plans',
          'guidance_citations',
          'consultation_limits',
          'external_authorizations'
        )
      `)
      .get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) === 8;
  } catch {
    return false;
  }
}

export function assertEthicsSchema(target: ProjectHandle | DatabaseSync): void {
  if (!ethicsSchemaAvailable(target)) {
    throw new ProjectStoreError(
      "ethics-schema-unavailable",
      "E10 ethics tables are unavailable; open a writable ready project or migrate it"
    );
  }
}

export function assertActivity(activity: string): asserts activity is ResearchActivity {
  if (!RESEARCH_ACTIVITIES.includes(activity as ResearchActivity)) {
    throw new ProjectStoreError(
      "invalid-argument",
      `activity must be one of: ${RESEARCH_ACTIVITIES.join(", ")}`
    );
  }
}

export function assertEthicsAccess(
  handle: ProjectHandle,
  capability: unknown,
  operation: "ethics:prepare" | "ethics:inspect" | "ethics:record-authorization"
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
  throw new ProjectStoreError("forbidden", "untrusted caller lacks ethics authority");
}

export function parseViewAttribution(value: unknown): ViewAttribution {
  if (typeof value === "string" && VIEW_ATTRIBUTIONS.includes(value as ViewAttribution)) {
    return value as ViewAttribution;
  }
  throw new ProjectStoreError("invalid-argument", "invalid view attribution");
}

export function parseEthicsOrigin(value: unknown): EthicsOrigin {
  if (typeof value === "string" && ETHICS_ORIGINS.includes(value as EthicsOrigin)) {
    return value as EthicsOrigin;
  }
  throw new ProjectStoreError("invalid-argument", "invalid ethics origin");
}

export function parseExternalAuthorizationStatus(value: unknown): ExternalAuthorizationStatus {
  if (typeof value === "string" && EXTERNAL_AUTHORIZATION_STATUSES.includes(value as ExternalAuthorizationStatus)) {
    return value as ExternalAuthorizationStatus;
  }
  throw new ProjectStoreError("invalid-argument", "invalid external authorization status");
}

export function parseConsultationStatus(value: unknown): ConsultationStatus {
  if (typeof value === "string" && CONSULTATION_STATUSES.includes(value as ConsultationStatus)) {
    return value as ConsultationStatus;
  }
  throw new ProjectStoreError("invalid-argument", "invalid consultation status");
}

export function resolveAttribution(capability: unknown, requested?: ViewAttribution): ViewAttribution {
  const isOwner = isOwnerCapability(capability);
  if (requested !== undefined) {
    const attribution = parseViewAttribution(requested);
    if (!isOwner && attribution === "human-stated") {
      throw new ProjectStoreError("forbidden", "workers cannot record human-stated attribution");
    }
    return attribution;
  }
  return isOwner ? "human-stated" : "agent-inferred";
}

export function resolveOrigin(capability: unknown, requested?: EthicsOrigin): EthicsOrigin {
  const isOwner = isOwnerCapability(capability);
  if (requested !== undefined) {
    const origin = parseEthicsOrigin(requested);
    if (!isOwner && origin === "owner-recorded") {
      throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded origin");
    }
    return origin;
  }
  return isOwner ? "owner-recorded" : "specialist-proposed";
}

export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function validateEvidenceVersionIds(handle: ProjectHandle, value: unknown): string[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new ProjectStoreError("invalid-argument", "evidenceVersionIds must be an array");
  }
  const ids = value === undefined ? [] : [...value];
  for (const versionId of ids) {
    if (typeof versionId !== "string" || versionId.trim() === "") {
      throw new ProjectStoreError("invalid-argument", "evidenceVersionIds must contain non-empty artifact version IDs");
    }
    const row = handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(versionId);
    if (row === undefined) {
      throw new ProjectStoreError("artifact-not-found", `evidence artifact version ${versionId} was not found in this project`);
    }
  }
  return ids as string[];
}

export function normalizeApplicabilityBasis(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProjectStoreError("invalid-argument", "applicabilityBasis must be a non-empty string");
  }
  const normalized = value.trim().replace(/\s+/g, " ");
  if (normalized === "") {
    throw new ProjectStoreError("invalid-argument", "applicabilityBasis must be a non-empty string");
  }
  return normalized;
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function validateMethodologyRef(handle: ProjectHandle, ref?: { samplingPlanId?: string; designComparisonId?: string; rqVersionId?: string }): void {
  if (!ref) {
    return;
  }
  if (ref.samplingPlanId) {
    const exists = handle.db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'sampling_plans'")
      .get() as { count: number };
    if (exists.count > 0) {
      const row = handle.db
        .prepare("SELECT id FROM sampling_plans WHERE id = ?")
        .get(ref.samplingPlanId);
      if (!row) {
        throw new ProjectStoreError("not-found", `sampling plan ${ref.samplingPlanId} was not found`);
      }
    }
  }
  if (ref.designComparisonId) {
    const exists = handle.db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'design_comparisons'")
      .get() as { count: number };
    if (exists.count > 0) {
      const row = handle.db
        .prepare("SELECT id FROM design_comparisons WHERE id = ?")
        .get(ref.designComparisonId);
      if (!row) {
        throw new ProjectStoreError("not-found", `design comparison ${ref.designComparisonId} was not found`);
      }
    }
  }
  if (ref.rqVersionId) {
    const exists = handle.db
      .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'research_questions'")
      .get() as { count: number };
    if (exists.count > 0) {
      const row = handle.db
        .prepare("SELECT id FROM research_questions WHERE id = ?")
        .get(ref.rqVersionId);
      if (!row) {
        throw new ProjectStoreError("not-found", `research question ${ref.rqVersionId} was not found`);
      }
    }
  }
}

