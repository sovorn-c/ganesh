// story: e09s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import type {
  OrientationRecord,
  OrientationRequest,
  ProblemFramingRecord,
  ProblemFramingRequest,
  ResearchQuestionRecord,
  ResearchQuestionRequest,
  ResearchQuestionQuery,
  FramingInspection,
  MethodologyCandidateRecord,
  MethodologyCandidateRequest,
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

export { methodologySchemaAvailable, assertMethodologySchema } from "./methodology-utils.js";

function resolveAttribution(capability: unknown, requested?: ViewAttribution): ViewAttribution {
  const isOwner = isOwnerCapability(capability);
  if (!isOwner && requested === "human-stated") {
    throw new ProjectStoreError("forbidden", "workers cannot record human-stated attribution");
  }
  if (requested) {
    return requested;
  }
  return isOwner ? "human-stated" : "agent-inferred";
}

function resolveOrigin(capability: unknown, requested?: MethodologyOrigin): MethodologyOrigin {
  const isOwner = isOwnerCapability(capability);
  if (!isOwner && requested === "owner-recorded") {
    throw new ProjectStoreError("forbidden", "workers cannot record owner-recorded origin");
  }
  if (requested) {
    return requested;
  }
  return isOwner ? "owner-recorded" : "specialist-proposed";
}

export function recordOrientation(
  handle: ProjectHandle,
  capability: unknown,
  request: OrientationRequest
): OrientationRecord {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const topic = String(request.topic ?? "").trim();
  const discipline = String(request.discipline ?? "").trim();
  const immediateGoal = String(request.immediateGoal ?? "").trim();
  if (!topic || !discipline || !immediateGoal) {
    throw new ProjectStoreError("invalid-argument", "topic, discipline, and immediateGoal are required");
  }

  const unknowns = request.unknowns ? [...request.unknowns] : [];
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  const payloadHash = hashPayload({ topic, discipline, immediateGoal, unknowns, attribution, origin });

  const existingOp = handle.db
    .prepare("SELECT entity_id, payload_hash FROM methodology_operations WHERE command_id = ?")
    .get(commandId) as { entity_id: string; payload_hash: string } | undefined;

  if (existingOp) {
    if (existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    return inspectOrientation(handle, capability, existingOp.entity_id);
  }

  const id = newId("orient");
  const createdAt = isoNow();

  const artifact = registerArtifactVersion(handle, {
    logicalId: `methodology-orientation-${id}`,
    version: "1.0",
    content: JSON.stringify({ topic, discipline, immediateGoal, unknowns }),
    origin: "methodology-orientation",
    access: "metadata-only"
  });

  transaction(handle.db, () => {
    handle.db
      .prepare(`
        INSERT INTO orientations (id, topic, discipline, immediate_goal, unknowns, attribution, origin, artifact_version_id, command_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(id, topic, discipline, immediateGoal, JSON.stringify(unknowns), attribution, origin, artifact.id, commandId, createdAt);

    handle.db
      .prepare(`
        INSERT INTO methodology_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'orientation', ?, 'complete', ?, ?, ?)
      `)
      .run(commandId, payloadHash, id, createdAt, createdAt);
  });

  return {
    id,
    topic,
    discipline,
    immediateGoal,
    unknowns,
    attribution,
    origin,
    artifactVersionId: artifact.id,
    commandId,
    createdAt
  };
}

export function inspectOrientation(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): OrientationRecord {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:inspect");

  const row = handle.db
    .prepare("SELECT * FROM orientations WHERE id = ?")
    .get(id) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `orientation not found: ${id}`);
  }

  return {
    id: String(row.id),
    topic: String(row.topic),
    discipline: String(row.discipline),
    immediateGoal: String(row.immediate_goal),
    unknowns: JSON.parse(String(row.unknowns)),
    attribution: String(row.attribution) as ViewAttribution,
    origin: String(row.origin) as MethodologyOrigin,
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

export function recordProblemFraming(
  handle: ProjectHandle,
  capability: unknown,
  request: ProblemFramingRequest
): ProblemFramingRecord {
  handle.assertCurrent();
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

export function recordResearchQuestionAlternative(
  handle: ProjectHandle,
  capability: unknown,
  request: ResearchQuestionRequest
): ResearchQuestionRecord {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:frame");

  const questionText = String(request.questionText ?? "").trim();
  if (!request.orientationId || !questionText) {
    throw new ProjectStoreError("invalid-argument", "orientationId and questionText are required");
  }

  inspectOrientation(handle, capability, request.orientationId);

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
  let version = 1;

  if (request.supersedesId) {
    const prior = handle.db
      .prepare("SELECT version FROM research_questions WHERE id = ?")
      .get(request.supersedesId) as { version: number } | undefined;
    if (prior) {
      version = prior.version + 1;
    }
  }

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
  sql += " ORDER BY version ASC, created_at ASC";

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
    .prepare("SELECT * FROM problem_framings WHERE orientation_id = ? ORDER BY created_at ASC")
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
    .prepare("SELECT * FROM methodology_candidates WHERE orientation_id = ? ORDER BY created_at ASC")
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
  handle.assertCurrent();
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
