// story: e13s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
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
  ReviewIssue,
  RecordReviewIssueRequest,
  ListReviewIssuesQuery,
  RequestDraftRevisionRequest,
  DraftRecord
} from "./writing-types.js";

interface IssueRow {
  id: string;
  draft_id: string;
  rank: number;
  title: string;
  description: string;
  evidence_version_id: string | null;
  status: string;
  command_id: string;
  created_at: string;
  updated_at: string;
}

function issueFromRow(row: IssueRow): ReviewIssue {
  return {
    id: row.id,
    draftId: row.draft_id,
    rank: row.rank,
    title: row.title,
    description: row.description,
    evidenceVersionId: row.evidence_version_id ?? undefined,
    status: row.status as ReviewIssue["status"],
    commandId: row.command_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function recordReviewIssue(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordReviewIssueRequest
): ReviewIssue {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingReviewAccess(handle, capability);

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (typeof request.rank !== "number" || !Number.isInteger(request.rank) || request.rank < 1) {
    throw new ProjectStoreError("invalid-argument", "rank must be a positive integer");
  }
  if (!request.title || request.title.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "title must not be empty");
  }
  if (!request.description || request.description.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "description must not be empty");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  // Verify draft exists
  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft ${request.draftId} not found`);
  }

  // If evidenceVersionId supplied, verify artifact version exists
  if (request.evidenceVersionId) {
    const artifactRow = handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(request.evidenceVersionId);
    if (!artifactRow) {
      throw new ProjectStoreError("not-found", `evidence artifact version ${request.evidenceVersionId} not found`);
    }
  }

  // Idempotency check
  const existingOp = findWritingOperation(handle.db, request.commandId, "record-review-issue");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM review_issues WHERE id = ?").get(existingOp.entityId) as unknown as IssueRow | undefined;
    if (existingRow) {
      return issueFromRow(existingRow);
    }
  }

  const existingByCommand = handle.db.prepare("SELECT * FROM review_issues WHERE command_id = ?").get(request.commandId) as unknown as IssueRow | undefined;
  if (existingByCommand) {
    return issueFromRow(existingByCommand);
  }

  const issueId = newId("issue");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO review_issues (id, draft_id, rank, title, description, evidence_version_id, status, command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?, ?)
  `).run(
    issueId,
    request.draftId,
    request.rank,
    request.title,
    request.description,
    request.evidenceVersionId ?? null,
    request.commandId,
    now,
    now
  );

  recordWritingOperation(
    handle.db,
    request.commandId,
    "record-review-issue",
    sha256(bytesFor(JSON.stringify(request))),
    issueId,
    null
  );

  const row = handle.db.prepare("SELECT * FROM review_issues WHERE id = ?").get(issueId) as unknown as IssueRow;
  return issueFromRow(row);
}

export function listReviewIssues(
  handle: ProjectHandle,
  capability: unknown,
  query: ListReviewIssuesQuery
): readonly ReviewIssue[] {
  assertWritingSchema(handle);
  assertWritingInspectAccess(handle, capability);

  if (!query.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }

  const rows = handle.db.prepare(
    "SELECT * FROM review_issues WHERE draft_id = ? ORDER BY rank ASC, created_at ASC, id ASC"
  ).all(query.draftId) as unknown as Array<IssueRow>;

  return rows.map(issueFromRow);
}

interface DraftRow {
  id: string;
  title: string;
  body_markdown: string;
  body_hash: string;
  finding_kind: string;
  next_action: string | null;
  attribution: string;
  origin: string;
  artifact_version_id: string;
  branch_id: string;
  status: string;
  version_number: number;
  prior_draft_id: string | null;
  command_id: string;
  created_at: string;
  updated_at: string;
}

export function requestDraftRevision(
  handle: ProjectHandle,
  capability: unknown,
  request: RequestDraftRevisionRequest
): DraftRecord {
  assertWritable(handle);
  assertWritingSchema(handle);
  // Owner only — star-workers and unauthorized workers are strictly rejected
  assertOwner(handle, capability, "requestDraftRevision");

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (request.revisedBodyMarkdown === undefined || request.revisedBodyMarkdown === null) {
    throw new ProjectStoreError("invalid-argument", "revisedBodyMarkdown is required");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  // Verify prior draft exists
  const priorDraft = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as unknown as DraftRow | undefined;
  if (!priorDraft) {
    throw new ProjectStoreError("not-found", `prior draft ${request.draftId} not found`);
  }

  // Idempotency check
  const existingOp = findWritingOperation(handle.db, request.commandId, "request-draft-revision");
  if (existingOp && existingOp.entityId) {
    const existing = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(existingOp.entityId) as unknown as DraftRow | undefined;
    if (existing) {
      return {
        id: existing.id,
        title: existing.title,
        bodyMarkdown: existing.body_markdown,
        bodyHash: existing.body_hash,
        findingKind: existing.finding_kind as DraftRecord["findingKind"],
        nextAction: existing.next_action ?? undefined,
        attribution: existing.attribution as DraftRecord["attribution"],
        origin: existing.origin as DraftRecord["origin"],
        artifactVersionId: existing.artifact_version_id,
        branchId: existing.branch_id,
        status: existing.status as DraftRecord["status"],
        versionNumber: existing.version_number,
        priorDraftId: existing.prior_draft_id ?? undefined,
        commandId: existing.command_id,
        createdAt: existing.created_at,
        updatedAt: existing.updated_at
      };
    }
  }

  const existingByCommand = handle.db.prepare("SELECT * FROM drafts WHERE command_id = ?").get(request.commandId) as unknown as DraftRow | undefined;
  if (existingByCommand) {
    return {
      id: existingByCommand.id,
      title: existingByCommand.title,
      bodyMarkdown: existingByCommand.body_markdown,
      bodyHash: existingByCommand.body_hash,
      findingKind: existingByCommand.finding_kind as DraftRecord["findingKind"],
      nextAction: existingByCommand.next_action ?? undefined,
      attribution: existingByCommand.attribution as DraftRecord["attribution"],
      origin: existingByCommand.origin as DraftRecord["origin"],
      artifactVersionId: existingByCommand.artifact_version_id,
      branchId: existingByCommand.branch_id,
      status: existingByCommand.status as DraftRecord["status"],
      versionNumber: existingByCommand.version_number,
      priorDraftId: existingByCommand.prior_draft_id ?? undefined,
      commandId: existingByCommand.command_id,
      createdAt: existingByCommand.created_at,
      updatedAt: existingByCommand.updated_at
    };
  }

  const newVersion = priorDraft.version_number + 1;
  const newDraftId = newId("draft");
  const bodyHash = sha256(bytesFor(request.revisedBodyMarkdown));

  // Register artifact version for the new draft
  const artifact = registerArtifactVersion(handle, {
    logicalId: newDraftId,
    version: `v${newVersion}`,
    versionId: `${newDraftId}-v${newVersion}`,
    content: request.revisedBodyMarkdown,
    origin: "interpretation-draft",
    access: "metadata-only"
  });

  const now = isoNow();
  handle.db.prepare(`
    INSERT INTO drafts (
      id, title, body_markdown, body_hash, finding_kind, next_action,
      attribution, origin, artifact_version_id, branch_id, status,
      version_number, prior_draft_id, command_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'human-stated', 'owner-recorded', ?, ?, 'candidate', ?, ?, ?, ?, ?)
  `).run(
    newDraftId,
    priorDraft.title,
    request.revisedBodyMarkdown,
    bodyHash,
    priorDraft.finding_kind,
    priorDraft.next_action,
    artifact.id,
    priorDraft.branch_id,
    newVersion,
    priorDraft.id,
    request.commandId,
    now,
    now
  );

  recordWritingOperation(
    handle.db,
    request.commandId,
    "request-draft-revision",
    sha256(bytesFor(JSON.stringify(request))),
    newDraftId,
    null
  );

  const row = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(newDraftId) as unknown as DraftRow;
  return {
    id: row.id,
    title: row.title,
    bodyMarkdown: row.body_markdown,
    bodyHash: row.body_hash,
    findingKind: row.finding_kind as DraftRecord["findingKind"],
    nextAction: row.next_action ?? undefined,
    attribution: row.attribution as DraftRecord["attribution"],
    origin: row.origin as DraftRecord["origin"],
    artifactVersionId: row.artifact_version_id,
    branchId: row.branch_id,
    status: row.status as DraftRecord["status"],
    versionNumber: row.version_number,
    priorDraftId: row.prior_draft_id ?? undefined,
    commandId: row.command_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
