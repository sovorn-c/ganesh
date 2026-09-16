// story: e05s01, e05s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isoNow, newId, assertIdentifier } from "../persistence/storage-utils.js";
import { transaction } from "../persistence/schema.js";
import { redactDiagnostic } from "../runtime/preflight.js";
import {
  SPECIALIST_ROLES,
  type BudgetDimension,
  type CandidateAcceptance,
  type DisagreementRecord,
  type SpecialistRole,
  type StandingPermissionInput,
  type StandingPermissionRecord,
  type WorkContractInput,
  type WorkContractRecord,
  type WorkDiagnostic,
  type WorkRunRecord,
  type WorkStatus
} from "./work-types.js";

export const WORK_TABLES = ["work_contracts", "standing_permissions", "work_runs", "work_candidates", "work_budget_ledger", "work_disagreements", "provider_attempts"] as const;

export function assertWorkSchema(handle: ProjectHandle): void {
  try {
    const row = handle.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'work_contracts'").get();
    if (row === undefined) {throw new Error("missing");}
  } catch {
    throw new ProjectStoreError("work-schema-unavailable", "E05 work tables are unavailable; open a writable ready project or migrate it");
  }
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

function safeStoredDiagnostics(value: unknown): readonly WorkDiagnostic[] {
  const diagnostics = parseJson<unknown[]>(value, []);
  if (!Array.isArray(diagnostics)) { return []; }
  return diagnostics.slice(0, 32).map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const count = Number(item.count);
    return {
      code: redactDiagnostic(String(item.code ?? "diagnostic")).slice(0, 160),
      severity: item.severity === "warning" || item.severity === "error" ? item.severity : "info",
      count: Number.isSafeInteger(count) ? Math.max(1, Math.min(1000000, count)) : 1
    };
  });
}

function contractRow(row: Record<string, unknown>): WorkContractRecord {
  const scope = parseJson<Record<string, unknown>>(row.scope, {});
  const protocolValue = scope.protocolVersionId;
  if (protocolValue !== undefined && (typeof protocolValue !== "string" || protocolValue.trim() === "")) {
    throw new ProjectStoreError("forbidden", "stored contract protocolVersionId is invalid");
  }
  return {
    id: String(row.id), version: Number(row.version),
    parentContractId: typeof row.parent_contract_id === "string" ? row.parent_contract_id : undefined,
    budgetGroupId: String(row.budget_group_id), objective: String(row.objective),
    scope,
    protocolVersionId: typeof protocolValue === "string" ? protocolValue : undefined,
    inputVersionIds: parseJson<string[]>(row.input_version_ids, []),
    permittedRoles: parseJson<SpecialistRole[]>(row.permitted_roles, ["supervisor"]),
    limits: parseJson(row.limits, { tokens: 0, calls: 0, timeMs: 0 }),
    destination: String(row.destination), purpose: String(row.purpose),
    executionMode: typeof row.execution_mode === "string" ? row.execution_mode : undefined,
    authorizationBasis: String(row.authorization_basis),
    branchId: typeof row.branch_id === "string" ? row.branch_id : undefined,
    status: String(row.status) as WorkContractRecord["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function runRow(row: Record<string, unknown>): WorkRunRecord {
  return {
    id: String(row.id), contractId: String(row.contract_id), contractVersion: Number(row.contract_version),
    role: String(row.role) as SpecialistRole, commandId: String(row.command_id), payloadHash: String(row.payload_hash),
    operationId: String(row.operation_id), inputVersionIds: parseJson<string[]>(row.input_version_ids, []),
    reserved: parseJson<Partial<Record<BudgetDimension, number>>>(row.reserved, {}),
    status: String(row.status) as WorkRunRecord["status"],
    sessionId: typeof row.session_id === "string" ? row.session_id : undefined,
    failureReason: typeof row.failure_reason === "string" ? row.failure_reason : undefined,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function getContract(handle: ProjectHandle, id: string, version?: number): WorkContractRecord | null {
  assertWorkSchema(handle);
  const row = (version === undefined
    ? handle.db.prepare("SELECT * FROM work_contracts WHERE id = ? ORDER BY version DESC LIMIT 1").get(id)
    : handle.db.prepare("SELECT * FROM work_contracts WHERE id = ? AND version = ?").get(id, version)) as Record<string, unknown> | undefined;
  return row === undefined ? null : contractRow(row);
}

export function listContracts(handle: ProjectHandle): readonly WorkContractRecord[] {
  assertWorkSchema(handle);
  return (handle.db.prepare("SELECT * FROM work_contracts ORDER BY id, version").all() as Array<Record<string, unknown>>).map(contractRow);
}

export function insertContract(handle: ProjectHandle, input: WorkContractInput, status: "proposed" | "authorized" = "proposed", budgetGroupId?: string): WorkContractRecord {
  assertWritable(handle); assertWorkSchema(handle);
  if (typeof input.objective !== "string" || input.objective.trim() === "") {throw new ProjectStoreError("invalid-argument", "objective is required");}
  if (!input.limits || typeof input.limits !== "object") {throw new ProjectStoreError("invalid-limit", "finite work limits are required");}
  const id = assertIdentifier(input.id ?? input.contractId ?? newId("contract"), "contractId");
  const version = input.version ?? 1;
  if (!Number.isInteger(version) || version < 1) {throw new ProjectStoreError("invalid-version", "contract version must be positive");}
  const inputVersionIds = [...(input.inputVersionIds ?? input.inputs ?? [])];
  const permittedRoles = [...(input.permittedRoles ?? (input.role === undefined ? ["supervisor"] : [input.role]))];
  if (permittedRoles.length === 0 || permittedRoles.some((role) => !SPECIALIST_ROLES.includes(role))) {throw new ProjectStoreError("invalid-role", "at least one valid specialist role is required");}
  const limits = input.limits;
  for (const key of ["tokens", "calls", "timeMs"] as const) {
    if (!Number.isFinite(limits[key]) || limits[key] < 0) {throw new ProjectStoreError("invalid-limit", `${key} must be finite and non-negative`);}
  }
  if (limits.spend !== undefined && (!Number.isFinite(limits.spend) || limits.spend < 0)) {throw new ProjectStoreError("invalid-limit", "spend must be finite and non-negative");}
  const now = isoNow();
  const group = budgetGroupId ?? newId("budget");
  const scope = { ...(input.scope ?? {}), ...(input.protocolVersionId === undefined ? {} : { protocolVersionId: input.protocolVersionId }) };
  if (scope.protocolVersionId !== undefined) {
    if (typeof scope.protocolVersionId !== "string") { throw new ProjectStoreError("invalid-identifier", "protocolVersionId must be a string"); }
    assertIdentifier(scope.protocolVersionId, "protocolVersionId");
  }
  transaction(handle.db, () => {
    handle.db.prepare(`INSERT INTO work_contracts
      (id, version, parent_contract_id, budget_group_id, objective, scope, input_version_ids, permitted_roles, limits, destination, purpose, execution_mode, authorization_basis, branch_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, version, input.parentContractId ?? null, group, input.objective, JSON.stringify(scope), JSON.stringify(inputVersionIds), JSON.stringify(permittedRoles), JSON.stringify(limits), input.destination ?? "local", input.purpose ?? "research-work", input.executionMode ?? null, input.authorizationBasis ?? "owner-action", input.branchId ?? null, status, now, now);
  });
  return getContract(handle, id, version)!;
}

export function authorizeStoredContract(handle: ProjectHandle, id: string, version: number): WorkContractRecord {
  assertWritable(handle); assertWorkSchema(handle);
  const current = getContract(handle, id, version);
  if (current === null) {throw new ProjectStoreError("not-found", `work contract not found: ${id}@${version}`);}
  if (current.status === "authorized") {return current;}
  if (current.status !== "proposed") {throw new ProjectStoreError("invalid-transition", `contract is ${current.status} and cannot be authorized`);}
  const now = isoNow();
  transaction(handle.db, () => handle.db.prepare("UPDATE work_contracts SET status = 'authorized', updated_at = ? WHERE id = ? AND version = ?").run(now, id, version));
  return getContract(handle, id, version)!;
}

export function insertStandingPermission(handle: ProjectHandle, ownerId: string, input: StandingPermissionInput): StandingPermissionRecord {
  assertWritable(handle); assertWorkSchema(handle);
  const id = assertIdentifier(input.id ?? newId("standing"), "standingPermissionId");
  if (!input.role || !SPECIALIST_ROLES.includes(input.role) || !input.limits || !Number.isFinite(input.limits.calls) || !Number.isFinite(input.limits.tokens) || !Number.isFinite(input.limits.timeMs)) {throw new ProjectStoreError("invalid-argument", "standing permission role and finite limits are required");}
  const createdAt = isoNow();
  transaction(handle.db, () => handle.db.prepare(`INSERT INTO standing_permissions
    (id, owner_id, objective_pattern, scope, role, input_version_ids, destination, purpose, limits, expires_at, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`)
    .run(id, ownerId, input.objectivePattern ?? "*", JSON.stringify(input.scope ?? {}), input.role, JSON.stringify(input.inputVersionIds ?? []), input.destination ?? "local", input.purpose ?? "research-work", JSON.stringify(input.limits), input.expiresAt ?? null, createdAt));
  return getStandingPermission(handle, id)!;
}

export function getStandingPermission(handle: ProjectHandle, id: string): StandingPermissionRecord | null {
  assertWorkSchema(handle);
  const row = handle.db.prepare("SELECT * FROM standing_permissions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {return null;}
  return {
    id: String(row.id), ownerId: String(row.owner_id), objectivePattern: String(row.objective_pattern), scope: parseJson(row.scope, {}), role: String(row.role) as SpecialistRole,
    inputVersionIds: parseJson(row.input_version_ids, []), destination: String(row.destination), purpose: String(row.purpose), limits: parseJson(row.limits, { tokens: 0, calls: 0, timeMs: 0 }), expiresAt: typeof row.expires_at === "string" ? row.expires_at : undefined,
    status: String(row.status) as StandingPermissionRecord["status"], createdAt: String(row.created_at)
  };
}

export function updateRun(handle: ProjectHandle, runId: string, status: WorkStatus, reason?: string, sessionId?: string): WorkRunRecord {
  assertWritable(handle); assertWorkSchema(handle);
  const now = isoNow();
  transaction(handle.db, () => handle.db.prepare("UPDATE work_runs SET status = ?, failure_reason = ?, session_id = COALESCE(?, session_id), updated_at = ? WHERE id = ?").run(status, reason ?? null, sessionId ?? null, now, runId));
  const row = handle.db.prepare("SELECT * FROM work_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!row) {throw new ProjectStoreError("not-found", `work run not found: ${runId}`);}
  return runRow(row);
}

export function getRun(handle: ProjectHandle, runId: string): WorkRunRecord | null {
  assertWorkSchema(handle);
  const row = handle.db.prepare("SELECT * FROM work_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  return row === undefined ? null : runRow(row);
}

export function getRunByCommand(handle: ProjectHandle, commandId: string): WorkRunRecord | null {
  assertWorkSchema(handle);
  const row = handle.db.prepare("SELECT * FROM work_runs WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  return row === undefined ? null : runRow(row);
}

export function listRuns(handle: ProjectHandle, contractId?: string): readonly WorkRunRecord[] {
  assertWorkSchema(handle);
  const rows = (contractId === undefined ? handle.db.prepare("SELECT * FROM work_runs ORDER BY created_at").all() : handle.db.prepare("SELECT * FROM work_runs WHERE contract_id = ? ORDER BY created_at").all(contractId)) as Array<Record<string, unknown>>;
  return rows.map(runRow);
}

export function insertRun(handle: ProjectHandle, run: Omit<WorkRunRecord, "createdAt" | "updatedAt">): WorkRunRecord {
  assertWritable(handle); assertWorkSchema(handle);
  const now = isoNow();
  transaction(handle.db, () => handle.db.prepare(`INSERT INTO work_runs
    (id, contract_id, contract_version, role, command_id, payload_hash, operation_id, input_version_ids, reserved, status, session_id, failure_reason, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(run.id, run.contractId, run.contractVersion, run.role, run.commandId, run.payloadHash, run.operationId, JSON.stringify(run.inputVersionIds), JSON.stringify(run.reserved), run.status, run.sessionId ?? null, run.failureReason ?? null, now, now));
  return getRun(handle, run.id)!;
}

export function insertCandidate(handle: ProjectHandle, input: { readonly id: string; readonly runId: string; readonly artifactVersionId?: string; readonly diagnostics: readonly WorkDiagnostic[]; readonly sourceVersionIds: readonly string[]; readonly status: string; readonly reason: string }): void {
  assertWritable(handle); assertWorkSchema(handle);
  transaction(handle.db, () => handle.db.prepare("INSERT INTO work_candidates (id, run_id, artifact_version_id, diagnostics, source_version_ids, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(input.id, input.runId, input.artifactVersionId ?? null, JSON.stringify(input.diagnostics), JSON.stringify(input.sourceVersionIds), input.status, input.reason, isoNow()));
}

export function candidateRows(handle: ProjectHandle, runId?: string): readonly CandidateAcceptance[] {
  assertWorkSchema(handle);
  const rows = (runId === undefined ? handle.db.prepare("SELECT * FROM work_candidates ORDER BY created_at").all() : handle.db.prepare("SELECT * FROM work_candidates WHERE run_id = ? ORDER BY created_at").all(runId)) as Array<Record<string, unknown>>;
  return rows.map((row) => ({ status: String(row.status) as CandidateAcceptance["status"], runId: String(row.run_id), candidateId: String(row.id), artifactVersionId: typeof row.artifact_version_id === "string" ? row.artifact_version_id : undefined, reason: redactDiagnostic(String(row.reason)), diagnostics: safeStoredDiagnostics(row.diagnostics) }));
}

export function replaceContractVersion(handle: ProjectHandle, old: WorkContractRecord, input: WorkContractInput): WorkContractRecord {
  return insertContract(handle, { ...input, id: old.id, version: old.version + 1, parentContractId: `${old.id}@${old.version}`, objective: input.objective ?? old.objective, inputVersionIds: input.inputVersionIds ?? old.inputVersionIds, limits: input.limits ?? old.limits }, "proposed", old.budgetGroupId);
}

export function asRecord(value: unknown): Record<string, unknown> { return jsonObject(value); }