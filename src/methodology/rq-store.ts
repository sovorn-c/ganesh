// story: e09s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  ResearchQuestionRecord,
  ResearchQuestionRequest,
  ResearchQuestionQuery,
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
import { resolveAttribution, resolveOrigin, inspectOrientation } from "./orientation-store.js";

export function recordResearchQuestionAlternative(
  handle: ProjectHandle,
  capability: unknown,
  request: ResearchQuestionRequest
): ResearchQuestionRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const questionText = String(request.questionText ?? "").trim();
  if (!request.orientationId || !questionText) {
    throw new ProjectStoreError("invalid-argument", "orientationId and questionText are required");
  }

  inspectOrientation(handle, capability, request.orientationId);

  let version = 1;
  if (request.supersedesId) {
    const prior = handle.db
      .prepare("SELECT id, orientation_id, version FROM research_questions WHERE id = ?")
      .get(request.supersedesId) as { id: string; orientation_id: string; version: number } | undefined;
    if (!prior) {
      throw new ProjectStoreError("not-found", `superseded research question not found: ${request.supersedesId}`);
    }
    if (prior.orientation_id !== request.orientationId) {
      throw new ProjectStoreError("invalid-argument", "superseded research question belongs to different orientation");
    }
    version = prior.version + 1;
  }

  if (request.framingId) {
    const framing = handle.db
      .prepare("SELECT id, orientation_id FROM problem_framings WHERE id = ?")
      .get(request.framingId) as { id: string; orientation_id: string } | undefined;
    if (!framing) {
      throw new ProjectStoreError("not-found", `problem framing not found: ${request.framingId}`);
    }
    if (framing.orientation_id !== request.orientationId) {
      throw new ProjectStoreError("invalid-argument", "problem framing belongs to different orientation");
    }
  }

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({
    orientationId: request.orientationId,
    framingId: request.framingId,
    questionText,
    gapAssessmentId: request.gapAssessmentId,
    contributionProposalId: request.contributionProposalId,
    supersedesId: request.supersedesId,
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
      .prepare("SELECT * FROM research_questions WHERE id = ?")
      .get(existingOp.entity_id) as Record<string, unknown>;
    return {
      id: String(row.id),
      orientationId: String(row.orientation_id),
      framingId: row.framing_id ? String(row.framing_id) : undefined,
      questionText: String(row.question_text),
      status: String(row.status) as ResearchQuestionRecord["status"],
      version: Number(row.version),
      supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
      gapAssessmentId: row.gap_assessment_id ? String(row.gap_assessment_id) : undefined,
      contributionProposalId: row.contribution_proposal_id ? String(row.contribution_proposal_id) : undefined,
      attribution: String(row.attribution) as ViewAttribution,
      origin: String(row.origin) as MethodologyOrigin,
      artifactVersionId: String(row.artifact_version_id),
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("rq");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-rq-${id}`,
    version: `${version}.0`,
    content: JSON.stringify({ questionText }),
    origin: "methodology-rq",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    if (request.supersedesId) {
      handle.db
        .prepare("UPDATE research_questions SET status = 'superseded', superseded_by = ? WHERE id = ?")
        .run(id, request.supersedesId);
    }

    handle.db
      .prepare(`
        INSERT INTO research_questions (id, orientation_id, framing_id, question_text, status, version, superseded_by, gap_assessment_id, contribution_proposal_id, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, 'candidate', ?, NULL, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        request.orientationId,
        request.framingId ?? null,
        questionText,
        version,
        request.gapAssessmentId ?? null,
        request.contributionProposalId ?? null,
        attribution,
        origin,
        artifact.id,
        commandId,
        createdAt
      );

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'research_question', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    orientationId: request.orientationId,
    framingId: request.framingId,
    questionText,
    status: "candidate",
    version,
    gapAssessmentId: request.gapAssessmentId,
    contributionProposalId: request.contributionProposalId,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}

export function listResearchQuestionAlternatives(
  handle: ProjectHandle,
  capability: unknown,
  query?: ResearchQuestionQuery
): readonly ResearchQuestionRecord[] {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:inspect");

  let sql = "SELECT * FROM research_questions";
  const params: (string | number | null)[] = [];
  const clauses: string[] = [];

  if (query?.orientationId) {
    clauses.push("orientation_id = ?");
    params.push(query.orientationId);
  }
  if (query?.status) {
    clauses.push("status = ?");
    params.push(query.status);
  }
  if (clauses.length > 0) {
    sql += " WHERE " + clauses.join(" AND ");
  }
  sql += " ORDER BY version ASC, created_at ASC, rowid ASC";

  const rows = handle.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    orientationId: String(row.orientation_id),
    framingId: row.framing_id ? String(row.framing_id) : undefined,
    questionText: String(row.question_text),
    status: String(row.status) as ResearchQuestionRecord["status"],
    version: Number(row.version),
    supersededBy: row.superseded_by ? String(row.superseded_by) : undefined,
    gapAssessmentId: row.gap_assessment_id ? String(row.gap_assessment_id) : undefined,
    contributionProposalId: row.contribution_proposal_id ? String(row.contribution_proposal_id) : undefined,
    attribution: String(row.attribution) as ViewAttribution,
    origin: String(row.origin) as MethodologyOrigin,
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  }));
}
