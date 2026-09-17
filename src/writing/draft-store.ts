// story: e13s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { bytesFor, isoNow, newId, sha256 } from "../persistence/storage-utils.js";
import {
  assertWritingSchema,
  assertWritingRecordAccess,
  assertWritingInspectAccess,
  findWritingOperation,
  recordWritingOperation,
  writingSchemaAvailable
} from "./writing-utils.js";
import type {
  DraftRecord,
  RecordDraftRequest,
  InspectDraftQuery,
  DraftInspection,
  LinkDraftAssertionRequest,
  AssertionLink,
  RecordDraftLimitationRequest,
  DraftLimitation,
  RecordAiContributionRequest,
  AiContributionRecord,
  CompleteWithInsufficientEvidenceRequest,
  IngestWritingCandidateRequest,
  WritingCandidateRecord,
  UnsupportedCitationDetail
} from "./writing-types.js";

export { writingSchemaAvailable, assertWritingSchema };

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

function draftFromRow(row: DraftRow): DraftRecord {
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

export function recordDraft(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordDraftRequest
): DraftRecord {
  assertWritable(handle);
  assertWritingSchema(handle);
  const { isOwner } = assertWritingRecordAccess(handle, capability);

  if (!request.title || request.title.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "draft title must not be empty");
  }
  if (request.bodyMarkdown === undefined || request.bodyMarkdown === null) {
    throw new ProjectStoreError("invalid-argument", "draft bodyMarkdown is required");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  // Idempotency check
  const existingOp = findWritingOperation(handle.db, request.commandId, "record-draft");
  if (existingOp && existingOp.entityId) {
    const existingRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(existingOp.entityId) as unknown as DraftRow | undefined;
    if (existingRow) {
      return draftFromRow(existingRow);
    }
  }

  const existingByCommand = handle.db.prepare("SELECT * FROM drafts WHERE command_id = ?").get(request.commandId) as unknown as DraftRow | undefined;
  if (existingByCommand) {
    return draftFromRow(existingByCommand);
  }

  const findingKind = request.findingKind ?? "positive";
  const validFindingKinds = ["positive", "negative", "inconclusive", "insufficient-evidence"];
  if (!validFindingKinds.includes(findingKind)) {
    throw new ProjectStoreError("invalid-argument", `invalid findingKind: ${findingKind}`);
  }

  let attribution: DraftRecord["attribution"];
  let origin: DraftRecord["origin"];

  if (isOwner) {
    attribution = request.attribution ?? "human-stated";
    origin = "owner-recorded";
  } else {
    // Specialist worker cannot claim human-stated
    attribution = request.attribution === "human-stated" ? "agent-inferred" : (request.attribution ?? "agent-inferred");
    origin = "specialist-proposed";
  }

  const versionNumber = request.versionNumber ?? 1;
  const draftId = newId("draft");
  const branchId = request.branchId ?? "main";
  const bodyHash = sha256(bytesFor(request.bodyMarkdown));

  // Register artifact version
  const artifact = registerArtifactVersion(handle, {
    logicalId: draftId,
    version: `v${versionNumber}`,
    versionId: `${draftId}-v${versionNumber}`,
    content: request.bodyMarkdown,
    origin: "interpretation-draft",
    access: "metadata-only"
  });

  const now = isoNow();
  handle.db.prepare(`
    INSERT INTO drafts (
      id, title, body_markdown, body_hash, finding_kind, next_action,
      attribution, origin, artifact_version_id, branch_id, status,
      version_number, prior_draft_id, command_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?, ?, ?)
  `).run(
    draftId,
    request.title,
    request.bodyMarkdown,
    bodyHash,
    findingKind,
    request.nextAction ?? null,
    attribution,
    origin,
    artifact.id,
    branchId,
    versionNumber,
    request.priorDraftId ?? null,
    request.commandId,
    now,
    now
  );

  recordWritingOperation(
    handle.db,
    request.commandId,
    "record-draft",
    sha256(bytesFor(JSON.stringify(request))),
    draftId,
    null
  );

  const row = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(draftId) as unknown as DraftRow;
  return draftFromRow(row);
}

export function linkDraftAssertion(
  handle: ProjectHandle,
  capability: unknown,
  request: LinkDraftAssertionRequest
): AssertionLink {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingRecordAccess(handle, capability);

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }
  if (!request.claimId && !request.evidenceItemId && !request.analysisRunId) {
    throw new ProjectStoreError("invalid-argument", "assertion link requires at least one target (claimId, evidenceItemId, or analysisRunId)");
  }
  const validRoles = ["supports", "qualifies", "challenges"];
  if (!validRoles.includes(request.role)) {
    throw new ProjectStoreError("invalid-argument", `invalid assertion role: ${request.role}`);
  }

  // Verify draft exists
  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft ${request.draftId} not found`);
  }

  // Idempotency check
  const existingOp = findWritingOperation(handle.db, request.commandId, "link-draft-assertion");
  if (existingOp && existingOp.entityId) {
    const row = handle.db.prepare("SELECT * FROM draft_assertion_links WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        draftId: String(row.draft_id),
        claimId: typeof row.claim_id === "string" ? row.claim_id : undefined,
        evidenceItemId: typeof row.evidence_item_id === "string" ? row.evidence_item_id : undefined,
        analysisRunId: typeof row.analysis_run_id === "string" ? row.analysis_run_id : undefined,
        role: row.role as AssertionLink["role"],
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      };
    }
  }

  const existingByCommand = handle.db.prepare("SELECT * FROM draft_assertion_links WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existingByCommand) {
    return {
      id: String(existingByCommand.id),
      draftId: String(existingByCommand.draft_id),
      claimId: typeof existingByCommand.claim_id === "string" ? existingByCommand.claim_id : undefined,
      evidenceItemId: typeof existingByCommand.evidence_item_id === "string" ? existingByCommand.evidence_item_id : undefined,
      analysisRunId: typeof existingByCommand.analysis_run_id === "string" ? existingByCommand.analysis_run_id : undefined,
      role: existingByCommand.role as AssertionLink["role"],
      commandId: String(existingByCommand.command_id),
      createdAt: String(existingByCommand.created_at)
    };
  }

  // Verify targets if supplied
  if (request.claimId) {
    const claim = handle.db.prepare("SELECT id FROM claims WHERE id = ?").get(request.claimId);
    if (!claim) {
      throw new ProjectStoreError("not-found", `claim ${request.claimId} not found`);
    }
  }
  if (request.evidenceItemId) {
    const item = handle.db.prepare("SELECT id FROM evidence_items WHERE id = ?").get(request.evidenceItemId);
    if (!item) {
      throw new ProjectStoreError("not-found", `evidence item ${request.evidenceItemId} not found`);
    }
  }
  if (request.analysisRunId) {
    const run = handle.db.prepare("SELECT id FROM analysis_runs WHERE id = ?").get(request.analysisRunId);
    if (!run) {
      throw new ProjectStoreError("not-found", `analysis run ${request.analysisRunId} not found`);
    }
  }

  const linkId = newId("assertion-link");
  const now = isoNow();
  handle.db.prepare(`
    INSERT INTO draft_assertion_links (id, draft_id, claim_id, evidence_item_id, analysis_run_id, role, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    linkId,
    request.draftId,
    request.claimId ?? null,
    request.evidenceItemId ?? null,
    request.analysisRunId ?? null,
    request.role,
    request.commandId,
    now
  );

  recordWritingOperation(
    handle.db,
    request.commandId,
    "link-draft-assertion",
    sha256(bytesFor(JSON.stringify(request))),
    linkId,
    null
  );

  return {
    id: linkId,
    draftId: request.draftId,
    claimId: request.claimId,
    evidenceItemId: request.evidenceItemId,
    analysisRunId: request.analysisRunId,
    role: request.role,
    commandId: request.commandId,
    createdAt: now
  };
}

export function recordDraftLimitation(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordDraftLimitationRequest
): DraftLimitation {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingRecordAccess(handle, capability);

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (!request.limitationText || request.limitationText.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "limitationText must not be empty");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft ${request.draftId} not found`);
  }

  const existingOp = findWritingOperation(handle.db, request.commandId, "record-draft-limitation");
  if (existingOp && existingOp.entityId) {
    const row = handle.db.prepare("SELECT * FROM draft_limitations WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        draftId: String(row.draft_id),
        limitationText: String(row.limitation_text),
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      };
    }
  }

  const id = newId("limitation");
  const now = isoNow();
  handle.db.prepare(`
    INSERT INTO draft_limitations (id, draft_id, limitation_text, command_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, request.draftId, request.limitationText, request.commandId, now);

  recordWritingOperation(
    handle.db,
    request.commandId,
    "record-draft-limitation",
    sha256(bytesFor(JSON.stringify(request))),
    id,
    null
  );

  return {
    id,
    draftId: request.draftId,
    limitationText: request.limitationText,
    commandId: request.commandId,
    createdAt: now
  };
}

export function recordAiContribution(
  handle: ProjectHandle,
  capability: unknown,
  request: RecordAiContributionRequest
): AiContributionRecord {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingRecordAccess(handle, capability);

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (!request.summary || request.summary.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "summary must not be empty");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  const draftRow = handle.db.prepare("SELECT id FROM drafts WHERE id = ?").get(request.draftId);
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft ${request.draftId} not found`);
  }

  const existingOp = findWritingOperation(handle.db, request.commandId, "record-ai-contribution");
  if (existingOp && existingOp.entityId) {
    const row = handle.db.prepare("SELECT * FROM ai_contributions WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        draftId: String(row.draft_id),
        summary: String(row.summary),
        disclosureNeeded: Boolean(row.disclosure_needed),
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      };
    }
  }

  const id = newId("ai-contrib");
  const now = isoNow();
  handle.db.prepare(`
    INSERT INTO ai_contributions (id, draft_id, summary, disclosure_needed, command_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, request.draftId, request.summary, request.disclosureNeeded ? 1 : 0, request.commandId, now);

  recordWritingOperation(
    handle.db,
    request.commandId,
    "record-ai-contribution",
    sha256(bytesFor(JSON.stringify(request))),
    id,
    null
  );

  return {
    id,
    draftId: request.draftId,
    summary: request.summary,
    disclosureNeeded: request.disclosureNeeded,
    commandId: request.commandId,
    createdAt: now
  };
}

export function completeWithInsufficientEvidence(
  handle: ProjectHandle,
  capability: unknown,
  request: CompleteWithInsufficientEvidenceRequest
): DraftRecord {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingRecordAccess(handle, capability);

  if (!request.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }
  if (!request.nextAction || request.nextAction.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "nextAction must not be empty");
  }
  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as unknown as DraftRow | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("not-found", `draft ${request.draftId} not found`);
  }

  const now = isoNow();
  handle.db.prepare(`
    UPDATE drafts SET finding_kind = 'insufficient-evidence', next_action = ?, updated_at = ?
    WHERE id = ?
  `).run(request.nextAction, now, request.draftId);

  recordWritingOperation(
    handle.db,
    request.commandId,
    "complete-insufficient-evidence",
    sha256(bytesFor(JSON.stringify(request))),
    request.draftId,
    null
  );

  const updatedRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(request.draftId) as unknown as DraftRow;
  return draftFromRow(updatedRow);
}

export function ingestWritingCandidate(
  handle: ProjectHandle,
  capability: unknown,
  request: IngestWritingCandidateRequest
): WritingCandidateRecord {
  assertWritable(handle);
  assertWritingSchema(handle);
  assertWritingRecordAccess(handle, capability);

  if (!request.commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required");
  }

  const existingOp = findWritingOperation(handle.db, request.commandId, "ingest-candidate");
  if (existingOp && existingOp.entityId) {
    const row = handle.db.prepare("SELECT * FROM writing_candidates WHERE id = ?").get(existingOp.entityId) as Record<string, unknown> | undefined;
    if (row) {
      return {
        id: String(row.id),
        payload: String(row.payload),
        attribution: row.attribution as WritingCandidateRecord["attribution"],
        origin: "specialist-proposed",
        status: "candidate",
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      };
    }
  }

  const payloadString = typeof request.payload === "string" ? request.payload : JSON.stringify(request.payload);
  const attribution = request.attribution ?? "agent-inferred";
  const id = newId("writing-candidate");
  const now = isoNow();

  handle.db.prepare(`
    INSERT INTO writing_candidates (id, payload, attribution, origin, status, command_id, created_at)
    VALUES (?, ?, ?, 'specialist-proposed', 'candidate', ?, ?)
  `).run(id, payloadString, attribution, request.commandId, now);

  recordWritingOperation(
    handle.db,
    request.commandId,
    "ingest-candidate",
    sha256(bytesFor(JSON.stringify(request))),
    id,
    null
  );

  return {
    id,
    payload: payloadString,
    attribution,
    origin: "specialist-proposed",
    status: "candidate",
    commandId: request.commandId,
    createdAt: now
  };
}

export function inspectDraft(
  handle: ProjectHandle,
  capability: unknown,
  query: InspectDraftQuery
): DraftInspection {
  assertWritingSchema(handle);
  assertWritingInspectAccess(handle, capability);

  if (!query.draftId) {
    throw new ProjectStoreError("invalid-argument", "draftId is required");
  }

  const draftRow = handle.db.prepare("SELECT * FROM drafts WHERE id = ?").get(query.draftId) as unknown as DraftRow | undefined;
  if (!draftRow) {
    throw new ProjectStoreError("draft-not-found", `draft ${query.draftId} not found`);
  }

  const draft = draftFromRow(draftRow);

  // Assertions
  const assertionRows = handle.db.prepare(
    "SELECT * FROM draft_assertion_links WHERE draft_id = ? ORDER BY created_at, id"
  ).all(query.draftId) as Array<Record<string, unknown>>;

  const assertions: AssertionLink[] = assertionRows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    claimId: typeof row.claim_id === "string" ? row.claim_id : undefined,
    evidenceItemId: typeof row.evidence_item_id === "string" ? row.evidence_item_id : undefined,
    analysisRunId: typeof row.analysis_run_id === "string" ? row.analysis_run_id : undefined,
    role: row.role as AssertionLink["role"],
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  }));

  // Limitations
  const limitationRows = handle.db.prepare(
    "SELECT * FROM draft_limitations WHERE draft_id = ? ORDER BY created_at, id"
  ).all(query.draftId) as Array<Record<string, unknown>>;

  const limitations: DraftLimitation[] = limitationRows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    limitationText: String(row.limitation_text),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  }));

  // AI contributions
  const aiRows = handle.db.prepare(
    "SELECT * FROM ai_contributions WHERE draft_id = ? ORDER BY created_at, id"
  ).all(query.draftId) as Array<Record<string, unknown>>;

  const aiContributions: AiContributionRecord[] = aiRows.map((row) => ({
    id: String(row.id),
    draftId: String(row.draft_id),
    summary: String(row.summary),
    disclosureNeeded: Boolean(row.disclosure_needed),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  }));

  // Unsupported citations from E07
  const unsupportedCitations: UnsupportedCitationDetail[] = [];
  const missingLinks: string[] = [];

  for (const assertion of assertions) {
    if (assertion.claimId) {
      const claimRow = handle.db.prepare("SELECT * FROM claims WHERE id = ?").get(assertion.claimId) as Record<string, unknown> | undefined;
      if (claimRow) {
        const currentSupport = String(claimRow.current_support ?? "");
        if (currentSupport === "unsupported" || currentSupport === "access-limited") {
          unsupportedCitations.push({
            claimId: assertion.claimId,
            supportStatus: currentSupport
          });
        }
        // Also check citation_verifications table
        const verifications = handle.db.prepare(
          "SELECT * FROM citation_verifications WHERE claim_id = ?"
        ).all(assertion.claimId) as Array<Record<string, unknown>>;
        for (const v of verifications) {
          const supportStatus = String(v.support_status ?? "");
          const accessStatus = String(v.access_status ?? "");
          if (supportStatus === "unsupported" || accessStatus === "limited" || accessStatus === "unavailable") {
            if (!unsupportedCitations.some((item) => item.claimId === assertion.claimId && item.citationId === String(v.id))) {
              unsupportedCitations.push({
                claimId: assertion.claimId,
                citationId: String(v.id),
                sourceVersionId: typeof v.source_version_id === "string" ? v.source_version_id : undefined,
                supportStatus,
                accessStatus
              });
            }
          }
        }
      }
    }
    if (!assertion.claimId && !assertion.analysisRunId) {
      missingLinks.push(`assertion-${assertion.id}-missing-claim-and-analysis`);
    } else if (!assertion.analysisRunId) {
      missingLinks.push(`assertion-${assertion.id}-missing-analysis-run`);
    }
  }

  return {
    draft,
    assertions,
    limitations,
    aiContributions,
    unsupportedCitations,
    missingLinks
  };
}
