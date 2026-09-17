// story: e13s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { bytesFor, isoNow, newId, sha256 } from "../persistence/storage-utils.js";
import {
  assertWritingSchema,
  assertOwner,
  assertWritingReviewAccess,
  assertWritingInspectAccess,
  findWritingOperation,
  recordWritingOperation
} from "./writing-utils.js";
import type {
  OpenReviewCycleRequest,
  RecordOwnerCycleDispositionRequest,
  RecordSupervisorFeedbackRequest,
  ReviewCycle,
  ReviewCycleDisposition,
  ReviewCycleInspection,
  ReviewCycleStatus,
  SupervisorFeedback,
  ReviewIssue,
  DraftRecord
} from "./writing-types.js";

function mapCycleRow(row: Record<string, unknown>): ReviewCycle {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    status: String(row.status) as ReviewCycleStatus,
    revisionCount: Number(row.revision_count),
    disposition: row.disposition ? (String(row.disposition) as ReviewCycleDisposition) : undefined,
    dispositionNotes: row.disposition_notes ? String(row.disposition_notes) : undefined,
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapFeedbackRow(row: Record<string, unknown>): SupervisorFeedback {
  return {
    id: String(row.id),
    cycleId: String(row.cycle_id),
    draftId: String(row.draft_id),
    supervisorName: String(row.supervisor_name),
    supervisorRole: String(row.supervisor_role),
    authenticity: "reported",
    feedbackText: String(row.feedback_text),
    dissentText: row.dissent_text ? String(row.dissent_text) : undefined,
    artifactVersionId: row.artifact_version_id ? String(row.artifact_version_id) : undefined,
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

function mapDraftRow(row: Record<string, unknown>): DraftRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    bodyMarkdown: String(row.body_markdown),
    bodyHash: String(row.body_hash),
    findingKind: String(row.finding_kind) as DraftRecord["findingKind"],
    nextAction: row.next_action ? String(row.next_action) : undefined,
    attribution: String(row.attribution) as DraftRecord["attribution"],
    origin: String(row.origin) as DraftRecord["origin"],
    artifactVersionId: String(row.artifact_version_id),
    branchId: String(row.branch_id),
    status: "candidate",
    versionNumber: Number(row.version_number),
    priorDraftId: row.prior_draft_id ? String(row.prior_draft_id) : undefined,
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function mapIssueRow(row: Record<string, unknown>): ReviewIssue {
  return {
    id: String(row.id),
    draftId: String(row.draft_id),
    rank: Number(row.rank),
    title: String(row.title),
    description: String(row.description),
    evidenceVersionId: row.evidence_version_id ? String(row.evidence_version_id) : undefined,
    status: String(row.status) as ReviewIssue["status"],
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function openReviewCycle(
  handle: ProjectHandle,
  capability: unknown,
  request: OpenReviewCycleRequest
): ReviewCycle {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertWritingReviewAccess(handle, capability);

  if (!request.draftId?.trim() || !request.commandId?.trim()) {
    throw new ProjectStoreError("invalid-argument", "draftId and commandId are required");
  }

  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found: ${request.draftId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "open-review-cycle");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapCycleRow(existingRow);
    }
  }

  const id = newId("cycle");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO review_cycles (id, draft_id, status, revision_count, disposition, disposition_notes, command_id, created_at, updated_at)
    VALUES (?, ?, 'open', 0, NULL, NULL, ?, ?, ?)
  `).run(id, request.draftId, request.commandId, now, now);

  recordWritingOperation(handle.db, request.commandId, "open-review-cycle", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(id) as Record<string, unknown>;
  return mapCycleRow(row);
}

export function recordSupervisorFeedback(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordSupervisorFeedbackRequest
): SupervisorFeedback {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertWritingReviewAccess(handle, capability);

  const reqAny = request as unknown as { authenticity?: unknown };
  if (reqAny.authenticity !== undefined && reqAny.authenticity !== "reported") {
    throw new ProjectStoreError("forbidden", "forbidden: supervisor feedback authenticity cannot be upgraded from 'reported'");
  }

  if (!request.cycleId?.trim() || !request.draftId?.trim() || !request.commandId?.trim()) {
    throw new ProjectStoreError("invalid-argument", "cycleId, draftId and commandId are required");
  }

  const cycleRow = handle.db.prepare("SELECT id, draft_id FROM review_cycles WHERE id = ?").get(request.cycleId) as { id: string; draft_id: string } | undefined;
  if (!cycleRow) {
    throw new ProjectStoreError("not-found", `review cycle not found: ${request.cycleId}`);
  }
  if (request.draftId !== cycleRow.draft_id) {
    throw new ProjectStoreError("invalid-argument", "draftId does not match review cycle draft");
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "record-supervisor-feedback");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM supervisor_feedbacks WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapFeedbackRow(existingRow);
    }
  }

  const id = newId("feedback");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO supervisor_feedbacks (id, cycle_id, draft_id, supervisor_name, supervisor_role, authenticity, feedback_text, dissent_text, artifact_version_id, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?)
  `).run(
    id,
    request.cycleId,
    request.draftId,
    request.supervisorName,
    request.supervisorRole,
    request.feedbackText,
    request.dissentText ?? null,
    request.artifactVersionId ?? null,
    request.commandId,
    now
  );

  recordWritingOperation(handle.db, request.commandId, "record-supervisor-feedback", payloadHash, id, null);

  const row = handle.db.prepare("SELECT * FROM supervisor_feedbacks WHERE id = ?").get(id) as Record<string, unknown>;
  return mapFeedbackRow(row);
}

export function recordOwnerCycleDisposition(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordOwnerCycleDispositionRequest
): ReviewCycle {
  assertWritingSchema(handle);
  assertWritable(handle);
  assertOwner(handle, capability, "recordOwnerCycleDisposition");

  if (!request.cycleId?.trim() || !request.commandId?.trim()) {
    throw new ProjectStoreError("invalid-argument", "cycleId and commandId are required");
  }

  const cycleRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(request.cycleId) as Record<string, unknown> | undefined;
  if (!cycleRow) {
    throw new ProjectStoreError("not-found", `review cycle not found: ${request.cycleId}`);
  }

  const payloadHash = sha256(bytesFor(JSON.stringify(request)));
  const existingOp = findWritingOperation(handle.db, request.commandId, "record-owner-cycle-disposition");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (existingRow) {
      return mapCycleRow(existingRow);
    }
  }

  let newStatus: ReviewCycleStatus = String(cycleRow.status) as ReviewCycleStatus;
  let newRevisionCount = Number(cycleRow.revision_count);
  let newDisposition: ReviewCycleDisposition = request.disposition;

  if (request.disposition === "request-revision" || request.disposition === "revised") {
    if (newRevisionCount >= 1) {
      newStatus = "returned-to-owner";
      newDisposition = "returned-to-owner";
    } else {
      newStatus = "revision-requested";
      newRevisionCount += 1;
    }
  } else if (request.disposition === "return-to-owner" || request.disposition === "returned-to-owner") {
    newStatus = "returned-to-owner";
    newDisposition = "returned-to-owner";
  } else if (
    request.disposition === "adopted" ||
    request.disposition === "acknowledge" ||
    request.disposition === "close" ||
    request.disposition === "rejected"
  ) {
    newStatus = "completed";
  }

  const now = isoNow();
  handle.db.prepare(`
    UPDATE review_cycles
    SET status = ?, revision_count = ?, disposition = ?, disposition_notes = ?, updated_at = ?
    WHERE id = ?
  `).run(
    newStatus,
    newRevisionCount,
    newDisposition,
    request.notes ?? null,
    now,
    request.cycleId
  );

  recordWritingOperation(handle.db, request.commandId, "record-owner-cycle-disposition", payloadHash, request.cycleId, null);

  const updatedRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(request.cycleId) as Record<string, unknown>;
  return mapCycleRow(updatedRow);
}

export function inspectReviewCycle(
  handle: ProjectHandle,
  capability: unknown,
  query: string | { readonly cycleId: string }
): ReviewCycleInspection {
  assertWritingSchema(handle);
  assertWritingInspectAccess(handle, capability);

  const cycleId = typeof query === "string" ? query : query.cycleId;
  const cycleRow = handle.db.prepare("SELECT * FROM review_cycles WHERE id = ?").get(cycleId) as Record<string, unknown> | undefined;
  if (!cycleRow) {
    throw new ProjectStoreError("not-found", `review cycle not found: ${cycleId}`);
  }

  const cycle = mapCycleRow(cycleRow);
  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(cycle.draftId) as Record<string, unknown> | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft not found for review cycle: ${cycle.draftId}`);
  }
  const draft = mapDraftRow(draftRow);

  const feedbackRows = handle.db.prepare(
    "SELECT * FROM supervisor_feedbacks WHERE cycle_id = ? ORDER BY created_at ASC"
  ).all(cycleId) as Array<Record<string, unknown>>;
  const feedbacks = feedbackRows.map(mapFeedbackRow);

  const issueRows = handle.db.prepare(
    "SELECT * FROM review_issues WHERE draft_id = ? ORDER BY rank ASC, created_at ASC"
  ).all(cycle.draftId) as Array<Record<string, unknown>>;
  const issues = issueRows.map(mapIssueRow);

  return {
    cycle,
    draft,
    feedbacks,
    issues
  };
}
