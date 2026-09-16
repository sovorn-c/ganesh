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
import type { BudgetDimension, CandidateAcceptance, CandidateSubmission, DisagreementRecord, DispatchOptions, SpecialistRole, SpecialistSessionPort, SpecialistSessionResult, StandingPermissionInput, StandingPermissionRecord, WorkContractInput, WorkContractRecord, WorkDiagnostic, WorkInspection, WorkRunInput, WorkRunRecord, RoleSnapshot } from "./work-types.js";
import { recordDiagnostic, operationsSchemaAvailable } from "../operations/diagnostic-store.js";
import { redactDiagnostic } from "../runtime/preflight.js";
import { admitProviderAttempt, releaseProviderAttemptReservation } from "./provider-admission.js";
import { assessActivityAuthorization } from "../ethics/authorization-assessment.js";
import { assessProtocolCurrency } from "../progress/change-store.js";
import { assertProgressSchema } from "../progress/progress-utils.js";
import { RESEARCH_ACTIVITIES, type ActivityAuthorizationContext, type ResearchActivity } from "../ethics/ethics-types.js";

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
  return (diagnostics ?? []).slice(0, 32).map((rawItem) => {
    const item = rawItem && typeof rawItem === "object" ? rawItem as Partial<WorkDiagnostic> : {};
    const count = Number(item.count);
    return {
      code: redactDiagnostic(String(item.code ?? "diagnostic")).slice(0, 160),
      severity: item.severity === "warning" || item.severity === "error" ? item.severity : "info",
      count: Number.isSafeInteger(count) ? Math.max(1, Math.min(1000000, count)) : 1
    };
  });
}

interface ActiveDispatch {
  readonly controller: AbortController;
  readonly sessionPort: SpecialistSessionPort;
  sessionId?: string;
}

const activeDispatches = new WeakMap<ProjectHandle, Map<string, ActiveDispatch>>();

function activeDispatchMap(handle: ProjectHandle): Map<string, ActiveDispatch> {
  let map = activeDispatches.get(handle);
  if (!map) {
    map = new Map();
    activeDispatches.set(handle, map);
  }
  return map;
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

function contractScopeValue(scope: Record<string, unknown>, ...keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(scope, key)) {
      return scope[key];
    }
  }
  return undefined;
}

function sameScopeValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function standingScopeMatchesContract(standingScope: unknown, contractScope: unknown): boolean {
  if (standingScope === null || typeof standingScope !== "object" || Array.isArray(standingScope) || contractScope === null || typeof contractScope !== "object" || Array.isArray(contractScope)) {
    return false;
  }
  const standing = standingScope as Record<string, unknown>;
  const contract = contractScope as Record<string, unknown>;
  for (const [key, value] of Object.entries(standing)) {
    const keys = key === "dataUse" || key === "data-use" ? ["dataUse", "data-use"] : [key];
    const contractValue = contractScopeValue(contract, ...keys);
    if (contractValue === undefined || !sameScopeValue(value, contractValue)) {
      return false;
    }
  }
  return true;
}

function contractActivity(contract: WorkContractRecord): ResearchActivity | undefined {
  const activity = contractScopeValue(contract.scope, "activity");
  if (activity === undefined) {
    return undefined;
  }
  if (typeof activity !== "string" || !RESEARCH_ACTIVITIES.includes(activity as ResearchActivity)) {
    throw new ProjectStoreError("forbidden", "authorized contract activity scope is invalid");
  }
  return activity as ResearchActivity;
}

function assertRunContextMatchesContract(contract: WorkContractRecord, request: WorkRunInput): ResearchActivity | undefined {
  const activity = contractActivity(contract);
  if (request.activity !== undefined && activity !== request.activity) {
    throw new ProjectStoreError("forbidden", "run activity must match the authorized contract scope");
  }
  if (activity === undefined && request.activity !== undefined) {
    throw new ProjectStoreError("forbidden", "named activity must be bound to the authorized contract scope");
  }
  const fields = [
    ["population", request.population, contractScopeValue(contract.scope, "population")],
    ["dataClasses", request.dataClasses, contractScopeValue(contract.scope, "dataClasses")],
    ["dataUse", request.dataUse, contractScopeValue(contract.scope, "dataUse", "data-use")],
    ["conditions", request.conditions, contractScopeValue(contract.scope, "conditions")]
  ] as const;
  for (const [label, requested, authorized] of fields) {
    if (requested !== undefined && (authorized === undefined || !sameScopeValue(requested, authorized))) {
      throw new ProjectStoreError("forbidden", `run ${label} must match the authorized contract scope`);
    }
  }
  return activity;
}

function authorizationContext(contract: WorkContractRecord): Omit<ActivityAuthorizationContext, "activity"> {
  const scope = contract.scope;
  const scopedDataClasses = contractScopeValue(scope, "dataClasses");
  if (scopedDataClasses !== undefined && (!Array.isArray(scopedDataClasses) || scopedDataClasses.length === 0 || !scopedDataClasses.every((item) => typeof item === "string" && item.trim() !== ""))) {
    throw new ProjectStoreError("forbidden", "authorized contract dataClasses scope is invalid");
  }
  const population = contractScopeValue(scope, "population");
  const dataUse = contractScopeValue(scope, "dataUse", "data-use");
  if (population !== undefined && (typeof population !== "string" || population.trim() === "")) {
    throw new ProjectStoreError("forbidden", "authorized contract population scope is invalid");
  }
  if (dataUse !== undefined && (typeof dataUse !== "string" || dataUse.trim() === "")) {
    throw new ProjectStoreError("forbidden", "authorized contract data-use scope is invalid");
  }
  return {
    population: population as string | undefined,
    dataClasses: scopedDataClasses as string[] | undefined,
    dataUse: dataUse as string | undefined,
    destination: contract.destination,
    purpose: contract.purpose,
    conditions: contractScopeValue(scope, "conditions")
  };
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
    const rolesMatch = contract.permittedRoles.every((role) => role === standing.role);
    const scopeMatches = standingScopeMatchesContract(standing.scope, contract.scope);
    if (!rolesMatch || (standing.destination !== contract.destination) || (standing.purpose !== contract.purpose) || !objectiveMatches || !inputsMatch || !limitsMatch || !scopeMatches) {throw new ProjectStoreError("forbidden", "standing permission does not match the contract");}
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
  const activity = assertRunContextMatchesContract(contract, request);
  const role = request.role ?? contract.permittedRoles[0];
  if (!contract.permittedRoles.includes(role)) {throw new ProjectStoreError("forbidden", `role ${role} is not permitted by this contract`);}
  const authorization = authorizationContext(contract);
  if (request.protocolVersionId !== undefined && contract.protocolVersionId !== undefined && request.protocolVersionId !== contract.protocolVersionId) {
    throw new ProjectStoreError("forbidden", "run protocolVersionId must match the authorized contract scope");
  }
  const protocolVersionId = request.protocolVersionId ?? contract.protocolVersionId;
  let operationBranchId = request.branchId ?? contract.branchId;
  if (protocolVersionId !== undefined) {
    assertProgressSchema(handle);
    const protocolRow = handle.db.prepare("SELECT branch_id FROM protocol_versions WHERE id = ?").get(protocolVersionId) as { branch_id?: unknown } | undefined;
    if (!protocolRow || typeof protocolRow.branch_id !== "string") { throw new ProjectStoreError("not-found", `protocol version ${protocolVersionId} was not found`); }
    if (operationBranchId !== undefined && operationBranchId !== protocolRow.branch_id) {
      throw new ProjectStoreError("forbidden", "work branch must match the protocol version branch");
    }
    operationBranchId ??= protocolRow.branch_id;
    const currency = assessProtocolCurrency(handle, capability, {
      protocolVersionId,
      branchId: operationBranchId,
      population: authorization.population,
      dataUse: authorization.dataUse,
      activity
    });
    if (currency.status === "superseded") {
      throw new ProjectStoreError("forbidden", `work run blocked: ${currency.reason}`);
    }
    if (currency.materialChange && !currency.contextMatches) {
      throw new ProjectStoreError("forbidden", `work run blocked: ${currency.reason}`);
    }
  }
  if (activity !== undefined) {
    const assessment = assessActivityAuthorization(handle, { activity, ...authorization });
    if (!assessment.permitted) {
      throw new ProjectStoreError("forbidden", `work run blocked by external authorization: ${assessment.reason}`);
    }
  }
  const inputVersionIds = normalizeInputIds(contract, request.inputVersionIds ?? request.expectedVersionIds);
  const payload = { contractId: contract.id, version: contract.version, role, inputVersionIds, ...authorization, reservation: request.reservation ?? null, activity, protocolVersionId: protocolVersionId ?? null };
  const payloadHash = hashPayload(payload);
  const duplicate = getRunByCommand(handle, request.commandId);
  if (duplicate) {
    if (duplicate.payloadHash !== payloadHash) {throw new ProjectStoreError("command-conflict", "command conflict: command ID was reused with a different work request");}
    return duplicate;
  }
  const operation = createLifecycleOperation(handle, { id: newId("work-op"), operationType: "specialist-work", branchId: operationBranchId ?? null, inputSnapshot: { versionIds: inputVersionIds, contractId: contract.id, contractVersion: contract.version, activity, protocolVersionId, ...authorization }, status: "queued" });
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

function parseProtocolVersionId(snapshot: string): string | "invalid" | undefined {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>).protocolVersionId;
      if (value === undefined) { return undefined; }
      return typeof value === "string" && value.trim() !== "" ? value : "invalid";
    }
  } catch {
    // Older lifecycle snapshots do not carry protocol identity.
  }
  return undefined;
}

export function retryRun(handle: ProjectHandle, capability: unknown, runId: string, commandId?: string): WorkRunRecord {
  const previous = getRun(handle, runId);
  if (!previous) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  if (!["succeeded", "failed"].includes(previous.status)) {throw new ProjectStoreError("invalid-transition", "only a terminal run can be retried");}

  const operation = getLifecycleOperation(handle, previous.operationId);
  if (!operation) {throw new ProjectStoreError("invalid-transition", "terminal run has no lifecycle operation to retry");}
  let activity: ResearchActivity | undefined;
  let retryContext: Partial<Omit<ActivityAuthorizationContext, "activity">> = {};
  try {
    const parsed: unknown = JSON.parse(operation.inputSnapshot);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new ProjectStoreError("forbidden", "run activity snapshot is invalid; retry blocked");
    }
    const snapshot = parsed as Record<string, unknown>;
    const rawActivity = snapshot.activity;
    if (rawActivity !== undefined) {
      if (typeof rawActivity !== "string" || !RESEARCH_ACTIVITIES.includes(rawActivity as ResearchActivity)) {
        throw new ProjectStoreError("forbidden", "run activity snapshot is invalid; retry blocked");
      }
      activity = rawActivity as ResearchActivity;
    }
    if (snapshot.population !== undefined && typeof snapshot.population !== "string") {
      throw new ProjectStoreError("forbidden", "run authorization snapshot is invalid; retry blocked");
    }
    if (snapshot.dataClasses !== undefined && (!Array.isArray(snapshot.dataClasses) || !snapshot.dataClasses.every((item) => typeof item === "string"))) {
      throw new ProjectStoreError("forbidden", "run authorization snapshot is invalid; retry blocked");
    }
    if (snapshot.dataUse !== undefined && typeof snapshot.dataUse !== "string") {
      throw new ProjectStoreError("forbidden", "run authorization snapshot is invalid; retry blocked");
    }
    if (snapshot.destination !== undefined && typeof snapshot.destination !== "string") {
      throw new ProjectStoreError("forbidden", "run authorization snapshot is invalid; retry blocked");
    }
    if (snapshot.purpose !== undefined && typeof snapshot.purpose !== "string") {
      throw new ProjectStoreError("forbidden", "run authorization snapshot is invalid; retry blocked");
    }
    retryContext = {
      population: snapshot.population as string | undefined,
      dataClasses: snapshot.dataClasses as string[] | undefined,
      dataUse: snapshot.dataUse as string | undefined,
      destination: snapshot.destination as string | undefined,
      purpose: snapshot.purpose as string | undefined,
      conditions: snapshot.conditions
    };
  } catch (error: unknown) {
    if (error instanceof ProjectStoreError) {throw error;}
    throw new ProjectStoreError("forbidden", "run activity snapshot is unreadable; retry blocked");
  }

  const protocolVersionId = parseProtocolVersionId(operation.inputSnapshot);
  if (protocolVersionId === "invalid") { throw new ProjectStoreError("forbidden", "run protocol identity is malformed; retry blocked"); }
  const command = commandId ?? `${previous.commandId}-retry-${newId("attempt")}`;
  return queueRun(handle, capability, {
    contractId: previous.contractId,
    contractVersion: previous.contractVersion,
    commandId: command,
    role: previous.role,
    inputVersionIds: previous.inputVersionIds,
    branchId: getContract(handle, previous.contractId, previous.contractVersion)?.branchId,
    reservation: previous.reserved,
    activity,
    protocolVersionId,
    ...retryContext
  });
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

interface ProviderInvocation {
  readonly result: SpecialistSessionResult;
  readonly started: boolean;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly errorMessage?: string;
}

function normalizeSessionResult(value: unknown): SpecialistSessionResult {
  if (!value || typeof value !== "object") {
    return { status: "failure", errorCode: "invalid-session-result" };
  }
  const result = value as Partial<SpecialistSessionResult>;
  return result.status === "ok" || result.status === "timeout" || result.status === "failure"
    ? result as SpecialistSessionResult
    : { status: "failure", errorCode: "invalid-session-result" };
}

function quarantineLateCandidate(handle: ProjectHandle, capability: unknown, run: WorkRunRecord, result: SpecialistSessionResult): void {
  if (result.status !== "ok" || result.candidate === undefined) { return; }
  void acceptSubmission(handle, capability, {
    ...result.candidate,
    runId: run.id,
    sessionId: result.sessionId ?? result.candidate.sessionId
  }).catch(() => {
    // The project may close before an ignored provider promise resolves.
  });
}

async function invokeProviderAttempt(
  handle: ProjectHandle,
  capability: unknown,
  run: WorkRunRecord,
  contract: WorkContractRecord,
  snapshot: RoleSnapshot,
  sessionPort: SpecialistSessionPort,
  active: ActiveDispatch,
  deadlineAt: number | undefined
): Promise<ProviderInvocation> {
  const remainingMs = deadlineAt === undefined ? undefined : Math.max(0, deadlineAt - Date.now());
  if (remainingMs !== undefined && remainingMs <= 0) {
    return { result: { status: "timeout", errorCode: "provider-timeout" }, started: false, timedOut: true, aborted: false };
  }
  const attemptController = new AbortController();
  const abortAttempt = (): void => attemptController.abort(active.controller.signal.reason);
  active.controller.signal.addEventListener("abort", abortAttempt, { once: true });
  const call = Promise.resolve().then(() => sessionPort.start !== undefined
    ? sessionPort.start({ run, contract, snapshot, signal: attemptController.signal, deadlineAt })
    : sessionPort.prompt !== undefined
      ? sessionPort.prompt({ run, snapshot, signal: attemptController.signal, deadlineAt })
      : { status: "ok" as const });
  type Outcome =
    | { readonly kind: "result"; readonly value: SpecialistSessionResult }
    | { readonly kind: "error"; readonly error: unknown }
    | { readonly kind: "timeout" }
    | { readonly kind: "abort" };
  let settled = false;
  let timer: NodeJS.Timeout | undefined;
  const outcome = await new Promise<Outcome>((resolve) => {
    const settle = (value: Outcome): void => {
      if (settled) { return; }
      settled = true;
      resolve(value);
    };
    call.then(
      (value) => {
        const result = normalizeSessionResult(value);
        if (settled) {
          quarantineLateCandidate(handle, capability, run, result);
          return;
        }
        settle({ kind: "result", value: result });
      },
      (error: unknown) => settle({ kind: "error", error })
    );
    const onAbort = (): void => {
      // Give an already-resolved provider result precedence over a cancellation
      // observed in the same turn; pending calls still stop on the next turn.
      setImmediate(() => settle({ kind: "abort" }));
    };
    attemptController.signal.addEventListener("abort", onAbort, { once: true });
    if (attemptController.signal.aborted) { onAbort(); }
    if (remainingMs !== undefined) {
      timer = setTimeout(() => {
        if (!settled) {
          settle({ kind: "timeout" });
          attemptController.abort(new Error("provider deadline exceeded"));
        }
      }, Math.min(remainingMs, 2_147_483_647));
    }
  });
  if (timer) { clearTimeout(timer); }
  active.controller.signal.removeEventListener("abort", abortAttempt);
  if (outcome.kind === "result") {
    return { result: outcome.value, started: true, timedOut: false, aborted: false };
  }
  if (outcome.kind === "abort") {
    return { result: { status: "timeout", errorCode: "cancelled" }, started: true, timedOut: false, aborted: true };
  }
  if (outcome.kind === "timeout") {
    return { result: { status: "timeout", errorCode: "provider-timeout" }, started: true, timedOut: true, aborted: false };
  }
  const rawCode = (outcome.error as { code?: string })?.code ?? "session-start-error";
  return {
    result: { status: "failure", errorCode: redactDiagnostic(String(rawCode)).slice(0, 160) },
    started: true,
    timedOut: false,
    aborted: false,
    errorMessage: redactDiagnostic(outcome.error instanceof Error ? outcome.error.message : String(outcome.error)).slice(0, 160)
  };
}

function finalizeDispatchCancellation(handle: ProjectHandle, run: WorkRunRecord, reason: string): WorkRunRecord {
  const current = getRun(handle, run.id);
  if (!current || ["cancelled", "succeeded", "failed"].includes(current.status)) { return current ?? run; }
  const operation = getLifecycleOperation(handle, current.operationId);
  if (operation && operation.status !== "cancelled" && operation.status !== "fenced") {
    fenceRevokedOperation(handle, operation, reason, "dispatch-signal");
  }
  if (getLifecycleOperation(handle, current.operationId)?.status !== "cancelled") {
    updateLifecycleOperationStatus(handle, current.operationId, "cancelled");
  }
  return updateRun(handle, current.id, "cancelled", reason);
}

async function dispatchRunLoop(handle: ProjectHandle, capability: unknown, run: WorkRunRecord, contract: WorkContractRecord, operation: import("../lifecycle/lifecycle-types.js").LifecycleOperation, sessionPort: SpecialistSessionPort, options: DispatchOptions | undefined, active: ActiveDispatch): Promise<WorkRunRecord> {
  const dispatchOptions = { ...options, signal: active.controller.signal };
  const correlationId = options?.correlationId ?? newId("corr");
  const unavailableInput = run.inputVersionIds.find((versionId) => {
    try {
      return inspectArtifactVersion(handle, versionId).contentStatus !== "available";
    } catch {
      return true;
    }
  });
  if (unavailableInput !== undefined) {
    settleBudget(handle, run.id, {}, false);
    updateLifecycleOperationStatus(handle, run.operationId, "blocked");
    return updateRun(handle, run.id, "blocked", `input ${unavailableInput} is unavailable; dispatch requires revalidation`);
  }
  const checkpoint = checkLifecyclePolicy(handle, operation, "dispatch", { capability, destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator" });
  if (checkpoint.status !== "passed") {
    if (operationsSchemaAvailable(handle)) {
      try {
        recordDiagnostic(handle, { correlationId, runId: run.id, commandId: run.commandId, kind: "policy-denial", code: "dispatch-policy-denied", severity: "error", message: checkpoint.reason });
      } catch { /* ignore */ }
    }
    settleBudget(handle, run.id, {}, false);
    updateLifecycleOperationStatus(handle, run.operationId, "blocked");
    return updateRun(handle, run.id, "blocked", checkpoint.reason);
  }
  const initialRun = getRun(handle, run.id);
  const initialOp = getLifecycleOperation(handle, run.operationId);
  if (!initialRun || initialRun.status === "cancelled" || initialRun.status === "waiting-for-human" || initialOp?.status === "cancelled" || initialOp?.status === "fenced") {
    await settleBudget(handle, run.id, {}, true);
    return initialRun ?? run;
  }
  updateLifecycleOperationStatus(handle, run.operationId, "running");
  const maxRetries = Math.max(0, Math.min(2, Number((contract.scope as { maxRetries?: unknown }).maxRetries ?? 0)));
  let started: SpecialistSessionResult = { status: "failure", errorCode: "session-port-unavailable" };
  let providerCalls = 0;
  let providerTimeMs = 0;
  const providerUsage: Partial<Record<BudgetDimension, number>> = {};
  for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
    const consumedForAdmission: Partial<Record<BudgetDimension, number>> = {
      ...providerUsage,
      calls: Math.max(providerCalls, providerUsage.calls ?? 0)
    };
    const admission = await admitProviderAttempt(handle, run, contract, attempt, dispatchOptions, Math.max(providerTimeMs, providerUsage.timeMs ?? 0), consumedForAdmission);
    if (!admission.admitted) {
      if (admission.reason === "cancelled" || admission.reason === "fenced" || admission.reason === "terminal") {
        await settleBudget(handle, run.id, {}, true);
        return active.controller.signal.aborted ? finalizeDispatchCancellation(handle, run, "dispatch cancelled") : getRun(handle, run.id) ?? run;
      }
      if (admission.reason === "time-exhausted" || admission.reason === "calls-exhausted" || admission.reason === "budget-exhausted") {
        await settleBudget(handle, run.id, {}, true);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "failed", admission.reason);
      }
    }
    const reservationId = admission.reservationId;
    const snapshot = snapshotFor(handle, run);
    if (contract.destination !== "local") {
      const disclosure = requestDisclosure(handle, { sourceVersions: run.inputVersionIds, operation: "prompt", destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator", branchId: operation.branchId ?? contract.branchId });
      if (disclosure.status !== "allow") {
        if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
        if (operationsSchemaAvailable(handle)) {
          try {
            recordDiagnostic(handle, { correlationId, runId: run.id, commandId: run.commandId, kind: "policy-denial", code: "disclosure-denied", severity: "error", message: disclosure.reason });
          } catch { /* ignore */ }
        }
        settleBudget(handle, run.id, {}, false);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", disclosure.reason);
      }
      const external = checkLifecyclePolicy(handle, operation, "external", { capability, destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator" });
      if (external.status !== "passed") {
        if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
        settleBudget(handle, run.id, {}, false);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", external.reason);
      }
    }
    const freshRunBefore = getRun(handle, run.id);
    const freshOpBefore = getLifecycleOperation(handle, run.operationId);
    if (!freshRunBefore || freshRunBefore.status === "succeeded" || freshRunBefore.status === "failed") {
      if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
      await settleBudget(handle, run.id, {}, true);
      return freshRunBefore ?? run;
    }
    if (freshRunBefore.status === "cancelled" || freshRunBefore.status === "waiting-for-human" || freshOpBefore?.status === "cancelled" || freshOpBefore?.status === "fenced" || freshOpBefore?.status === "blocked" || active.controller.signal.aborted) {
      if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
      await settleBudget(handle, run.id, {}, true);
      return active.controller.signal.aborted ? finalizeDispatchCancellation(handle, run, "dispatch cancelled") : freshRunBefore ?? run;
    }
    if (parseProtocolVersionId(operation.inputSnapshot) !== undefined) {
      let finalCheckpoint: ReturnType<typeof checkLifecyclePolicy>;
      try {
        finalCheckpoint = checkLifecyclePolicy(handle, operation, contract.destination === "local" ? "dispatch" : "external", {
          capability, destination: contract.destination, purpose: contract.purpose, actor: "work-coordinator"
        });
      } catch (error) {
        if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
        await settleBudget(handle, run.id, {}, true);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", error instanceof Error ? error.message : "final dispatch authorization check failed");
      }
      if (finalCheckpoint.status !== "passed") {
        if (reservationId) { releaseProviderAttemptReservation(handle, reservationId); }
        await settleBudget(handle, run.id, {}, true);
        updateLifecycleOperationStatus(handle, run.operationId, "blocked");
        return updateRun(handle, run.id, "blocked", finalCheckpoint.reason);
      }
    }
    const invocationStartedAt = Date.now();
    const invocation = await invokeProviderAttempt(handle, capability, run, contract, snapshot, sessionPort, active, admission.deadlineAt);
    if (invocation.started) {
      providerCalls += 1;
      providerTimeMs += Math.max(0, Date.now() - invocationStartedAt);
      if (invocation.result.usage) {
        for (const dimension of ["tokens", "calls", "timeMs", "spend"] as const) {
          const value = Number(invocation.result.usage[dimension]);
          if (Number.isFinite(value) && value >= 0) {
            providerUsage[dimension] = (providerUsage[dimension] ?? 0) + value;
          }
        }
      }
    } else if (reservationId) {
      releaseProviderAttemptReservation(handle, reservationId);
    }
    started = invocation.result;
    if (started.sessionId) { active.sessionId = started.sessionId; }
    if (invocation.started && reservationId) {
      recordProviderAttempt(handle, run.id, { destination: contract.destination, purpose: contract.purpose, attempt, outcome: started.status, pricing: { status: "unknown", reason: "provider usage is supplied by the session result" }, sessionId: started.sessionId }, reservationId);
    }
    if (invocation.errorMessage && operationsSchemaAvailable(handle)) {
      try {
        const code = redactDiagnostic(String(started.errorCode ?? "session-start-error")).slice(0, 160);
        recordDiagnostic(handle, { correlationId, runId: run.id, commandId: run.commandId, kind: "provider-failure", code, severity: "error", message: invocation.errorMessage });
      } catch { /* ignore */ }
    }
    if (started.status !== "ok" && operationsSchemaAvailable(handle)) {
      try {
        const rawCode = String(started.errorCode ?? started.status);
        const code = redactDiagnostic(rawCode).slice(0, 160);
        const message = redactDiagnostic(String(started.errorCode ?? started.status ?? "provider attempt failed")).slice(0, 160);
        recordDiagnostic(handle, { correlationId, runId: run.id, commandId: run.commandId, kind: "provider-failure", code, severity: "error", message });
      } catch { /* ignore */ }
    }
    if (invocation.aborted || active.controller.signal.aborted) {
      await settleBudget(handle, run.id, {}, true);
      return finalizeDispatchCancellation(handle, run, "dispatch cancelled");
    }
    if (invocation.timedOut) {
      await settleBudget(handle, run.id, {}, true);
      updateLifecycleOperationStatus(handle, run.operationId, "blocked");
      return updateRun(handle, run.id, "failed", "time-exhausted");
    }
    const freshRunAfter = getRun(handle, run.id);
    const freshOpAfter = getLifecycleOperation(handle, run.operationId);
    if (!freshRunAfter || freshRunAfter.status === "cancelled" || freshRunAfter.status === "waiting-for-human" || freshRunAfter.status === "succeeded" || freshRunAfter.status === "failed" || freshOpAfter?.status === "cancelled" || freshOpAfter?.status === "fenced") {
      if (started.status === "ok" && started.candidate !== undefined && freshRunAfter) {
        await acceptSubmission(handle, capability, { ...started.candidate, runId: run.id, sessionId: started.sessionId ?? started.candidate.sessionId });
      }
      await settleBudget(handle, run.id, {}, true);
      return freshRunAfter ?? run;
    }
    if (started.status === "ok") {break;}
  }
  const finalCheckRun = getRun(handle, run.id);
  const finalCheckOp = getLifecycleOperation(handle, run.operationId);
  if (!finalCheckRun || finalCheckRun.status === "cancelled" || finalCheckRun.status === "waiting-for-human" || finalCheckRun.status === "succeeded" || finalCheckRun.status === "failed" || finalCheckOp?.status === "cancelled" || finalCheckOp?.status === "fenced") {
    await settleBudget(handle, run.id, {}, true);
    return finalCheckRun ?? run;
  }
  const actuals: Partial<Record<BudgetDimension, number>> = { ...providerUsage, calls: Math.max(providerCalls, providerUsage.calls ?? 0) };
  if (contract.limits.timeMs !== undefined) {
    actuals.timeMs = Math.max(actuals.timeMs ?? 0, providerTimeMs);
  }
  if (started.status !== "ok") {
    settleBudget(handle, run.id, {}, true);
    updateLifecycleOperationStatus(handle, run.operationId, "blocked");
    return updateRun(handle, run.id, "failed", started.errorCode ?? started.status, started.sessionId);
  }

  try {
    settleBudget(handle, run.id, actuals, false);
  } catch (error) {
    settleBudget(handle, run.id, {}, true);
    if (operationsSchemaAvailable(handle)) {
      try {
        recordDiagnostic(handle, {
          correlationId,
          runId: run.id,
          commandId: run.commandId,
          kind: "budget-exhaustion",
          code: "provider-usage-exceeds-reservation",
          severity: "error",
          message: redactDiagnostic(error instanceof Error ? error.message : String(error))
        });
      } catch { /* ignore */ }
    }
    updateLifecycleOperationStatus(handle, run.operationId, "blocked");
    return updateRun(handle, run.id, "failed", "provider-usage-exceeds-reservation", started.sessionId);
  }

  const next = updateRun(handle, run.id, "running", undefined, started.sessionId);
  if (started.candidate !== undefined) {
    await acceptSubmission(handle, capability, { ...started.candidate, runId: run.id, sessionId: started.sessionId ?? started.candidate.sessionId });
  }
  return getRun(handle, next.id)!;
}

export async function dispatchRun(handle: ProjectHandle, capability: unknown, runId: string, sessionPort: SpecialistSessionPort, options?: DispatchOptions): Promise<WorkRunRecord> {
  requireAnyWorkCapability(handle, capability, ["work:dispatch", "work:queue-run"]);
  const run = getRun(handle, runId);
  if (!run) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  if (["cancelled", "succeeded", "failed"].includes(run.status)) {throw new ProjectStoreError("invalid-transition", `run is ${run.status}`);}
  const contract = getContract(handle, run.contractId, run.contractVersion);
  if (!contract) {throw new ProjectStoreError("not-found", "work contract not found");}
  const operation = getLifecycleOperation(handle, run.operationId);
  if (!operation) {throw new ProjectStoreError("not-found", "run lifecycle operation not found");}
  const map = activeDispatchMap(handle);
  if (map.has(run.id)) {throw new ProjectStoreError("invalid-transition", "run is already being dispatched");}
  transaction(handle.db, () => {
    const current = getRun(handle, run.id);
    if (current?.status === "running") {
      throw new ProjectStoreError("invalid-transition", "run is already being dispatched");
    }
    if (current?.status === "queued" || current?.status === "blocked") {
      handle.db.prepare("UPDATE work_runs SET status = 'running', updated_at = ? WHERE id = ? AND status IN ('queued', 'blocked')").run(isoNow(), run.id);
    }
  });
  const active: ActiveDispatch = { controller: new AbortController(), sessionPort };
  const abortListener = (): void => active.controller.abort(options?.signal?.reason);
  options?.signal?.addEventListener("abort", abortListener, { once: true });
  if (options?.signal?.aborted) { active.controller.abort(options.signal.reason); }
  map.set(run.id, active);
  try {
    return await dispatchRunLoop(handle, capability, run, contract, operation, sessionPort, options, active);
  } finally {
    options?.signal?.removeEventListener("abort", abortListener);
    map.delete(run.id);
  }
}

function quarantineTerminalSubmission(handle: ProjectHandle, run: WorkRunRecord, operation: import("../lifecycle/lifecycle-types.js").LifecycleOperation, submission: CandidateSubmission, diagnostics: readonly WorkDiagnostic[], candidateId: string, reason: string): CandidateAcceptance {
  const artifactVersionId = submission.artifactVersionId;
  const sourceVersionIds = submission.sourceVersionIds ?? run.inputVersionIds;
  const details = JSON.stringify({ content: submission.content, artifactVersionId, diagnostics });
  transaction(handle.db, () => {
    handle.db.prepare("INSERT INTO quarantined_outputs (id, operation_id, candidate_id, reason, disposition, details, created_at) VALUES (?, ?, ?, ?, 'quarantined', ?, ?)").run(newId("quar"), operation.id, candidateId, reason, details, isoNow());
  });
  insertCandidate(handle, { id: candidateId, runId: run.id, artifactVersionId, diagnostics, sourceVersionIds, status: "quarantined", reason });
  return { status: "quarantined", runId: run.id, candidateId, artifactVersionId, reason, diagnostics };
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
  if (["failed", "succeeded"].includes(run.status) || ["blocked", "completed", "accepted", "rejected"].includes(operation.status)) {
    return quarantineTerminalSubmission(handle, run, operation, submission, diagnostics, candidateId, `late session result rejected: run is ${run.status}`);
  }
  let artifactVersionId = submission.artifactVersionId;
  if (artifactVersionId === undefined && submission.content !== undefined) {
    const logicalId = submission.logicalId ?? `candidate-${run.id}`;
    const version = submission.version ?? "1";
    artifactVersionId = registerArtifactVersion(handle, { logicalId, version, content: submission.content, origin: submission.origin ?? "specialist-candidate", access: "full-text", dependencies: (submission.sourceVersionIds ?? []).map((versionId) => ({ versionId, relation: "derived-from" })) }).id;
  }
  const contract = getContract(handle, run.contractId, run.contractVersion);
  const checkpoint = checkLifecyclePolicy(handle, operation, "acceptance", { capability, destination: contract?.destination, purpose: contract?.purpose, allowCandidateSubmission: true });
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
  const cancellationReason = request.reason ?? "owner cancelled run";
  const active = activeDispatchMap(handle).get(run.id);
  active?.controller.abort(new Error(cancellationReason));
  fenceRevokedOperation(handle, run.operationId, cancellationReason, owner.ownerId);
  updateLifecycleOperationStatus(handle, run.operationId, "cancelled");
  const updated = updateRun(handle, run.id, "cancelled", cancellationReason);
  const remotePort = request.sessionPort ?? active?.sessionPort;
  const remoteSessionId = run.sessionId ?? active?.sessionId;
  if (remotePort && remoteSessionId && remotePort.cancel) {
    try {
      const remote = remotePort.cancel(remoteSessionId);
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

function safeProviderText(value: unknown): string {
  return redactDiagnostic(String(value ?? "")).slice(0, 160);
}

function safeProviderPricing(value: unknown): import("./work-types.js").PriceQuote {
  const pricing = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const status = pricing.status === "known" ? "known" : "unknown";
  const amount = Number(pricing.amount);
  return {
    status,
    ...(Number.isFinite(amount) && amount >= 0 ? { amount } : {}),
    ...(pricing.currency !== undefined ? { currency: safeProviderText(pricing.currency) } : {}),
    ...(pricing.unit !== undefined ? { unit: safeProviderText(pricing.unit) } : {}),
    ...(pricing.reason !== undefined ? { reason: safeProviderText(pricing.reason) } : {})
  };
}

export function recordProviderAttempt(handle: ProjectHandle, runId: string, attempt: Omit<import("./work-types.js").ProviderAttempt, "id" | "createdAt" | "runId">, reservationId?: string): void {
  assertWritable(handle); assertWorkSchema(handle);
  const outcome = ["ok", "timeout", "failure", "denied"].includes(String(attempt.outcome)) ? attempt.outcome : "failure";
  const pricing = safeProviderPricing(attempt.pricing);
  transaction(handle.db, () => {
    handle.db.prepare("INSERT INTO provider_attempts (id, run_id, destination, purpose, attempt, outcome, pricing, session_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(reservationId ?? newId("attempt"), runId, safeProviderText(attempt.destination), safeProviderText(attempt.purpose), Number.isSafeInteger(Number(attempt.attempt)) ? Number(attempt.attempt) : 0, outcome, JSON.stringify(pricing), attempt.sessionId === undefined ? null : safeProviderText(attempt.sessionId), isoNow());
    if (reservationId !== undefined) {
      handle.db.prepare("DELETE FROM provider_attempt_reservations WHERE id = ?").run(reservationId);
    }
  });
}

export function listProviderAttempts(handle: ProjectHandle, runId: string) {
  assertWorkSchema(handle);
  return (handle.db.prepare("SELECT * FROM provider_attempts WHERE run_id = ? ORDER BY attempt").all(runId) as Array<Record<string, unknown>>).map((row) => {
    let pricing: unknown;
    try { pricing = JSON.parse(String(row.pricing)); } catch { pricing = { status: "unknown", reason: "invalid pricing" }; }
    const outcome = String(row.outcome);
    return { id: String(row.id), runId: String(row.run_id), destination: safeProviderText(row.destination), purpose: safeProviderText(row.purpose), attempt: Number(row.attempt), outcome: ["ok", "timeout", "failure", "denied"].includes(outcome) ? outcome as "ok" | "timeout" | "failure" | "denied" : "failure", pricing: safeProviderPricing(pricing), sessionId: typeof row.session_id === "string" ? safeProviderText(row.session_id) : undefined, createdAt: String(row.created_at) };
  });
}