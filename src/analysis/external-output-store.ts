// story: e11s05
import { inspectArtifactVersion, getArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isWorkerCapability } from "../authority/capability-broker.js";
import { newId } from "../persistence/storage-utils.js";
import type { ExternalAnalysisOutputQuery, ExternalAnalysisOutputRecord, ExternalAnalysisOutputRequest, ReproduceAnalysisRunRequest } from "./analysis-types.js";
import { assertAnalysisSchema, assertId, assertInspectionAccess, assertOwner, assertVersionIds, ensureWritableAnalysis, hashPayload, now, operationResult, recordOperation } from "./analysis-utils.js";
import { inspectAnalysisRuns, runAuthorizedAnalysis } from "./run-store.js";

function recordFromRow(row: Record<string, unknown>): ExternalAnalysisOutputRecord {
  return {
    id: String(row.id),
    artifactVersionId: String(row.artifact_version_id),
    inputVersionIds: JSON.parse(String(row.input_version_ids ?? "[]")) as string[],
    ...(typeof row.argv_digest === "string" ? { argvDigest: row.argv_digest } : {}),
    ...(typeof row.command_or_script_version === "string" ? { commandOrScriptVersion: row.command_or_script_version } : {}),
    parameters: JSON.parse(String(row.parameters ?? "{}")) as Record<string, unknown>,
    authenticity: "reported",
    reproduced: false,
    ...(typeof row.source === "string" ? { source: row.source } : {}),
    ...(typeof row.notes === "string" ? { notes: row.notes } : {}),
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function outputRow(handle: ProjectHandle, id: string): ExternalAnalysisOutputRecord {
  const row = handle.db.prepare("SELECT * FROM external_analysis_outputs WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {throw new ProjectStoreError("not-found", `external analysis output ${id} was not found`);}
  return recordFromRow(row);
}

function contentHash(handle: ProjectHandle, artifactVersionId: string): string | null {
  const artifact = inspectArtifactVersion(handle, artifactVersionId);
  return artifact.contentStatus === "available" ? artifact.contentHash : null;
}

export function importExternalAnalysisOutput(handle: ProjectHandle, capability: unknown, request: ExternalAnalysisOutputRequest): ExternalAnalysisOutputRecord {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const inputVersionIds = assertVersionIds(handle, request.inputVersionIds);
  const suppliedArtifact = request.artifactVersionId ?? request.outputVersionId;
  const commandId = request.commandId ?? newId("external-analysis-import-command");
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({
    artifactVersionId: suppliedArtifact ?? null,
    contentHash: suppliedArtifact === undefined && request.content !== undefined ? hashPayload(request.content) : null,
    inputVersionIds,
    argvDigest: request.argvDigest ?? null,
    commandOrScriptVersion: request.commandOrScriptVersion ?? null,
    parameters: request.parameters ?? {},
    source: request.source ?? null,
    notes: request.notes ?? null
  });
  const existingId = operationResult(handle, commandId, "external-analysis-import", payloadHash);
  if (existingId) {return outputRow(handle, existingId);}
  let artifactVersionId = suppliedArtifact;
  const id = newId("external-analysis-output");
  if (artifactVersionId !== undefined) {
    assertId(artifactVersionId, "artifactVersionId");
    getArtifactVersion(handle, artifactVersionId);
  } else {
    if (request.content === undefined) {
      throw new ProjectStoreError("invalid-argument", "external output requires an artifactVersionId or content");
    }
    artifactVersionId = registerArtifactVersion(handle, {
      logicalId: request.logicalId ?? `external-analysis-${id}`,
      version: request.version ?? "1",
      content: request.content,
      origin: "analysis-external-output",
      access: "metadata-only",
      dependencies: inputVersionIds.map((versionId) => ({ versionId, relation: "analysis-input" }))
    }).id;
  }
  const outputId = id;
  const createdAt = now();
  handle.db.prepare(`
    INSERT INTO external_analysis_outputs (id, artifact_version_id, input_version_ids, argv_digest, command_or_script_version, parameters, authenticity, reproduced, source, notes, command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'reported', 0, ?, ?, ?, ?, ?)
  `).run(outputId, artifactVersionId, JSON.stringify(inputVersionIds), request.argvDigest ?? null, request.commandOrScriptVersion ?? null, JSON.stringify(request.parameters ?? {}), request.source ?? null, request.notes ?? null, commandId, createdAt, createdAt);
  recordOperation(handle, commandId, "external-analysis-import", payloadHash, outputId, createdAt);
  return outputRow(handle, outputId);
}

export function inspectExternalAnalysisOutputs(handle: ProjectHandle, capability: unknown, query: ExternalAnalysisOutputQuery = {}): readonly ExternalAnalysisOutputRecord[] {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertInspectionAccess(handle, capability);
  const rows = query.id === undefined
    ? handle.db.prepare("SELECT * FROM external_analysis_outputs ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM external_analysis_outputs WHERE id = ?").all(query.id);
  const worker = isWorkerCapability(capability);
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const record = recordFromRow(row);
    if (!worker) {
      return record;
    }
    return {
      ...record,
      parameters: { redacted: true },
      ...(record.source !== undefined ? { source: "[REDACTED]" } : {}),
      ...(record.notes !== undefined ? { notes: "[REDACTED]" } : {})
    };
  });
}

export function reproduceAnalysisRun(handle: ProjectHandle, capability: unknown, request: ReproduceAnalysisRunRequest) {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const externalOutputId = assertId(request.externalOutputId, "externalOutputId");
  const external = outputRow(handle, externalOutputId);
  const authenticatedRunId = request.authenticatedRunId ?? request.runId;
  if (authenticatedRunId === undefined) {throw new ProjectStoreError("invalid-argument", "authenticatedRunId is required");}
  const authenticatedRun = inspectAnalysisRuns(handle, capability, { id: assertId(authenticatedRunId, "authenticatedRunId") })[0];
  if (!authenticatedRun) {throw new ProjectStoreError("not-found", `authenticated analysis run ${authenticatedRunId} was not found`);}
  if (external.argvDigest !== undefined && external.argvDigest !== authenticatedRun.argvDigest) {
    throw new ProjectStoreError("reproduction-mismatch", "external output argv digest does not match the authenticated run");
  }
  if (external.commandOrScriptVersion !== undefined && external.commandOrScriptVersion !== authenticatedRun.commandOrScriptVersion) {
    throw new ProjectStoreError("reproduction-mismatch", "external output command or script version does not match the authenticated run");
  }
  const externalInputs = JSON.stringify([...external.inputVersionIds]);
  if (externalInputs !== JSON.stringify([...authenticatedRun.inputVersionIds])) {
    throw new ProjectStoreError("reproduction-mismatch", "external output inputs do not match the authenticated run");
  }
  if (hashPayload(external.parameters) !== hashPayload(authenticatedRun.parameters)) {
    throw new ProjectStoreError("reproduction-mismatch", "external output parameters do not match the authenticated run");
  }
  if (external.argvDigest === undefined && external.commandOrScriptVersion === undefined) {
    throw new ProjectStoreError("reproduction-identity-missing", "external output has no reproducible command or script identity");
  }
  const requestedArgv = request.argv ?? authenticatedRun.argv;
  if (request.argv !== undefined && hashPayload([...request.argv]) !== authenticatedRun.argvDigest) {
    throw new ProjectStoreError("reproduction-mismatch", "reproduction argv does not match the authenticated run");
  }
  const matchingConfirmation = handle.db.prepare("SELECT id FROM analysis_command_confirmations WHERE argv_digest = ? ORDER BY created_at LIMIT 1").get(authenticatedRun.argvDigest) as { id?: unknown } | undefined;
  const reproduced = runAuthorizedAnalysis(handle, capability, {
    argv: requestedArgv,
    cwd: request.cwd ?? authenticatedRun.cwd,
    runner: request.runner,
    confirmationId: typeof matchingConfirmation?.id === "string" ? matchingConfirmation.id : undefined,
    inputVersionIds: authenticatedRun.inputVersionIds,
    scriptVersionId: authenticatedRun.scriptVersionId,
    commandOrScriptVersion: authenticatedRun.commandOrScriptVersion,
    parameters: authenticatedRun.parameters,
    environment: authenticatedRun.environment,
    diagnostics: authenticatedRun.diagnostics,
    analysisPlanId: authenticatedRun.analysisPlanId,
    protocolVersionId: authenticatedRun.protocolVersionId,
    activity: authenticatedRun.activity,
    population: authenticatedRun.population,
    dataClasses: authenticatedRun.dataClasses,
    dataUse: authenticatedRun.dataUse,
    profileId: authenticatedRun.profileId,
    confirmatoryOrExploratory: authenticatedRun.confirmatoryOrExploratory,
    externalOutputId,
    commandId: request.commandId,
    attribution: "human-stated",
    origin: "owner-recorded"
  });
  if (reproduced.status !== "succeeded") {
    return reproduced;
  }
  const importedHash = contentHash(handle, external.artifactVersionId);
  const reproducedHash = reproduced.stdoutArtifactId === undefined ? null : contentHash(handle, reproduced.stdoutArtifactId);
  if (importedHash === null || reproducedHash === null) {
    throw new ProjectStoreError("reproduction-mismatch", "authenticated run output cannot be compared because content evidence is unavailable");
  }
  if (importedHash !== reproducedHash) {
    throw new ProjectStoreError("reproduction-mismatch", "authenticated run output does not match imported external output");
  }
  handle.db.prepare("UPDATE analysis_runs SET reproduced = 1, updated_at = ? WHERE id = ?").run(now(), reproduced.id);
  return inspectAnalysisRuns(handle, capability, { id: reproduced.id })[0];
}
