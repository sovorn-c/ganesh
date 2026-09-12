import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { getSourceVersion } from "../sources/source-store.js";
import { payloadHash } from "../persistence/history-store.js";
import { isoNow, newId, stringValue } from "../persistence/storage-utils.js";
import { transaction } from "../persistence/schema.js";
import { buildEvidenceMatrix } from "./claim-matrix-store.js";
import type { EvidenceMatrix } from "./claim-types.js";

export type MethodKind = "reflexive-thematic-analysis" | "quantitative-dependent-observations" | "unspecified";
export type AppraisalApplicability = "applicable" | "not-applicable";
export type AppraisalFindingResult = "pass" | "missing" | "analysis-issue" | "not-applicable" | "not-assessed";
export type AppraisalOrigin = "owner-recorded" | "specialist-proposed";

export interface AppraisalFinding {
  readonly dimension: string;
  readonly applicability: AppraisalApplicability;
  readonly result: AppraisalFindingResult;
  readonly rationale: string;
}

export interface AppraisalRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly sourceVersionId: string;
  readonly methodKind?: MethodKind | string;
  readonly method?: MethodKind | string;
  readonly findings?: readonly AppraisalFinding[];
  readonly analysis?: Record<string, unknown>;
  readonly dependentObservationsAddressed?: boolean;
  readonly origin?: AppraisalOrigin;
  readonly scholarlyFindingId?: string;
}

export interface AppraisalRecord {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly methodKind: MethodKind;
  readonly result: "pass" | "needs-attention";
  readonly findings: readonly AppraisalFinding[];
  readonly origin: AppraisalOrigin;
  readonly scholarlyFindingId?: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface SynthesisRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly claimIds?: readonly string[];
  readonly summary?: string;
  readonly qualifications?: readonly string[];
}

export interface SynthesisRecord {
  readonly id: string;
  readonly claimIds: readonly string[];
  readonly summary: string;
  readonly disagreements: readonly Record<string, unknown>[];
  readonly limitations: readonly string[];
  readonly reassessmentFlags: readonly string[];
  readonly qualifications: readonly string[];
  readonly commandId: string;
  readonly createdAt: string;
}

function json<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function allowed(handle: ProjectHandle, capability: unknown, operations: readonly string[]): boolean {
  if (isOwnerCapability(capability)) {return capability.ownerId === handle.project.ownerId;}
  return isWorkerCapability(capability) && capability.projectId === handle.project.id && operations.every((operation) => capability.canPerform(operation));
}

function normalizeMethodKind(value: string): MethodKind {
  const normalized = value.trim().toLowerCase().replace(/\s+/g, "-");
  if (normalized === "reflexive-thematic-analysis" || normalized === "thematic-analysis") {return "reflexive-thematic-analysis";}
  if (normalized === "quantitative-dependent-observations" || normalized === "quantitative" || normalized === "longitudinal") {return "quantitative-dependent-observations";}
  return "unspecified";
}

function appraisalFromRow(row: Record<string, unknown>): AppraisalRecord {
  return {
    id: stringValue(row.id, "appraisal id"),
    sourceVersionId: stringValue(row.source_version_id, "appraisal source id"),
    methodKind: stringValue(row.method_kind, "appraisal method kind") as MethodKind,
    result: stringValue(row.result, "appraisal result") as AppraisalRecord["result"],
    findings: json<AppraisalFinding[]>(row.findings, []),
    origin: stringValue(row.origin, "appraisal origin") as AppraisalOrigin,
    ...(typeof row.scholarly_finding_id === "string" ? { scholarlyFindingId: row.scholarly_finding_id } : {}),
    commandId: stringValue(row.command_id, "appraisal command id"),
    createdAt: stringValue(row.created_at, "appraisal creation time")
  };
}

function synthesisFromRow(row: Record<string, unknown>): SynthesisRecord {
  return {
    id: stringValue(row.id, "synthesis id"),
    claimIds: json<string[]>(row.claim_ids, []),
    summary: stringValue(row.summary, "synthesis summary"),
    disagreements: json<Record<string, unknown>[]>(row.disagreements, []),
    limitations: json<string[]>(row.limitations, []),
    reassessmentFlags: json<string[]>(row.reassessment_flags, []),
    qualifications: json<string[]>(row.qualifications, []),
    commandId: stringValue(row.command_id, "synthesis command id"),
    createdAt: stringValue(row.created_at, "synthesis creation time")
  };
}

function findingsFor(request: AppraisalRequest, methodKind: MethodKind): AppraisalFinding[] {
  const supplied = [...(request.findings ?? [])];
  const byDimension = new Map(supplied.map((finding) => [finding.dimension, finding]));
  if (methodKind === "reflexive-thematic-analysis") {
    for (const dimension of ["inter-coder-agreement", "statistical-power"]) {
      byDimension.set(dimension, { dimension, applicability: "not-applicable", result: "not-applicable", rationale: "not applicable to reflexive thematic analysis" });
    }
  }
  if (methodKind === "quantitative-dependent-observations") {
    const addressed = request.dependentObservationsAddressed ?? request.analysis?.dependentObservationsAddressed;
    if (addressed === false) {
      byDimension.set("dependent-observations-addressed", { dimension: "dependent-observations-addressed", applicability: "applicable", result: "analysis-issue", rationale: "recorded analysis ignores dependent observations, clustering or repeated measures" });
    } else if (addressed === true && !byDimension.has("dependent-observations-addressed")) {
      byDimension.set("dependent-observations-addressed", { dimension: "dependent-observations-addressed", applicability: "applicable", result: "pass", rationale: "dependent observations are addressed in the recorded analysis" });
    }
  }
  return [...byDimension.values()];
}

export function recordAppraisal(handle: ProjectHandle, capability: unknown, request: AppraisalRequest): AppraisalRecord {
  assertWritable(handle);
  if (!allowed(handle, capability, ["evidence:appraise"])) {throw new ProjectStoreError("forbidden", "appraisal requires evidence:appraise capability");}
  getSourceVersion(handle, request.sourceVersionId);
  const methodKind = normalizeMethodKind(request.methodKind ?? request.method ?? "unspecified");
  const findings = findingsFor(request, methodKind);
  const hasIssue = findings.some((finding) => finding.applicability === "applicable" && (finding.result === "analysis-issue" || finding.result === "missing"));
  const result: AppraisalRecord["result"] = hasIssue ? "needs-attention" : "pass";
  const origin: AppraisalOrigin = isOwnerCapability(capability)
    ? request.origin === "specialist-proposed" ? "specialist-proposed" : "owner-recorded"
    : "specialist-proposed";
  const scholarlyFindingId = request.scholarlyFindingId;
  const existing = handle.db.prepare("SELECT * FROM appraisals WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const old = appraisalFromRow(existing);
    const requestedPayload = payloadHash({ sourceVersionId: request.sourceVersionId, methodKind, result, findings, origin, scholarlyFindingId: scholarlyFindingId ?? null });
    const existingPayload = payloadHash({ sourceVersionId: old.sourceVersionId, methodKind: old.methodKind, result: old.result, findings: old.findings, origin: old.origin, scholarlyFindingId: old.scholarlyFindingId ?? null });
    if (requestedPayload !== existingPayload) {throw new ProjectStoreError("appraisal-payload-conflict", "command ID was reused with a different appraisal");}
    return old;
  }
  const appraisal: AppraisalRecord = {
    id: newId("appraisal"), sourceVersionId: request.sourceVersionId, methodKind,
    result, findings, origin,
    ...(scholarlyFindingId === undefined ? {} : { scholarlyFindingId }),
    commandId: request.commandId, createdAt: isoNow()
  };
  handle.db.prepare("INSERT INTO appraisals (id, source_version_id, method_kind, result, findings, origin, scholarly_finding_id, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(appraisal.id, appraisal.sourceVersionId, appraisal.methodKind, appraisal.result, JSON.stringify(appraisal.findings), appraisal.origin, appraisal.scholarlyFindingId ?? null, appraisal.commandId, appraisal.createdAt);
  return appraisal;
}

export function getAppraisal(handle: ProjectHandle, capability: unknown, appraisalId: string): AppraisalRecord {
  if (!allowed(handle, capability, ["evidence:inspect"]) && !allowed(handle, capability, ["evidence:appraise"])) {throw new ProjectStoreError("forbidden", "appraisal inspection requires evidence:inspect capability");}
  const row = handle.db.prepare("SELECT * FROM appraisals WHERE id = ?").get(appraisalId) as Record<string, unknown> | undefined;
  if (row === undefined) {throw new ProjectStoreError("appraisal-not-found", "appraisal was not found");}
  return appraisalFromRow(row);
}

export function synthesizeClaims(handle: ProjectHandle, capability: unknown, request: SynthesisRequest): SynthesisRecord {
  assertWritable(handle);
  if (!allowed(handle, capability, ["claim:inspect"])) {throw new ProjectStoreError("forbidden", "synthesis requires claim:inspect capability");}
  const matrix: EvidenceMatrix = buildEvidenceMatrix(handle, capability, { claimIds: request.claimIds });
  const disagreements = matrix.rows.flatMap((row) => row.disagreements);
  const limitations = [...new Set(matrix.rows.flatMap((row) => row.limitations))];
  const reassessmentFlags = matrix.rows.filter((row) => row.claim.currentSupport === "needs-reassessment" || row.reassessments.length > 0).map((row) => row.claim.id);
  const qualifications = [...new Set([
    ...(request.qualifications ?? []),
    ...(disagreements.length > 0 ? ["supporting and challenging evidence are retained"] : []),
    ...(limitations.length > 0 ? ["source access, extraction or integrity limitations remain attached"] : []),
    ...(reassessmentFlags.length > 0 ? ["some claims require reassessment after source notices"] : []),
    "interpretation remains bounded by the recorded evidence"
  ])];
  const record: SynthesisRecord = {
    id: newId("synthesis"), claimIds: matrix.rows.map((row) => row.claim.id),
    summary: request.summary ?? `Qualified synthesis of ${matrix.rows.length} claim${matrix.rows.length === 1 ? "" : "s"}`,
    disagreements, limitations, reassessmentFlags, qualifications,
    commandId: request.commandId, createdAt: isoNow()
  };
  const existing = handle.db.prepare("SELECT * FROM syntheses WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {return synthesisFromRow(existing);}
  transaction(handle.db, () => handle.db.prepare("INSERT INTO syntheses (id, claim_ids, summary, disagreements, limitations, reassessment_flags, qualifications, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(record.id, JSON.stringify(record.claimIds), record.summary, JSON.stringify(record.disagreements), JSON.stringify(record.limitations), JSON.stringify(record.reassessmentFlags), JSON.stringify(record.qualifications), record.commandId, record.createdAt));
  return record;
}

export function getSynthesis(handle: ProjectHandle, capability: unknown, synthesisId: string): SynthesisRecord {
  if (!allowed(handle, capability, ["claim:inspect"]) && !allowed(handle, capability, ["evidence:inspect"])) {throw new ProjectStoreError("forbidden", "synthesis inspection requires claim inspection capability");}
  const row = handle.db.prepare("SELECT * FROM syntheses WHERE id = ?").get(synthesisId) as Record<string, unknown> | undefined;
  if (row === undefined) {throw new ProjectStoreError("synthesis-not-found", "synthesis was not found");}
  return synthesisFromRow(row);
}
