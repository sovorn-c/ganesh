// story: e11s02
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluatePolicy } from "../policy/policy-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { createLifecycleOperation, updateLifecycleOperationStatus } from "../lifecycle/lifecycle-gate.js";
import { transaction } from "../persistence/schema.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { newId } from "../persistence/storage-utils.js";
import type {
  AnalysisAttribution,
  AnalysisCandidateRecord,
  AnalysisCandidateRequest,
  AnalysisRunRecord,
  AnalysisRunQuery,
  AnalysisRunRequest,
  LocalCommandRunRecord
} from "./analysis-types.js";
import {
  assertAnalysisSchema,
  assertCurrentActivity,
  assertId,
  assertInspectionAccess,
  assertOptionalReferences,
  assertOwner,
  assertVersionIds,
  ensureWritableAnalysis,
  hashPayload,
  now,
  operationResult,
  recordOperation,
  resolveAttribution,
  resolveOrigin
} from "./analysis-utils.js";
import { runLocalCommand } from "./command-runner.js";

function rowRun(handle: ProjectHandle, id: string): AnalysisRunRecord {
  const row = handle.db.prepare("SELECT * FROM analysis_runs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `analysis run ${id} was not found`);
  }
  return runFromRow(handle, row);
}

function artifactText(handle: ProjectHandle, id: unknown): string | undefined {
  if (typeof id !== "string") {return undefined;}
  const row = handle.db.prepare("SELECT storage_path FROM artifact_versions WHERE id = ?").get(id) as { storage_path?: unknown } | undefined;
  if (typeof row?.storage_path !== "string") {return undefined;}
  try {
    return readFileSync(join(handle.project.artifactRoot, row.storage_path), "utf8");
  } catch {
    return undefined;
  }
}

function runFromRow(handle: ProjectHandle, row: Record<string, unknown>, includeOutput = true): AnalysisRunRecord {
  const scriptVersionId = typeof row.script_version_id === "string" ? row.script_version_id : undefined;
  const commandOrScriptVersion = typeof row.command_or_script_version === "string" ? row.command_or_script_version : undefined;
  return {
    id: String(row.id),
    commandId: String(row.command_id),
    inputVersionIds: JSON.parse(String(row.input_version_ids ?? "[]")) as string[],
    argv: JSON.parse(String(row.argv)) as string[],
    argvDigest: String(row.argv_digest),
    cwd: String(row.cwd),
    ...(scriptVersionId ? { scriptVersionId } : {}),
    ...(commandOrScriptVersion ? { commandOrScriptVersion } : {}),
    parameters: JSON.parse(String(row.parameters ?? "{}")) as Record<string, unknown>,
    ...(typeof row.stdout_artifact_id === "string" ? { stdoutArtifactId: row.stdout_artifact_id, ...(includeOutput ? { stdout: artifactText(handle, row.stdout_artifact_id) } : {}) } : {}),
    ...(typeof row.stderr_artifact_id === "string" ? { stderrArtifactId: row.stderr_artifact_id, ...(includeOutput ? { stderr: artifactText(handle, row.stderr_artifact_id) } : {}) } : {}),
    diagnostics: JSON.parse(String(row.diagnostics ?? "{}")) as Record<string, unknown>,
    environment: JSON.parse(String(row.environment ?? "{}")) as Record<string, unknown>,
    mode: String(row.mode) as AnalysisRunRecord["mode"],
    status: String(row.status) as AnalysisRunRecord["status"],
    exitCode: row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
    ...(typeof row.signal === "string" ? { signal: row.signal } : {}),
    repeatability: "reported",
    reproduced: Boolean(row.reproduced),
    ...(typeof row.analysis_plan_id === "string" ? { analysisPlanId: row.analysis_plan_id } : {}),
    ...(typeof row.protocol_version_id === "string" ? { protocolVersionId: row.protocol_version_id } : {}),
    ...(typeof row.activity === "string" ? { activity: row.activity as AnalysisRunRecord["activity"] } : {}),
    ...(typeof row.population === "string" ? { population: row.population } : {}),
    dataClasses: JSON.parse(String(row.data_classes ?? "[]")) as string[],
    ...(typeof row.data_use === "string" ? { dataUse: row.data_use } : {}),
    ...(typeof row.profile_id === "string" ? { profileId: row.profile_id } : {}),
    ...(typeof row.confirmatory_or_exploratory === "string" ? { confirmatoryOrExploratory: row.confirmatory_or_exploratory as "confirmatory" | "exploratory" } : {}),
    ...(typeof row.external_output_id === "string" ? { externalOutputId: row.external_output_id } : {}),
    attribution: String(row.attribution) as AnalysisAttribution,
    origin: String(row.origin) as AnalysisRunRecord["origin"],
    startedAt: String(row.started_at),
    endedAt: String(row.ended_at),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function metadataOnlyRun(run: AnalysisRunRecord): AnalysisRunRecord {
  const { stdout: _stdout, stderr: _stderr, ...metadata } = run;
  return {
    ...metadata,
    argv: run.argv.length === 0 ? [] : ["[REDACTED]"],
    parameters: { redacted: true },
    diagnostics: { redacted: true },
    environment: { redacted: true }
  };
}

function effectiveConfirmatoryLabel(handle: ProjectHandle, request: AnalysisRunRequest): "confirmatory" | "exploratory" | undefined {
  if (request.confirmatoryOrExploratory !== "confirmatory") {
    return request.confirmatoryOrExploratory;
  }
  if (request.analysisPlanId === undefined) {
    return "exploratory";
  }
  const row = handle.db.prepare("SELECT confirmatory_or_exploratory, status FROM analysis_plans WHERE id = ?").get(request.analysisPlanId) as { confirmatory_or_exploratory?: unknown; status?: unknown } | undefined;
  return row?.confirmatory_or_exploratory === "confirmatory" && row.status === "current" ? "confirmatory" : "exploratory";
}

function commandResultToRun(
  handle: ProjectHandle,
  request: AnalysisRunRequest,
  effectiveConfirmatoryOrExploratory: "confirmatory" | "exploratory" | undefined,
  inputVersionIds: string[],
  scriptVersionId: string | undefined,
  run: LocalCommandRunRecord,
  runId: string,
  attribution: AnalysisAttribution,
  origin: AnalysisRunRecord["origin"],
  allowReproduced: boolean
): AnalysisRunRecord {
  if (request.reproduced === true && !allowReproduced) {
    throw new ProjectStoreError("forbidden", "reproduced status can only be set by independent reproduction");
  }
  const parameters = request.parameters ?? {};
  const diagnostics = request.diagnostics ?? {};
  const environment = request.environment ?? {};
  const commandOrScriptVersion = request.commandOrScriptVersion;
  const outputDependencies = inputVersionIds.map((versionId) => ({ versionId, relation: "analysis-input" }));
  const keepOutput = run.status !== "quarantined" && run.status !== "cancelled";
  const stdoutArtifact = keepOutput && run.stdout !== "" ? registerArtifactVersion(handle, {
    logicalId: `analysis-${runId}-stdout`,
    version: "1",
    content: run.stdout,
    origin: "analysis-stdout",
    access: "metadata-only",
    dependencies: outputDependencies
  }) : undefined;
  const stderrArtifact = keepOutput && run.stderr !== "" ? registerArtifactVersion(handle, {
    logicalId: `analysis-${runId}-stderr`,
    version: "1",
    content: run.stderr,
    origin: "analysis-stderr",
    access: "metadata-only",
    dependencies: outputDependencies
  }) : undefined;
  const createdAt = now();
  try {
    handle.db.prepare(`
      INSERT INTO analysis_runs (
        id, command_id, input_version_ids, argv, argv_digest, script_version_id,
        command_or_script_version, cwd, parameters, stdout_artifact_id, stderr_artifact_id,
        diagnostics, environment, mode, status, exit_code, signal, repeatability,
        reproduced, analysis_plan_id, protocol_version_id, activity, population,
        data_classes, data_use, profile_id, confirmatory_or_exploratory,
        external_output_id, attribution, origin, started_at, ended_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'reported', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      runId,
      run.commandId,
      JSON.stringify(inputVersionIds),
      JSON.stringify(run.argv),
      run.argvDigest,
      scriptVersionId ?? null,
      commandOrScriptVersion ?? null,
      run.cwd,
      JSON.stringify(parameters),
      stdoutArtifact?.id ?? null,
      stderrArtifact?.id ?? null,
      JSON.stringify(diagnostics),
      JSON.stringify(environment),
      run.mode,
      run.status,
      run.exitCode,
      run.signal ?? null,
      request.reproduced === true ? 1 : 0,
      request.analysisPlanId ?? null,
      request.protocolVersionId ?? null,
      request.activity ?? null,
      request.population ?? null,
      JSON.stringify(request.dataClasses ?? []),
      request.dataUse ?? null,
      request.profileId ?? null,
      effectiveConfirmatoryOrExploratory ?? null,
      request.externalOutputId ?? null,
      attribution,
      origin,
      run.startedAt,
      run.endedAt,
      createdAt,
      createdAt
    );
  } catch (error) {
    if (stdoutArtifact) {
      discardArtifactVersion(handle, stdoutArtifact.id);
    }
    if (stderrArtifact) {
      discardArtifactVersion(handle, stderrArtifact.id);
    }
    throw error;
  }
  if (!keepOutput) {
    updateLifecycleOperationStatus(handle, runId, "quarantined");
    const reason = "late output from cancelled analysis run";
    transaction(handle.db, () => {
      handle.db.prepare("INSERT INTO quarantined_outputs (id, operation_id, candidate_id, reason, disposition, details, created_at) VALUES (?, ?, ?, ?, 'quarantined', ?, ?)").run(newId("quar"), runId, runId, reason, JSON.stringify({ stdout: run.stdout, stderr: run.stderr }), now());
      handle.db.prepare("INSERT INTO analysis_quarantined_outputs (id, run_id, stdout, stderr, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(newId("analysis-quarantine"), runId, run.stdout, run.stderr, reason, now());
    });
  } else {
    updateLifecycleOperationStatus(handle, runId, "completed");
  }
  return rowRun(handle, runId);
}

function runAuthorizedAnalysisInternal(handle: ProjectHandle, capability: unknown, request: AnalysisRunRequest, allowReproduced: boolean): AnalysisRunRecord {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const inputVersionIds = assertVersionIds(handle, request.inputVersionIds);
  assertOptionalReferences(handle, request);
  assertCurrentActivity(handle, request);
  if (request.destination !== undefined && request.destination !== "local") {
    const decision = evaluatePolicy(handle, { inputVersions: inputVersionIds, destination: request.destination, purpose: request.purpose ?? "analysis" });
    if (decision.result !== "allow") {
      throw new ProjectStoreError("policy-denied", decision.reason);
    }
  } else if (inputVersionIds.length > 0) {
    const decision = evaluatePolicy(handle, { inputVersions: inputVersionIds, destination: "local", purpose: request.purpose ?? "analysis" });
    if (decision.result !== "allow") {
      throw new ProjectStoreError("policy-denied", decision.reason);
    }
  }
  const scriptVersionId = request.scriptVersionId ?? request.scriptArtifactVersionId;
  const commandId = request.commandId ?? newId("analysis-run-command");
  assertId(commandId, "commandId");
  if (request.reproduced === true && !allowReproduced) {
    throw new ProjectStoreError("forbidden", "reproduced status can only be set by independent reproduction");
  }
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const effectiveConfirmatoryOrExploratory = effectiveConfirmatoryLabel(handle, request);
  const effectiveRequest = { ...request, commandId, confirmatoryOrExploratory: effectiveConfirmatoryOrExploratory };
  const payloadHash = hashPayload({
    inputVersionIds,
    argv: request.argv,
    scriptVersionId: scriptVersionId ?? null,
    commandOrScriptVersion: request.commandOrScriptVersion ?? null,
    parameters: request.parameters ?? {},
    environment: request.environment ?? {},
    analysisPlanId: request.analysisPlanId ?? null,
    protocolVersionId: request.protocolVersionId ?? null,
    activity: request.activity ?? null,
    population: request.population ?? null,
    dataClasses: request.dataClasses ?? [],
    dataUse: request.dataUse ?? null,
    profileId: request.profileId ?? null,
    confirmatoryOrExploratory: effectiveConfirmatoryOrExploratory ?? null,
    reproduced: request.reproduced === true,
    externalOutputId: request.externalOutputId ?? null
  });
  const existingId = operationResult(handle, commandId, "analysis-run", payloadHash);
  if (existingId) {return rowRun(handle, existingId);}
  const id = newId("analysis-run");
  createLifecycleOperation(handle, {
    id,
    operationType: "local-analysis",
    inputSnapshot: {
      versionIds: inputVersionIds,
      ...(scriptVersionId ? { scriptVersionId } : {}),
      ...(request.protocolVersionId ? { protocolVersionId: request.protocolVersionId } : {}),
      ...(request.activity ? { activity: request.activity } : {}),
      ...(request.population ? { population: request.population } : {}),
      ...(request.dataClasses ? { dataClasses: request.dataClasses } : {}),
      ...(request.dataUse ? { dataUse: request.dataUse } : {}),
      ...(request.destination ? { destination: request.destination } : {}),
      ...(request.purpose ? { purpose: request.purpose } : {}),
      ...(request.conditions !== undefined ? { conditions: request.conditions } : {})
    }
  });
  let run: LocalCommandRunRecord;
  try {
    run = runLocalCommand(handle, capability, effectiveRequest);
  } catch (error) {
    updateLifecycleOperationStatus(handle, id, "blocked");
    throw error;
  }
  let record: AnalysisRunRecord;
  try {
    record = commandResultToRun(handle, effectiveRequest, effectiveConfirmatoryOrExploratory, inputVersionIds, scriptVersionId, run, id, attribution, origin, allowReproduced);
  } catch (error) {
    updateLifecycleOperationStatus(handle, id, "blocked");
    throw error;
  }
  recordOperation(handle, commandId, "analysis-run", payloadHash, id, record.createdAt);
  return record;
}

export function runAuthorizedAnalysis(handle: ProjectHandle, capability: unknown, request: AnalysisRunRequest): AnalysisRunRecord {
  return runAuthorizedAnalysisInternal(handle, capability, request, false);
}

export function inspectAnalysisRuns(handle: ProjectHandle, capability: unknown, query: AnalysisRunQuery = {}): readonly AnalysisRunRecord[] {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertInspectionAccess(handle, capability);
  const conditions: string[] = [];
  const params: string[] = [];
  if (query.id !== undefined) { conditions.push("id = ?"); params.push(query.id); }
  if (query.commandId !== undefined) { conditions.push("command_id = ?"); params.push(query.commandId); }
  if (query.externalOutputId !== undefined) { conditions.push("external_output_id = ?"); params.push(query.externalOutputId); }
  const where = conditions.length === 0 ? "" : ` WHERE ${conditions.join(" AND ")}`;
  const rows = handle.db.prepare(`SELECT * FROM analysis_runs${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>;
  const worker = isWorkerCapability(capability);
  return rows.map((row) => {
    const run = runFromRow(handle, row, !worker);
    return worker ? metadataOnlyRun(run) : run;
  });
}

export function cancelAnalysisRun(handle: ProjectHandle, capability: unknown, runId: string, reason = "owner cancelled analysis run"): AnalysisRunRecord {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const current = rowRun(handle, runId);
  if (["succeeded", "failed", "cancelled", "quarantined"].includes(current.status)) {return current;}
  handle.db.prepare("UPDATE analysis_runs SET status = 'cancelled', updated_at = ? WHERE id = ?").run(now(), runId);
  updateLifecycleOperationStatus(handle, runId, "cancelled");
  transaction(handle.db, () => {
    handle.db.prepare("INSERT INTO quarantined_outputs (id, operation_id, candidate_id, reason, disposition, details, created_at) VALUES (?, ?, ?, ?, 'quarantined', ?, ?)").run(newId("quar"), runId, runId, reason, JSON.stringify({}), now());
    handle.db.prepare("INSERT INTO analysis_quarantined_outputs (id, run_id, reason, created_at) VALUES (?, ?, ?, ?)").run(newId("analysis-quarantine"), runId, reason, now());
  });
  return rowRun(handle, runId);
}

export function ingestAnalysisCandidate(handle: ProjectHandle, capability: unknown, request: AnalysisCandidateRequest): AnalysisCandidateRecord {
  ensureWritableAnalysis(handle);
  if (isOwnerCapability(capability)) {
    assertOwner(handle, capability);
  } else if (isWorkerCapability(capability)) {
    if (capability.projectId !== handle.project.id || !capability.canPerform("analysis:ingest") && !capability.canPerform("analysis:record") && !capability.canPerform("methodology:analysis")) {
      throw new ProjectStoreError("forbidden", "forbidden: worker lacks analysis:ingest capability");
    }
  } else {
    throw new ProjectStoreError("forbidden", "forbidden: untrusted caller cannot ingest analysis candidates");
  }
  const inputVersionIds = assertVersionIds(handle, request.inputVersionIds);
  const scriptVersionId = request.scriptVersionId;
  if (scriptVersionId !== undefined) {assertVersionIds(handle, [scriptVersionId]);}
  const commandId = request.commandId ?? newId("analysis-candidate-command");
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({ payload: request.payload, inputVersionIds, scriptVersionId: scriptVersionId ?? null });
  const existingId = operationResult(handle, commandId, "analysis-candidate", payloadHash);
  if (existingId) {
    const row = handle.db.prepare("SELECT * FROM analysis_candidates WHERE id = ?").get(existingId) as Record<string, unknown>;
    return candidateFromRow(row);
  }
  const id = newId("analysis-candidate");
  const createdAt = now();
  handle.db.prepare("INSERT INTO analysis_candidates (id, payload, attribution, origin, status, command_id, created_at) VALUES (?, ?, 'agent-inferred', 'specialist-proposed', 'proposed', ?, ?)").run(id, JSON.stringify({ ...request.payload, inputVersionIds, scriptVersionId }), commandId, createdAt);
  recordOperation(handle, commandId, "analysis-candidate", payloadHash, id, createdAt);
  return candidateFromRow(handle.db.prepare("SELECT * FROM analysis_candidates WHERE id = ?").get(id) as Record<string, unknown>);
}

function candidateFromRow(row: Record<string, unknown>): AnalysisCandidateRecord {
  const payload = JSON.parse(String(row.payload)) as Record<string, unknown>;
  return {
    id: String(row.id),
    payload,
    inputVersionIds: Array.isArray(payload.inputVersionIds) ? payload.inputVersionIds as string[] : [],
    ...(typeof payload.scriptVersionId === "string" ? { scriptVersionId: payload.scriptVersionId } : {}),
    attribution: "agent-inferred",
    origin: "specialist-proposed",
    status: "proposed",
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

export { runAuthorizedAnalysisInternal };
