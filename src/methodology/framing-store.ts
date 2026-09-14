// story: e09s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import type {
  ProblemFramingRecord,
  ResearchQuestionRecord,
  FramingInspection,
  MethodologyCandidateRecord,
  MethodologyCandidateRequest,
  ViewAttribution,
  MethodologyOrigin
} from "./methodology-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  newId,
  isoNow
} from "./methodology-utils.js";
import { inspectOrientation } from "./orientation-store.js";
import { recordProblemFraming } from "./problem-store.js";
import {
  recordResearchQuestionAlternative,
  listResearchQuestionAlternatives
} from "./rq-store.js";

export { methodologySchemaAvailable, assertMethodologySchema } from "./methodology-utils.js";
export { recordOrientation, inspectOrientation } from "./orientation-store.js";
export { recordProblemFraming } from "./problem-store.js";
export {
  recordResearchQuestionAlternative,
  listResearchQuestionAlternatives
} from "./rq-store.js";

export function inspectFraming(
  handle: ProjectHandle,
  capability: unknown,
  orientationId: string
): FramingInspection {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:inspect");

  const orientation = inspectOrientation(handle, capability, orientationId);

  const framingRows = handle.db
    .prepare("SELECT * FROM problem_framings WHERE orientation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(orientationId) as Array<Record<string, unknown>>;

  const problemFramings: ProblemFramingRecord[] = framingRows.map((row) => ({
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
  }));

  const researchQuestions = listResearchQuestionAlternatives(handle, capability, { orientationId });

  const candidateRows = handle.db
    .prepare("SELECT * FROM methodology_candidates WHERE orientation_id = ? ORDER BY created_at ASC, rowid ASC")
    .all(orientationId) as Array<Record<string, unknown>>;

  const candidates: MethodologyCandidateRecord[] = candidateRows.map((row) => ({
    id: String(row.id),
    orientationId: String(row.orientation_id),
    specialistRole: String(row.specialist_role),
    candidateType: String(row.candidate_type),
    payload: JSON.parse(String(row.payload)),
    origin: "specialist-proposed",
    createdAt: String(row.created_at)
  }));

  return {
    orientation,
    problemFramings,
    researchQuestions,
    unknowns: orientation.unknowns,
    candidates
  };
}

export function ingestMethodologyCandidate(
  handle: ProjectHandle,
  capability: unknown,
  request: MethodologyCandidateRequest
): MethodologyCandidateRecord {
  assertWritable(handle);
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  inspectOrientation(handle, capability, request.orientationId);

  const isOwner = isOwnerCapability(capability);
  if (!isOwner && request.origin === "owner-recorded") {
    throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded origin");
  }

  const id = newId("cand");
  const createdAt = isoNow();
  const specialistRole = request.specialistRole ?? "methodology";
  let rqRecord: ResearchQuestionRecord | undefined;

  if (request.candidateType === "research-question" && typeof request.payload?.questionText === "string") {
    rqRecord = recordResearchQuestionAlternative(handle, capability, {
      orientationId: request.orientationId,
      questionText: String(request.payload.questionText),
      attribution: "agent-inferred",
      origin: "specialist-proposed",
      commandId: request.commandId
    });
  }

  handle.db
    .prepare(`
      INSERT INTO methodology_candidates (id, orientation_id, specialist_role, candidate_type, payload, origin, created_at)
      VALUES (?, ?, ?, ?, ?, 'specialist-proposed', ?)
    `)
    .run(id, request.orientationId, specialistRole, request.candidateType, JSON.stringify(request.payload), createdAt);

  return {
    id,
    orientationId: request.orientationId,
    specialistRole,
    candidateType: request.candidateType,
    payload: request.payload,
    origin: "specialist-proposed",
    createdAt,
    researchQuestion: rqRecord
  };
}
