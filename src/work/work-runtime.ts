// story: e05s01, e05s03, e05s04, e05s05
import { readFileSync } from "node:fs";
import { sha256, isoNow, newId, assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { createLifecycleOperation, checkLifecyclePolicy, updateLifecycleOperationStatus, fenceRevokedOperation, getLifecycleOperation, listQuarantinedOutputs, acceptCandidate } from "../lifecycle/lifecycle-gate.js";
import { isOwnerCapability, isWorkerCapability, type OwnerCapability } from "../authority/capability-broker.js";
import { registerArtifactVersion, inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { transaction } from "../persistence/schema.js";
import { reserveBudget, settleBudget, inspectBudget } from "./budget-ledger.js";
import { assertWorkSchema, authorizeStoredContract, candidateRows, getContract, getRun, getRunByCommand, insertCandidate, insertContract, insertRun, listRuns, updateRun, insertStandingPermission, getStandingPermission, replaceContractVersion } from "./work-store.js";
import type { BudgetDimension, CandidateAcceptance, CandidateSubmission, DisagreementRecord, SpecialistRole, SpecialistSessionPort, SpecialistSessionResult, StandingPermissionInput, StandingPermissionRecord, WorkContractInput, WorkContractRecord, WorkDiagnostic, WorkInspection, WorkRunInput, WorkRunRecord, RoleSnapshot } from "./work-types.js";

function requireOwner(handle: ProjectHandle, capability: unknown): OwnerCapability {
  if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {throw new ProjectStoreError("forbidden", "work owner operation requires the project's trusted OwnerCapability");}
  return capability;
}

export function requireWorkCapability(handle: ProjectHandle, capability: unknown, operation: string): void {
  if (isOwnerCapability(capability)) {
    if (capability.ownerId !== handle.project.ownerId) {throw new ProjectStoreError("forbidden", "owner capability does not belong to this project");}
    return;
  }
  if (!isWorkerCapability(capability) || capability.projectId !== handle.project.id || !capability.canPerform(operation)) {
    throw new ProjectStoreError("forbidden", `work operation requires scoped capability: ${operation}`);
  }
}

function requireAnyWorkCapability(handle: ProjectHandle, capability: unknown, operations: readonly string[]): void {
  if (isOwnerCapability(capability)) {
    requireWorkCapability(handle, capability, operations[0] ?? "work");
    return;
  }
  for (const operation of operations) {
    try { requireWorkCapability(handle, capability, operation); return; } catch { /* try the next explicitly scoped operation */ }
  }
  throw new ProjectStoreError("forbidden", `work operation requires one of: ${operations.join(", ")}`);
}

function safeDiagnostics(diagnostics: readonly WorkDiagnostic[] | undefined): readonly WorkDiagnostic[] {
  return (diagnostics ?? []).slice(0, 32).map((item) => ({
    code: String(item.code).slice(0, 160).replace(/(secret|token|password|credential|api[-_]?key)[^,;\s]*/gi, "$1=[redacted]"),
    severity: item.severity === "warning" || item.severity === "error" ? item.severity : "info",
    count: Number.isFinite(Number(item.count)) ? Math.max(1, Math.min(1000000, Number(item.count))) : 1
  }));
}

function hashPayload(value: unknown): string {
  return sha256(new TextEncoder().encode(JSON.stringify(value, (_key, item) => item instanceof Uint8Array ? Array.from(item) : item)));
}

function normalizeInputIds(contract: WorkContractRecord, requested?: readonly string[]): string[] {
  const ids = [...(requested ?? contract.inputVersionIds)];
  if (ids.some((id) => !contract.inputVersionIds.includes(id))) {throw new ProjectStoreError("forbidden", "run input is outside the authorized contract snapshot");}
  return ids;
}

function requestedReservation(contract: WorkContractRecord, request: WorkRunInput): Partial<Record<BudgetDimension, number>> {
  if (request.reservation !== undefined) {return request.reservation;}
  const quote = request.providerQuote;
  return { tokens: contract.limits.tokens, calls: 1, timeMs: contract.limits.timeMs, ...(contract.limits.spend === undefined ? {} : { spend: quote?.status === "known" ? quote.amount ?? 0 : 0 }) };
}

export function proposeContract(handle: ProjectHandle, capability: unknown, request: WorkContractInput): WorkContractRecord {
  const owner = requireOwner(handle, capability);
  const result = insertContract(handle, { ...request, authorizationBasis: request.authorizationBasis ?? `owner:${owner.ownerId}` });
  return result;
}

export function authorizeContract(handle: ProjectHandle, capability: unknown, request: { readonly contractId: string; readonly version?: number; readonly standingPermissionId?: string }): WorkContractRecord {
  const owner = requireOwner(handle, capability);
  const contract = getContract(handle, request.contractId, request.version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${request.contractId}`);}
  if (request.standingPermissionId !== undefined) {
    const standing = getStandingPermission(handle, request.standingPermissionId);
    if (!standing || standing.ownerId !== owner.ownerId || standing.status !== "active") {throw new ProjectStoreError("forbidden", "standing permission is not active for this owner");}
    const pattern = standing.objectivePattern ?? "*";
    const objectiveMatches = pattern === "*" || (pattern.endsWith("*") ? contract.objective.startsWith(pattern.slice(0, -1)) : contract.objective === pattern);
    const inputsMatch = contract.inputVersionIds.every((id) => standing.inputVersionIds === undefined || standing.inputVersionIds.includes(id));
    const limitsMatch = (Object.keys(contract.limits) as Array<keyof WorkContractRecord["limits"]>).every((key) => key === "currency" || standing.limits[key] === undefined || Number(standing.limits[key]) >= Number(contract.limits[key]));
    if (standing.role !== contract.permittedRoles[0] || (standing.destination !== contract.destination) || (standing.purpose !== contract.purpose) || !objectiveMatches || !inputsMatch || !limitsMatch) {throw new ProjectStoreError("forbidden", "standing permission does not match the contract");}
    if (standing.expiresAt !== undefined && Date.parse(standing.expiresAt) <= Date.now()) {throw new ProjectStoreError("forbidden", "standing permission has expired");}
  }
  return authorizeStoredContract(handle, contract.id, contract.version);
}

export function grantStandingPermission(handle: ProjectHandle, capability: unknown, request: StandingPermissionInput): StandingPermissionRecord {
  const owner = requireOwner(handle, capability);
  return insertStandingPermission(handle, owner.ownerId, request);
}

export function queueRun(handle: ProjectHandle, capability: unknown, request: WorkRunInput): WorkRunRecord {
  assertWritable(handle); assertWorkSchema(handle); requireWorkCapability(handle, capability, "work:queue-run");
  assertIdentifier(request.contractId, "contractId"); assertIdentifier(request.commandId, "commandId");
  const contract = getContract(handle, request.contractId, request.contractVersion);
  if (!contract || contract.status !== "authorized") {throw new ProjectStoreError("invalid-transition", "only an authorized contract can queue a run");}
  if ((request.destination !== undefined && request.destination !== contract.destination) || (request.purpose !== undefined && request.purpose !== contract.purpose)) {throw new ProjectStoreError("forbidden", "run destination and purpose must match the authorized contract");}
  const role = request.role ?? contract.permittedRoles[0];
  if (!contract.permittedRoles.includes(role)) {throw new ProjectStoreError("forbidden", `role ${role} is not permitted by this contract`);}
  const inputVersionIds = normalizeInputIds(contract, request.inputVersionIds ?? request.expectedVersionIds);
  const payload = { contractId: contract.id, version: contract.version, role, inputVersionIds, destination: request.destination ?? contract.destination, purpose: request.purpose ?? contract.purpose, reservation: request.reservation ?? null };
  const payloadHash = hashPayload(payload);
  const duplicate = getRunByCommand(handle, request.commandId);
  if (duplicate) {
    if (duplicate.payloadHash !== payloadHash) {throw new ProjectStoreError("command-conflict", "command conflict: command ID was reused with a different work request");}
    return duplicate;
  }
  const operation = createLifecycleOperation(handle, { id: newId("work-op"), operationType: "specialist-work", branchId: request.branchId ?? contract.branchId ?? null, inputSnapshot: { versionIds: inputVersionIds, contractId: contract.id, contractVersion: contract.version }, status: "queued" });
  const runId = newId("run");
  const reservation = requestedReservation(contract, request);
  const quote = request.providerQuote ?? (contract.destination === "local" ? { status: "known", amount: 0, currency: "USD", unit: "request" } : undefined);
  const budget = reserveBudget(handle, `${contract.id}@${contract.version}`, runId, reservation, quote);
  if (budget.status === "rejected") {
    transaction(handle.db, () => handle.db.prepare("DELETE FROM lifecycle_operations WHERE id = ?").run(operation.id));
    throw new ProjectStoreError("budget-exhausted", budget.reason ?? "work budget rejected");
  }
  return insertRun(handle, { id: runId, contractId: contract.id, contractVersion: contract.version, role, commandId: request.commandId, payloadHash, operationId: operation.id, inputVersionIds, reserved: reservation, status: "queued" });
}

export function retryRun(handle: ProjectHandle, capability: unknown, runId: string, commandId?: string): WorkRunRecord {
  const previous = getRun(handle, runId);
  if (!previous) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  if (!["succeeded", "failed"].includes(previous.status)) {throw new ProjectStoreError("invalid-transition", "only a terminal run can be retried");}
  const command = commandId ?? `${previous.commandId}-retry-${newId("attempt")}`;
  return queueRun(handle, capability, { contractId: previous.contractId, contractVersion: previous.contractVersion, commandId: command, role: previous.role, inputVersionIds: previous.inputVersionIds, branchId: getContract(handle, previous.contractId, previous.contractVersion)?.branchId, reservation: previous.reserved });
}

export function readAssignedInput(handle: ProjectHandle, capability: unknown, runId: string, versionId: string): import("./work-types.js").AssignedInput {
  requireAnyWorkCapability(handle, capability, ["work:read-assigned-input", "work:queue-run"]);
  const run = getRun(handle, runId);
  if (!run || !run.inputVersionIds.includes(versionId)) {throw new ProjectStoreError("forbidden", "worker requested an unassigned input version");}
  const artifact = inspectArtifactVersion(handle, versionId);
  if (artifact.storagePath === null || artifact.contentStatus !== "available") {throw new ProjectStoreError("unavailable", "assigned input content is unavailable");}
  const content = readFileSync(artifact.storagePath, "utf8");
  return { runId, versionId, logicalId: artifact.logicalId, version: artifact.version, content, contentHash: artifact.contentHash, access: artifact.access };
}

function snapshotFor(handle: ProjectHandle, run: WorkRunRecord): RoleSnapshot {
  const contract = getContract(handle, run.contractId, run.contractVersion);
  if (!contract) {throw new ProjectStoreError("not-found", "run contract not found");}
  const scope = contract.scope as { reviewQuestion?: unknown; standards?: unknown };
  return { runId: run.id, role: run.role, objective: contract.objective, inputVersionIds: run.inputVersionIds, reviewQuestion: run.role === "reviewer" && typeof scope.reviewQuestion === "string" ? scope.reviewQuestion : undefined, standards: run.role === "reviewer" && Array.isArray(scope.standards) ? scope.standards.map(String) : undefined, assignedAt: run.createdAt };
}

export async function dispatchRun(handle: ProjectHandle, capability: unknown, runId: string, sessionPort: SpecialistSessionPort): Promise<WorkRunRecord> {
  requireAnyWorkCapability(handle, capability, ["work:dispatch", "work:queue-run"]);
  const run = getRun(handle, runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  if (run.status === "cancelled" || run.status === "succeeded" || run.status === "failed") {throw new ProjectStoreError("invalid-transition", `run is ${run.status}`);}
  const contract = getContract(handle, run.contractId, run.contractVersion);
  if (!contract) {throw new ProjectStoreError("not-found", "run contract not found");}
  const operation = getLifecycleOperation(handle, run.operationId);
  if (!operation) {throw new ProjectStoreError("not-found", "run lifecycle operation not found");}
  const checkpoint = checkLifecyclePolicy(handle, operation, "dispatch", { destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator" });
  if (checkpoint.status !== "passed") {
    settleBudget(handle, run.id, {}, false);
    updateLifecycleOperationStatus(handle, run.operationId, "blocked");
    return updateRun(handle, run.id, "blocked", checkpoint.reason);
  }
  updateLifecycleOperationStatus(handle, run.operationId, "running");
  const maxRetries = Math.max(0, Math.min(2, Number((contract.scope as { maxRetries?: unknown }).maxRetries ?? 0)));
  let started: SpecialistSessionResult = { status: "failure", errorCode: "session-port-unavailable" };
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const snapshot = snapshotFor(handle, run);
    if (contract.destination !== "local") {
      const disclosure = requestDisclosure(handle, { sourceVersions: run.inputVersionIds, operation: "prompt", destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator", branchId: contract.branchId });
      if (disclosure.status !== "allow") {
        settleBudget(handle, run.id, {}, false);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", disclosure.reason);
      }
      const external = checkLifecyclePolicy(handle, operation, "external", { destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator" });
      if (external.status !== "passed") {
        settleBudget(handle, run.id, {}, false);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", external.reason);
      }
    }
    started = sessionPort.start !== undefined ? await sessionPort.start({ run, contract, snapshot }) : sessionPort.prompt !== undefined ? await sessionPort.prompt({ run, snapshot }) : { status: "ok" };
    recordProviderAttempt(handle, run.id, { destination: contract.destination, purpose: contract.purpose, attempt, outcome: started.status, pricing: { status: "unknown", reason: "provider usage is supplied by the session result" }, sessionId: started.sessionId });
    if (started.status === "ok") {break;}
  }
  const next = updateRun(handle, run.id, started.status === "ok" ? "running" : "failed", started.status === "ok" ? undefined : started.errorCode ?? started.status, started.sessionId);
  if (started.status !== "ok") {
    await settleBudget(handle, run.id, {}, true);
  } else if (started.usage !== undefined) {
    await settleBudget(handle, run.id, started.usage, false);
  } else if (contract.destination === "local") {
    await settleBudget(handle, run.id, {}, false);
  } else {
    await settleBudget(handle, run.id, {}, true);
  }
  if (started.status === "ok" && started.candidate !== undefined) {await acceptSubmission(handle, capability, started.candidate);}
  return getRun(handle, next.id)!;
}

export async function acceptSubmission(handle: ProjectHandle, capability: unknown, submission: CandidateSubmission): Promise<CandidateAcceptance> {
  requireWorkCapability(handle, capability, "work:submit-candidate");
  const run = getRun(handle, submission.runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${submission.runId}`);}
  const diagnostics = safeDiagnostics(submission.diagnostics);
  const candidateId = submission.candidateId ?? newId("candidate");
  const operation = getLifecycleOperation(handle, run.operationId);
  if (!operation) {throw new ProjectStoreError("not-found", "run lifecycle operation not found");}
  if (submission.sessionId !== undefined && run.sessionId !== undefined && submission.sessionId !== run.sessionId) {
    insertCandidate(handle, { id: candidateId, runId: run.id, artifactVersionId: submission.artifactVersionId, diagnostics, sourceVersionIds: submission.sourceVersionIds ?? run.inputVersionIds, status: "quarantined", reason: "stale session result rejected" });
    return { status: "quarantined", runId: run.id, candidateId, artifactVersionId: submission.artifactVersionId, reason: "stale session result rejected", diagnostics };
  }
  if (run.status === "cancelled" || operation.status === "cancelled" || operation.status === "fenced") {
    const late = acceptCandidate(handle, operation, { candidateId, payload: { content: submission.content, artifactVersionId: submission.artifactVersionId, diagnostics } }, { capability, expectedVersionIds: run.inputVersionIds });
    const artifactVersionId = submission.artifactVersionId;
    insertCandidate(handle, { id: candidateId, runId: run.id, artifactVersionId, diagnostics, sourceVersionIds: submission.sourceVersionIds ?? run.inputVersionIds, status: "quarantined", reason: late.reason });
    return { status: "quarantined", runId: run.id, candidateId, artifactVersionId, reason: late.reason, diagnostics };
  }
  let artifactVersionId = submission.artifactVersionId;
  if (artifactVersionId === undefined && submission.content !== undefined) {
    const logicalId = submission.logicalId ?? `candidate-${run.id}`;
    const version = submission.version ?? "1";
    artifactVersionId = registerArtifactVersion(handle, { logicalId, version, content: submission.content, origin: submission.origin ?? "specialist-candidate", access: "full-text", dependencies: (submission.sourceVersionIds ?? []).map((versionId) => ({ versionId, relation: "derived-from" })) }).id;
  }
  const contract = getContract(handle, run.contractId, run.contractVersion);
  const checkpoint = checkLifecyclePolicy(handle, operation, "acceptance", { destination: contract?.destination, purpose: contract?.purpose, allowCandidateSubmission: true });
  if (checkpoint.status !== "passed") {
    insertCandidate(handle, { id: candidateId, runId: run.id, artifactVersionId, diagnostics, sourceVersionIds: submission.sourceVersionIds ?? run.inputVersionIds, status: "quarantined", reason: checkpoint.reason });
    return { status: "quarantined", runId: run.id, candidateId, artifactVersionId, reason: checkpoint.reason, diagnostics };
  }
  insertCandidate(handle, { id: candidateId, runId: run.id, artifactVersionId, diagnostics, sourceVersionIds: submission.sourceVersionIds ?? run.inputVersionIds, status: "accepted", reason: "candidate output accepted into the work record" });
  updateRun(handle, run.id, "succeeded");
  updateLifecycleOperationStatus(handle, run.operationId, "completed");
  return { status: "accepted", runId: run.id, candidateId, artifactVersionId, reason: "candidate output accepted into the work record", diagnostics };
}

export function inspectWork(handle: ProjectHandle, commandOrRunId: string): WorkInspection {
  assertWorkSchema(handle);
  const run = getRun(handle, commandOrRunId) ?? getRunByCommand(handle, commandOrRunId);
  const contract = run ? getContract(handle, run.contractId, run.contractVersion) ?? undefined : getContract(handle, commandOrRunId) ?? undefined;
  const budget = contract ? inspectBudget(handle, contract.id, contract.version) : undefined;
  const disagreements = contract ? (handle.db.prepare("SELECT * FROM work_disagreements WHERE contract_id = ? ORDER BY created_at").all(contract.id) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), contractId: String(row.contract_id), question: String(row.question), leftRole: String(row.left_role) as SpecialistRole, rightRole: String(row.right_role) as SpecialistRole, leftCandidateVersionId: String(row.left_candidate_version_id), rightCandidateVersionId: String(row.right_candidate_version_id), leftSourceBasis: JSON.parse(String(row.left_source_basis)), rightSourceBasis: JSON.parse(String(row.right_source_basis)), revisionCount: Number(row.revision_count), status: String(row.status) as DisagreementRecord["status"], createdAt: String(row.created_at) })) : [];
  return { contract: contract ?? undefined, run: run ?? undefined, budget, candidates: candidateRows(handle, run?.id), disagreements };
}

export function cancelRun(handle: ProjectHandle, capability: unknown, request: { readonly runId: string; readonly reason?: string; readonly sessionPort?: SpecialistSessionPort }): WorkRunRecord {
  const owner = requireOwner(handle, capability); const run = getRun(handle, request.runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${request.runId}`);}
  if (run.status === "cancelled") {return run;}
  fenceRevokedOperation(handle, run.operationId, request.reason ?? "owner cancelled run", owner.ownerId);
  updateLifecycleOperationStatus(handle, run.operationId, "cancelled");
  const updated = updateRun(handle, run.id, "cancelled", request.reason ?? "owner cancelled run");
  if (request.sessionPort && run.sessionId && request.sessionPort.cancel) {
    try {
      const remote = request.sessionPort.cancel(run.sessionId);
      if (remote && typeof (remote as Promise<void>).then === "function") {void (remote as Promise<void>).catch(() => updateRun(handle, run.id, "cancelled", `${request.reason ?? "owner cancelled run"}; remote stop failed`));}
    } catch {
      updateRun(handle, run.id, "cancelled", `${request.reason ?? "owner cancelled run"}; remote stop failed`);
    }
  }
  return updated;
}

export function cancelContract(handle: ProjectHandle, capability: unknown, request: { readonly contractId: string; readonly version?: number; readonly reason?: string; readonly sessionPort?: SpecialistSessionPort }): readonly WorkRunRecord[] {
  const owner = requireOwner(handle, capability); const contract = getContract(handle, request.contractId, request.version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${request.contractId}`);}
  const runs = listRuns(handle, contract.id).filter((run) => !["succeeded", "failed", "cancelled"].includes(run.status));
  for (const run of runs) {cancelRun(handle, owner, { runId: run.id, reason: request.reason ?? "owner cancelled contract", sessionPort: request.sessionPort });}
  transaction(handle.db, () => handle.db.prepare("UPDATE work_contracts SET status = 'cancelled', updated_at = ? WHERE id = ? AND version = ?").run(isoNow(), contract.id, contract.version));
  return listRuns(handle, contract.id);
}

export function pauseRun(handle: ProjectHandle, capability: unknown, request: { readonly runId: string; readonly reason?: string }): WorkRunRecord {
  requireOwner(handle, capability); const run = getRun(handle, request.runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${request.runId}`);}
  updateLifecycleOperationStatus(handle, run.operationId, "blocked");
  return updateRun(handle, run.id, "waiting-for-human", request.reason ?? "owner paused run");
}

export function inspectQuarantine(handle: ProjectHandle, runId: string) { const run = getRun(handle, runId); if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);} return listQuarantinedOutputs(handle, run.operationId); }

export function reviseContract(handle: ProjectHandle, capability: unknown, request: { readonly contractId: string; readonly version?: number; readonly limits?: WorkContractInput["limits"]; readonly objective?: string; readonly scope?: Record<string, unknown> }): WorkContractRecord {
  requireOwner(handle, capability); const old = getContract(handle, request.contractId, request.version);
  if (!old) {throw new ProjectStoreError("not-found", `work contract not found: ${request.contractId}`);}
  return replaceContractVersion(handle, old, { objective: request.objective ?? old.objective, scope: request.scope ?? old.scope, inputVersionIds: old.inputVersionIds, permittedRoles: old.permittedRoles, limits: request.limits ?? old.limits, destination: old.destination, purpose: old.purpose, executionMode: old.executionMode, branchId: old.branchId });
}

export function recordProviderAttempt(handle: ProjectHandle, runId: string, attempt: Omit<import("./work-types.js").ProviderAttempt, "id" | "createdAt" | "runId">): void {
  assertWritable(handle); assertWorkSchema(handle);
  transaction(handle.db, () => handle.db.prepare("INSERT INTO provider_attempts (id, run_id, destination, purpose, attempt, outcome, pricing, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(newId("attempt"), runId, attempt.destination, attempt.purpose, attempt.attempt, attempt.outcome, JSON.stringify(attempt.pricing), attempt.sessionId ?? null, isoNow()));
}

export function listProviderAttempts(handle: ProjectHandle, runId: string) {
  assertWorkSchema(handle);
  return (handle.db.prepare("SELECT * FROM provider_attempts WHERE run_id = ? ORDER BY attempt").all(runId) as Array<Record<string, unknown>>).map((row) => ({ id: String(row.id), runId: String(row.run_id), destination: String(row.destination), purpose: String(row.purpose), attempt: Number(row.attempt), outcome: String(row.outcome) as "ok" | "timeout" | "failure" | "denied", pricing: JSON.parse(String(row.pricing)), sessionId: typeof row.session_id === "string" ? row.session_id : undefined, createdAt: String(row.created_at) }));
}