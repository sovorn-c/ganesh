// story: e09s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  ProblemFramingRecord,
  ProblemFramingRequest,
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

export function recordProblemFraming(
  handle: ProjectHandle,
  capability: unknown,
  request: ProblemFramingRequest
): ProblemFramingRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const statement = String(request.statement ?? "").trim();
  const boundaries = String(request.boundaries ?? "").trim();
  if (!request.orientationId || !statement || !boundaries) {
    throw new ProjectStoreError("invalid-argument", "orientationId, statement, and boundaries are required");
  }

  inspectOrientation(handle, capability, request.orientationId);

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({
    orientationId: request.orientationId,
    statement,
    boundaries,
    gapAssessmentId: request.gapAssessmentId,
    contributionProposalId: request.contributionProposalId,
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
      .prepare("SELECT * FROM problem_framings WHERE id = ?")
      .get(existingOp.entity_id) as Record<string, unknown>;
    return {
      id: String(row.id),
      orientationId: String(row.orientation_id),
      statement: String(row.statement),
      boundaries: String(row.boundaries),
      gapAssessmentId: row.gap_assessment_id ? String(row.gap_assessment_id) : undefined,
      contributionProposalId: row.contribution_proposal_id ? String(row.contribution_proposal_id) : undefined,
      attribution: String(row.attribution) as ViewAttribution,
      origin: String(row.origin) as MethodologyOrigin,
      artifactVersionId: String(row.artifact_version_id),
      commandId: String(row.command_id),
      createdAt: String(row.created_at)
    };
  }

  const id = newId("framing");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-problem-${id}`,
    version: "1.0",
    content: JSON.stringify({ statement, boundaries }),
    origin: "methodology-problem",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO problem_framings (id, orientation_id, statement, boundaries, gap_assessment_id, contribution_proposal_id, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        request.orientationId,
        statement,
        boundaries,
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
        VALUES (?, 'problem_framing', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    orientationId: request.orientationId,
    statement,
    boundaries,
    gapAssessmentId: request.gapAssessmentId,
    contributionProposalId: request.contributionProposalId,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}
