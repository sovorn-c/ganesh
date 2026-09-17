// story: e11s01
import { spawnSync } from "node:child_process";
import { FULL_ACCESS_NOTICE } from "../runtime/preflight-constants.js";
import { executeLocalCommand } from "../authority/capability-broker.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { newId } from "../persistence/storage-utils.js";
import type {
  AnalysisExecutionPolicy,
  AnalysisExecutionPolicyRequest,
  AnalysisProcessResult,
  AnalysisProcessRunner,
  CommandConfirmation,
  CommandConfirmationRequest,
  LocalCommandRequest,
  LocalCommandRunRecord
} from "./analysis-types.js";
import {
  assertAnalysisSchema,
  assertArgv,
  assertCwd,
  assertId,
  assertInspectionAccess,
  assertOwner,
  commandText,
  ensureWritableAnalysis,
  hashPayload,
  now,
  operationResult,
  recordOperation
} from "./analysis-utils.js";
import { EXECUTION_MODES, type ExecutionMode } from "../runtime/preflight-types.js";
import type { BashGuardConfig, CommandExecutionResult } from "../authority/capability-types.js";

function validMode(value: unknown): value is ExecutionMode {
  return typeof value === "string" && (EXECUTION_MODES as readonly string[]).includes(value);
}

function guardFor(value: unknown): BashGuardConfig {
  if (value === undefined) {
    return {};
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ProjectStoreError("invalid-argument", "bashGuard must be an object");
  }
  const guard = value as Record<string, unknown>;
  for (const key of ["allowedCommands", "deniedCommands", "requireApprovalCommands"]) {
    if (guard[key] !== undefined && (!Array.isArray(guard[key]) || (guard[key] as unknown[]).some((item) => typeof item !== "string" || item.trim() === ""))) {
      throw new ProjectStoreError("invalid-argument", `${key} must contain non-empty command strings`);
    }
  }
  return {
    ...(guard.allowedCommands === undefined ? {} : { allowedCommands: [...guard.allowedCommands as string[]] }),
    ...(guard.deniedCommands === undefined ? {} : { deniedCommands: [...guard.deniedCommands as string[]] }),
    ...(guard.requireApprovalCommands === undefined ? {} : { requireApprovalCommands: [...guard.requireApprovalCommands as string[]] })
  };
}

function policyFromRow(row: Record<string, unknown>): AnalysisExecutionPolicy {
  const mode = String(row.mode);
  if (!validMode(mode)) {
    throw new ProjectStoreError("invalid-record", "stored analysis execution mode is invalid");
  }
  let guard: BashGuardConfig;
  try {
    guard = guardFor(JSON.parse(String(row.bash_guard)));
  } catch (error) {
    if (error instanceof ProjectStoreError) {
      throw error;
    }
    throw new ProjectStoreError("invalid-record", "stored analysis bash guard is invalid");
  }
  return {
    projectId: String(row.project_id),
    mode,
    bashGuard: guard,
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function inspectPersistedPolicy(handle: ProjectHandle): AnalysisExecutionPolicy {
  const row = handle.db.prepare("SELECT * FROM analysis_execution_policies WHERE project_id = ?").get(handle.project.id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("unconfigured-mode", "unconfigured-mode: project execution mode has not been configured");
  }
  return policyFromRow(row);
}

export function configureAnalysisExecution(
  handle: ProjectHandle,
  capability: unknown,
  request: AnalysisExecutionPolicyRequest
): AnalysisExecutionPolicy {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  if (!validMode(request.mode)) {
    throw new ProjectStoreError("invalid-argument", "mode must be ask, approve or full-access");
  }
  const guard = guardFor(request.bashGuard ?? request.bashGuardConfig);
  const commandId = request.commandId ?? newId("analysis-policy");
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({ projectId: handle.project.id, mode: request.mode, bashGuard: guard });
  const existingId = operationResult(handle, commandId, "execution-policy", payloadHash);
  if (existingId) {
    return inspectPersistedPolicy(handle);
  }
  const prior = handle.db.prepare("SELECT created_at FROM analysis_execution_policies WHERE project_id = ?").get(handle.project.id) as { created_at?: unknown } | undefined;
  const createdAt = typeof prior?.created_at === "string" ? prior.created_at : now();
  const updatedAt = now();
  handle.db.prepare(`
    INSERT INTO analysis_execution_policies (project_id, mode, bash_guard, command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id) DO UPDATE SET mode = excluded.mode, bash_guard = excluded.bash_guard, command_id = excluded.command_id, updated_at = excluded.updated_at
  `).run(handle.project.id, request.mode, JSON.stringify(guard), commandId, createdAt, updatedAt);
  recordOperation(handle, commandId, "execution-policy", payloadHash, handle.project.id, updatedAt);
  return inspectPersistedPolicy(handle);
}

export function inspectAnalysisExecutionPolicy(handle: ProjectHandle, capability: unknown): AnalysisExecutionPolicy {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertInspectionAccess(handle, capability);
  return inspectPersistedPolicy(handle);
}

export function previewLocalCommand(handle: ProjectHandle, capability: unknown, request: LocalCommandRequest): CommandExecutionResult {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertInspectionAccess(handle, capability);
  const policy = inspectPersistedPolicy(handle);
  const argv = assertArgv(request.argv);
  return executeLocalCommand(policy.mode, policy.bashGuard, commandText(argv));
}

export function confirmLocalCommand(
  handle: ProjectHandle,
  capability: unknown,
  request: CommandConfirmationRequest
): CommandConfirmation {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const argv = assertArgv(request.argv);
  const policy = inspectPersistedPolicy(handle);
  const digest = argvDigestFor(argv);
  if (request.argvDigest !== undefined && request.argvDigest !== digest) {
    throw new ProjectStoreError("confirmation-mismatch", "confirmation argv digest does not match argv");
  }
  const decision = executeLocalCommand(policy.mode, policy.bashGuard, commandText(argv));
  if (decision.status === "denied") {
    throw new ProjectStoreError("command-denied", decision.reason);
  }
  const commandId = request.commandId ?? `confirm-${digest.slice(0, 40)}`;
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({ commandId, argv, argvDigest: digest, mode: policy.mode });
  const existingId = operationResult(handle, commandId, "command-confirmation", payloadHash);
  if (existingId) {
    const existing = handle.db.prepare("SELECT * FROM analysis_command_confirmations WHERE id = ?").get(existingId) as Record<string, unknown> | undefined;
    if (existing) {
      return confirmationFromRow(existing);
    }
  }
  const existing = handle.db.prepare("SELECT * FROM analysis_command_confirmations WHERE command_id = ? AND argv_digest = ?").get(commandId, digest) as Record<string, unknown> | undefined;
  if (existing) {
    return confirmationFromRow(existing);
  }
  const id = newId("analysis-confirm");
  const createdAt = now();
  handle.db.prepare(`
    INSERT INTO analysis_command_confirmations (id, command_id, argv_digest, argv, mode, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(id, commandId, digest, JSON.stringify(argv), policy.mode, createdAt);
  recordOperation(handle, commandId, "command-confirmation", payloadHash, id, createdAt);
  return confirmationFromRow(handle.db.prepare("SELECT * FROM analysis_command_confirmations WHERE id = ?").get(id) as Record<string, unknown>);
}

function confirmationFromRow(row: Record<string, unknown>): CommandConfirmation {
  return {
    id: String(row.id),
    commandId: String(row.command_id),
    argvDigest: String(row.argv_digest),
    argv: JSON.parse(String(row.argv)) as string[],
    mode: String(row.mode) as ExecutionMode,
    createdAt: String(row.created_at)
  };
}

function argvDigestFor(argv: readonly string[]): string {
  return hashPayload([...argv]);
}

function confirmationMatches(handle: ProjectHandle, request: LocalCommandRequest, digest: string, mode: ExecutionMode): boolean {
  const candidateId = request.confirmationId ?? (typeof request.confirmation === "string" ? request.confirmation : request.confirmation?.id);
  if (!candidateId) {
    return false;
  }
  const row = handle.db.prepare("SELECT argv_digest, mode FROM analysis_command_confirmations WHERE id = ?").get(candidateId) as { argv_digest?: unknown; mode?: unknown } | undefined;
  return row?.argv_digest === digest && row.mode === mode;
}

function defaultRunner(argv: readonly string[], options: { cwd: string; env?: Readonly<Record<string, string>>; shell: false; signal?: AbortSignal }): AnalysisProcessResult {
  const result = spawnSync(argv[0], [...argv.slice(1)], {
    cwd: options.cwd,
    env: options.env === undefined ? process.env : { ...process.env, ...options.env },
    shell: false,
    encoding: "utf8",
    timeout: 120_000
  });
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout ?? "",
    stderr: result.error ? `${result.stderr ?? ""}${result.stderr ? "\n" : ""}${result.error.message}` : (result.stderr ?? "")
  };
}

export function runLocalCommand(handle: ProjectHandle, capability: unknown, request: LocalCommandRequest): LocalCommandRunRecord {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const policy = inspectPersistedPolicy(handle);
  const argv = assertArgv(request.argv);
  const cwd = assertCwd(handle, request.cwd);
  const commandId = request.commandId ?? newId("local-command-command");
  assertId(commandId, "commandId");
  const decision = executeLocalCommand(policy.mode, policy.bashGuard, commandText(argv));
  if (decision.status === "denied") {
    throw new ProjectStoreError("command-denied", decision.reason);
  }
  const digest = argvDigestFor(argv);
  if (policy.mode !== "full-access" && !confirmationMatches(handle, request, digest, policy.mode)) {
    throw new ProjectStoreError("confirmation-required", "owner confirmation for the exact argv is required");
  }
  const startedAt = now();
  const runner = request.runner ?? defaultRunner;
  let result: AnalysisProcessResult;
  try {
    result = runner(argv, {
      cwd,
      env: request.env,
      shell: false
    });
  } catch (error) {
    result = { exitCode: null, stderr: error instanceof Error ? error.message : String(error) };
  }
  const endedAt = now();
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const cancelled = result.cancelled === true;
  return {
    id: newId("local-command"),
    commandId,
    argv,
    argvDigest: digest,
    cwd,
    mode: policy.mode,
    status: cancelled ? "quarantined" : result.exitCode === 0 ? "succeeded" : "failed",
    exitCode: result.exitCode ?? null,
    ...(result.signal ? { signal: result.signal } : {}),
    stdout,
    stderr,
    ...(decision.notice === FULL_ACCESS_NOTICE ? { notice: decision.notice } : {}),
    startedAt: result.startedAt ?? startedAt,
    endedAt: result.endedAt ?? endedAt
  };
}
