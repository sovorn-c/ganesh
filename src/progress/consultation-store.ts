import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { listCommitments } from "../decisions/commitment-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type { ProblemFramingRecord } from "../methodology/methodology-types.js";
import { inspectProgress } from "./progress-store.js";
import { inspectProtocol } from "./protocol-store.js";
import type {
  StudyConsultationLimit,
  ReportedPriorCommitmentQuery,
  ReportedPriorCommitmentRecord,
  ReportedPriorCommitmentRequest,
  StudyConsultationQuery,
  StudyConsultationView
} from "./consultation-types.js";
import {
  assertBranch,
  assertProgressAccess,
  assertProgressSchema,
  hashPayload,
  isoNow,
  newId,
  optionalText,
  requiredText,
  resolveAttribution,
  resolveOrigin
} from "./progress-utils.js";

const SOURCE_KINDS = ["imported-text", "supervisor-feedback", "owner-narrative"] as const;

function priorFromRow(row: Record<string, unknown>): ReportedPriorCommitmentRecord {
  return {
    id: String(row.id), statement: String(row.statement), attributedActor: String(row.attributed_actor),
    sourceArtifactVersionId: row.source_artifact_version_id ? String(row.source_artifact_version_id) : undefined,
    sourceKind: String(row.source_kind) as ReportedPriorCommitmentRecord["sourceKind"],
    occurredOn: row.occurred_on ? String(row.occurred_on) : undefined,
    protocolVersionId: row.protocol_version_id ? String(row.protocol_version_id) : undefined,
    authenticity: "reported",
    attribution: String(row.attribution) as ReportedPriorCommitmentRecord["attribution"],
    origin: String(row.origin) as ReportedPriorCommitmentRecord["origin"],
    artifactVersionId: String(row.artifact_version_id), commandId: String(row.command_id),
    branchId: String(row.branch_id), createdAt: String(row.created_at)
  };
}

function operationEntity(handle: ProjectHandle, commandId: string, payloadHash: string): string | undefined {
  const row = handle.db.prepare("SELECT kind, payload_hash, entity_id FROM progress_operations WHERE command_id = ?").get(commandId) as
    | { kind?: unknown; payload_hash?: unknown; entity_id?: unknown } | undefined;
  if (!row) {return undefined;}
  if (row.kind !== "reported-prior-commitment" || row.payload_hash !== payloadHash) {
    throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
  }
  return typeof row.entity_id === "string" ? row.entity_id : undefined;
}

function priorById(handle: ProjectHandle, id: string): ReportedPriorCommitmentRecord {
  const row = handle.db.prepare("SELECT * FROM reported_prior_commitments WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {throw new ProjectStoreError("not-found", `reported prior commitment ${id} was not found`);}
  return priorFromRow(row);
}

export function recordReportedPriorCommitment(handle: ProjectHandle, capability: unknown, request: ReportedPriorCommitmentRequest): ReportedPriorCommitmentRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  const statement = requiredText(request.statement, "statement");
  const attributedActor = requiredText(request.attributedActor, "attributedActor");
  if (!SOURCE_KINDS.includes(request.sourceKind)) {
    throw new ProjectStoreError("invalid-argument", `sourceKind must be one of: ${SOURCE_KINDS.join(", ")}`);
  }
  if (request.authenticity !== undefined && request.authenticity !== "reported") {
    throw new ProjectStoreError("forbidden", "reported prior commitments cannot be authenticated through this API");
  }
  const sourceArtifactVersionId = request.sourceArtifactVersionId;
  if (sourceArtifactVersionId !== undefined) {
    assertIdentifier(sourceArtifactVersionId, "sourceArtifactVersionId");
    if (handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(sourceArtifactVersionId) === undefined) {
      throw new ProjectStoreError("artifact-not-found", `source artifact ${sourceArtifactVersionId} was not found`);
    }
  }
  const branchId = assertBranch(handle, request.branchId ?? "main");
  const protocolVersionId = request.protocolVersionId;
  if (protocolVersionId !== undefined) {
    assertIdentifier(protocolVersionId, "protocolVersionId");
    const protocol = handle.db.prepare("SELECT id, branch_id FROM protocol_versions WHERE id = ?").get(protocolVersionId) as { id?: unknown; branch_id?: unknown } | undefined;
    if (!protocol) {throw new ProjectStoreError("not-found", `protocol version ${protocolVersionId} was not found`);}
    if (String(protocol.branch_id) !== branchId) {throw new ProjectStoreError("forbidden", "reported prior commitment must use the protocol branch");}
  }
  const occurredOn = optionalText(request.occurredOn, "occurredOn");
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({ statement, attributedActor, sourceArtifactVersionId: sourceArtifactVersionId ?? null, sourceKind: request.sourceKind, occurredOn: occurredOn ?? null, protocolVersionId: protocolVersionId ?? null, attribution, origin, branchId });
  const existingId = operationEntity(handle, commandId, payloadHash);
  if (existingId) {return priorById(handle, existingId);}
  const id = newId("reported-prior");
  const createdAt = isoNow();
  const artifact = registerArtifactVersion(handle, {
    logicalId: `reported-prior-${id}`, version: "1.0",
    content: JSON.stringify({ statement, attributedActor, sourceArtifactVersionId, sourceKind: request.sourceKind, occurredOn, protocolVersionId, authenticity: "reported", attribution, origin }),
    origin: "reported-prior-commitment", access: "metadata-only",
    dependencies: sourceArtifactVersionId ? [{ versionId: sourceArtifactVersionId, relation: "reported-source" }] : []
  });
  try {
    transaction(handle.db, () => {
      handle.db.prepare(`
        INSERT INTO reported_prior_commitments (
          id, statement, attributed_actor, source_artifact_version_id, source_kind, occurred_on,
          protocol_version_id, authenticity, attribution, origin, artifact_version_id, command_id,
          branch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?)
      `).run(id, statement, attributedActor, sourceArtifactVersionId ?? null, request.sourceKind, occurredOn ?? null, protocolVersionId ?? null, attribution, origin, artifact.id, commandId, branchId, createdAt);
      handle.db.prepare(`
        INSERT INTO progress_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'reported-prior-commitment', ?, 'complete', ?, ?, ?)
      `).run(commandId, payloadHash, id, createdAt, createdAt);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }
  return priorById(handle, id);
}

export function inspectReportedPriorCommitments(handle: ProjectHandle, capability: unknown, query: ReportedPriorCommitmentQuery = {}): readonly ReportedPriorCommitmentRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const conditions: string[] = [];
  const params: string[] = [];
  for (const [column, value] of [["id", query.id], ["branch_id", query.branchId], ["protocol_version_id", query.protocolVersionId]] as const) {
    if (value !== undefined) { conditions.push(`${column} = ?`); params.push(value); }
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return (handle.db.prepare(`SELECT * FROM reported_prior_commitments${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>).map(priorFromRow);
}

function framingFromRow(row: Record<string, unknown>): ProblemFramingRecord {
  return {
    id: String(row.id), orientationId: String(row.orientation_id), statement: String(row.statement), boundaries: String(row.boundaries),
    gapAssessmentId: row.gap_assessment_id ? String(row.gap_assessment_id) : undefined,
    contributionProposalId: row.contribution_proposal_id ? String(row.contribution_proposal_id) : undefined,
    attribution: String(row.attribution) as ProblemFramingRecord["attribution"],
    origin: String(row.origin) as ProblemFramingRecord["origin"], artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id), createdAt: String(row.created_at)
  };
}

export function inspectStudyConsultation(handle: ProjectHandle, capability: unknown, query: StudyConsultationQuery = {}): StudyConsultationView {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const branchId = assertBranch(handle, query.branchId ?? "main");
  const methodologyDrafts = (handle.db.prepare("SELECT * FROM problem_framings ORDER BY created_at, rowid").all() as Array<Record<string, unknown>>).map(framingFromRow);
  const protocolVersions = inspectProtocol(handle, capability, { branchId });
  const progress = inspectProgress(handle, capability, { branchId });
  const authenticatedCommitments = listCommitments(handle).filter((item) => item.branchId === branchId);
  const reportedPriorCommitments = inspectReportedPriorCommitments(handle, capability, { branchId });
  const limits: StudyConsultationLimit[] = [];
  if (Number((handle.db.prepare("SELECT COUNT(*) AS count FROM orientations").get() as { count: number }).count) === 0) {
    limits.push({ code: "missing-orientation", message: "No orientation is recorded; consultation did not infer one." });
  }
  if (Number((handle.db.prepare("SELECT COUNT(*) AS count FROM corpus_records").get() as { count: number }).count) === 0) {
    limits.push({ code: "missing-literature", message: "No literature corpus is recorded; consultation did not invent findings." });
  }
  if (Number((handle.db.prepare("SELECT COUNT(*) AS count FROM evidence_items").get() as { count: number }).count) === 0) {
    limits.push({ code: "missing-data", message: "No evidence or data item is recorded; consultation did not invent data." });
  }
  if (!protocolVersions.some((item) => item.status === "in-force")) {
    limits.push({ code: "missing-protocol-in-force", message: "No protocol version is in force on this branch." });
  }
  return { methodologyDrafts, protocolVersions, progress, authenticatedCommitments, reportedPriorCommitments, limits };
}
