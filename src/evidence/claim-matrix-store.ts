import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { getSourceVersion } from "../sources/source-store.js";
import { recordSharedSourceCorrection } from "../branches/dependency-store.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import { transaction } from "../persistence/schema.js";
import { getEvidenceItem } from "./evidence-store.js";
import {
  allowed,
  assertClaimSchema,
  claimFromRow,
  json,
  linkFromRow,
  listClaims,
  reassessmentFromRow,
  reassessmentsFor
} from "./claim-store.js";
import type {
  ClaimReassessment,
  EvidenceMatrix,
  EvidenceMatrixRequest,
  EvidenceMatrixRow,
  ReassessmentResult,
  SourceNoticeRequest
} from "./claim-types.js";

export function listClaimReassessments(handle: ProjectHandle, claimId: string): readonly ClaimReassessment[];
export function listClaimReassessments(handle: ProjectHandle, capability: unknown, claimId: string): readonly ClaimReassessment[];
export function listClaimReassessments(handle: ProjectHandle, capabilityOrClaimId: unknown, maybeClaimId?: string): readonly ClaimReassessment[] {
  assertClaimSchema(handle);
  const claimId = typeof capabilityOrClaimId === "string" ? capabilityOrClaimId : maybeClaimId;
  if (claimId === undefined) {throw new ProjectStoreError("invalid-claim", "claim id is required");}
  if (typeof capabilityOrClaimId !== "string" && !allowed(handle, capabilityOrClaimId, ["claim:inspect"]) && !allowed(handle, capabilityOrClaimId, ["evidence:inspect"])) {throw new ProjectStoreError("forbidden", "claim inspection requires a capability");}
  return reassessmentsFor(handle, claimId);
}

export function buildEvidenceMatrix(handle: ProjectHandle, capability: unknown, request: EvidenceMatrixRequest = {}): EvidenceMatrix {
  assertInspection(handle, capability, "matrix inspection requires claim:inspect capability");
  const claims = listClaims(handle, capability);
  const selected = request.claimIds === undefined ? claims : claims.filter((claim) => request.claimIds?.includes(claim.id));
  const rows = selected.map((claim) => matrixRow(handle, capability, claim.id, claim));
  return { rows, generatedAt: isoNow() };
}

function assertInspection(handle: ProjectHandle, capability: unknown, message: string): void {
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:inspect"]) && !allowed(handle, capability, ["evidence:inspect"])) {
    throw new ProjectStoreError("forbidden", message);
  }
}

function assertCapability(handle: ProjectHandle, capability: unknown, operations: readonly string[], message: string): void {
  assertClaimSchema(handle);
  if (!allowed(handle, capability, operations)) {throw new ProjectStoreError("forbidden", message);}
}

function matrixRow(handle: ProjectHandle, capability: unknown, claimId: string, claim: EvidenceMatrixRow["claim"]): EvidenceMatrixRow {
  const rows = handle.db.prepare("SELECT * FROM claim_evidence_links WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>;
  const links = rows.map((row) => linkFromRow(row, getEvidenceItem(handle, capability, String(row.evidence_item_id))));
  const supporting = links.filter((link) => link.role === "supporting");
  const challenging = links.filter((link) => link.role === "challenging");
  const limitations = matrixLimitations(handle, claimId, links);
  const disagreements = supporting.length > 0 && challenging.length > 0
    ? [{ kind: "supporting-and-challenging", supportingCount: supporting.length, challengingCount: challenging.length }]
    : [];
  return { claim, supporting, challenging, disagreements, limitations, reassessments: [...reassessmentsFor(handle, claim.id)] };
}

function matrixLimitations(handle: ProjectHandle, claimId: string, links: readonly ReturnType<typeof linkFromRow>[]): string[] {
  const linkLimitations = links.flatMap((link) => [
    ...(link.evidence?.limitations ?? []),
    ...(link.qualification === "" ? [] : [link.qualification]),
    ...(link.verificationStatus === "unverified" || link.verificationStatus === "substantively-supported" ? [] : [`verification-${link.verificationStatus}`])
  ]);
  const citationRows = handle.db.prepare("SELECT limitations FROM citation_verifications WHERE claim_id = ?").all(claimId) as Array<Record<string, unknown>>;
  return [...new Set([...linkLimitations, ...citationRows.flatMap((row) => json<string[]>(row.limitations, []))])];
}

export function applySourceNotice(handle: ProjectHandle, capability: unknown, request: SourceNoticeRequest): ReassessmentResult {
  assertWritable(handle);
  assertCapability(handle, capability, ["claim:record", "evidence:inspect"], "source notice requires claim:record and evidence:inspect capability");
  const notice = request.notice ?? request.message ?? "";
  if (notice.trim() === "") {throw new ProjectStoreError("invalid-notice", "source notice must not be empty");}
  getSourceVersion(handle, request.sourceVersionId);
  const prior = handle.db.prepare("SELECT * FROM claim_reassessments WHERE notice_command_id = ? ORDER BY claim_id").all(request.commandId) as Array<Record<string, unknown>>;
  if (prior.length > 0) {return duplicateNotice(request, prior);}
  recordSharedSourceCorrection(handle, {
    sourceVersionId: request.sourceVersionId,
    notice: `${request.kind ?? "correction"}: ${notice}`,
    commandId: request.commandId,
    actor: request.actor
  });
  const claimRows = linkedClaims(handle, request.sourceVersionId);
  const reassessments: ClaimReassessment[] = [];
  transaction(handle.db, () => {
    for (const row of claimRows) {reassessments.push(insertReassessment(handle, row, request, notice));}
  });
  return { status: "applied", commandId: request.commandId, sourceVersionId: request.sourceVersionId, claimIds: reassessments.map((item) => item.claimId), reassessments };
}

function duplicateNotice(request: SourceNoticeRequest, rows: readonly Record<string, unknown>[]): ReassessmentResult {
  return {
    status: "duplicate",
    commandId: request.commandId,
    sourceVersionId: request.sourceVersionId,
    claimIds: rows.map((row) => String(row.claim_id)),
    reassessments: rows.map(reassessmentFromRow)
  };
}

function linkedClaims(handle: ProjectHandle, sourceVersionId: string): Array<Record<string, unknown>> {
  return handle.db.prepare("SELECT DISTINCT c.* FROM claims c JOIN claim_evidence_links l ON l.claim_id = c.id JOIN evidence_items e ON e.id = l.evidence_item_id WHERE e.source_version_id = ? ORDER BY c.id").all(sourceVersionId) as Array<Record<string, unknown>>;
}

function insertReassessment(handle: ProjectHandle, row: Record<string, unknown>, request: SourceNoticeRequest, notice: string): ClaimReassessment {
  const claim = claimFromRow(row);
  const reassessment: ClaimReassessment = {
    id: newId("reassessment"),
    claimId: claim.id,
    sourceVersionId: request.sourceVersionId,
    noticeCommandId: request.commandId,
    previousSupport: claim.currentSupport,
    currentSupport: "needs-reassessment",
    reason: notice,
    createdAt: isoNow()
  };
  handle.db.prepare("INSERT INTO claim_reassessments (id, claim_id, source_version_id, notice_command_id, previous_support, current_support, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(reassessment.id, reassessment.claimId, reassessment.sourceVersionId, reassessment.noticeCommandId, reassessment.previousSupport, reassessment.currentSupport, reassessment.reason, reassessment.createdAt);
  handle.db.prepare("UPDATE claims SET current_support = 'needs-reassessment', updated_at = ? WHERE id = ?").run(reassessment.createdAt, claim.id);
  return reassessment;
}
