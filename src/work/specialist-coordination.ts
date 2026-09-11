// story: e05s02
import { randomUUID } from "node:crypto";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWorkSchema, getContract, getRun } from "./work-store.js";
import { queueRun, requireWorkCapability } from "./work-runtime.js";
import type { DisagreementInput, DisagreementRecord, RoleSnapshot, SpecialistRole, WorkRunInput, WorkRunRecord } from "./work-types.js";

function contractReference(reference: string): { id: string; version?: number } {
  const at = reference.lastIndexOf("@");
  if (at <= 0) {return { id: reference };}
  const version = Number(reference.slice(at + 1));
  return Number.isInteger(version) ? { id: reference.slice(0, at), version } : { id: reference };
}

export function queueRoleRun(handle: ProjectHandle, capability: unknown, request: WorkRunInput & { readonly role: SpecialistRole }): WorkRunRecord {
  const contract = getContract(handle, request.contractId, request.contractVersion);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${request.contractId}`);}
  if (!contract.permittedRoles.includes(request.role)) {throw new ProjectStoreError("forbidden", `role ${request.role} is not permitted`);}
  return queueRun(handle, capability, request);
}

export function readRoleSnapshot(handle: ProjectHandle, capability: unknown, runId: string): RoleSnapshot {
  requireWorkCapability(handle, capability, "work:read-role-snapshot");
  const run = getRun(handle, runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  const contract = getContract(handle, run.contractId, run.contractVersion);
  if (!contract) {throw new ProjectStoreError("not-found", "run contract not found");}
  // Deliberately expose only the assigned version IDs; conversation and unassigned bytes are never in this record.
  const scope = contract.scope as { reviewQuestion?: unknown; standards?: unknown };
  return { runId, role: run.role, objective: contract.objective, inputVersionIds: run.inputVersionIds, reviewQuestion: run.role === "reviewer" && typeof scope.reviewQuestion === "string" ? scope.reviewQuestion : undefined, standards: run.role === "reviewer" && Array.isArray(scope.standards) ? scope.standards.map(String) : undefined, assignedAt: run.createdAt };
}

export function recordDisagreement(handle: ProjectHandle, capability: unknown, input: DisagreementInput): DisagreementRecord {
  requireWorkCapability(handle, capability, "work:record-disagreement");
  assertWorkSchema(handle);
  if (!input.question.trim() || input.leftRole === input.rightRole) {throw new ProjectStoreError("invalid-argument", "a disagreement needs a question and two roles");}
  const reference = contractReference(input.contractId);
  const contract = getContract(handle, reference.id, reference.version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${input.contractId}`);}
  const createdAt = new Date().toISOString();
  const id = `disagreement-${randomUUID()}`;
  const previous = handle.db.prepare("SELECT revision_count FROM work_disagreements WHERE contract_id = ? AND question = ? ORDER BY created_at DESC LIMIT 1").get(contract.id, input.question) as { revision_count?: number } | undefined;
  const revisionCount = Number(previous?.revision_count ?? 0);
  const status = revisionCount >= 1 ? "returned-to-owner" : "open";
  handle.db.prepare(`INSERT INTO work_disagreements
    (id, contract_id, question, left_role, right_role, left_candidate_version_id, right_candidate_version_id, left_source_basis, right_source_basis, revision_count, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, contract.id, input.question, input.leftRole, input.rightRole, input.leftCandidateVersionId, input.rightCandidateVersionId, JSON.stringify(input.leftSourceBasis), JSON.stringify(input.rightSourceBasis), revisionCount, status, createdAt);
  return { ...input, contractId: contract.id, id, revisionCount, status, createdAt };
}

export function listDisagreements(handle: ProjectHandle, contractId: string): readonly DisagreementRecord[] {
  assertWorkSchema(handle);
  const reference = contractReference(contractId);
  return (handle.db.prepare("SELECT * FROM work_disagreements WHERE contract_id = ? ORDER BY created_at").all(reference.id) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), contractId: String(row.contract_id), question: String(row.question), leftRole: String(row.left_role) as SpecialistRole, rightRole: String(row.right_role) as SpecialistRole, leftCandidateVersionId: String(row.left_candidate_version_id), rightCandidateVersionId: String(row.right_candidate_version_id), leftSourceBasis: JSON.parse(String(row.left_source_basis)), rightSourceBasis: JSON.parse(String(row.right_source_basis)), revisionCount: Number(row.revision_count), status: String(row.status) as DisagreementRecord["status"], createdAt: String(row.created_at) }));
}

export function requestTargetedRevision(handle: ProjectHandle, capability: unknown, disagreementId: string): WorkRunRecord | { readonly status: "waiting-for-human"; readonly disagreementId: string; readonly reason: string } {
  assertWorkSchema(handle);
  const row = handle.db.prepare("SELECT * FROM work_disagreements WHERE id = ?").get(disagreementId) as Record<string, unknown> | undefined;
  if (!row) {throw new ProjectStoreError("not-found", `disagreement not found: ${disagreementId}`);}
  if (Number(row.revision_count) >= 1 || String(row.status) === "returned-to-owner") {return { status: "waiting-for-human", disagreementId, reason: "the single targeted revision has already been used" };}
  const contractId = String(row.contract_id);
  const role = String(row.right_role) as SpecialistRole;
  const run = queueRoleRun(handle, capability, { contractId, role, commandId: `revision-${disagreementId}`, reservation: { calls: 1, tokens: 0, timeMs: 0 } });
  handle.db.prepare("UPDATE work_disagreements SET revision_count = revision_count + 1 WHERE id = ?").run(disagreementId);
  return run;
}