import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { addImpact } from "../branches/dependency-store.js";
import { listCommitments } from "../decisions/commitment-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type { ProtocolVersionRecord, ProtocolVersionRequest } from "./progress-types.js";
import { recordProtocolVersion } from "./protocol-store.js";
import type {
  AmendmentQuery,
  AmendmentRecord,
  AmendmentRequest,
  DeviationRecord,
  DeviationRequest,
  ProtocolCurrencyAssessment,
  ProtocolCurrencyStatus
} from "./change-types.js";
import {
  assertActivity,
  assertBranch,
  assertProgressAccess,
  assertProgressSchema,
  hashPayload,
  isoNow,
  newId,
  optionalText,
  requiredText,
  resolveAttribution,
  resolveOrigin
} from "./progress-utils.js";

function protocol(handle: ProjectHandle, id: string): ProtocolVersionRecord {
  const row = handle.db.prepare("SELECT * FROM protocol_versions WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `protocol version ${id} was not found`);
  }
  return {
    id: String(row.id), versionLabel: String(row.version_label), procedureText: String(row.procedure_text),
    rqVersionIds: JSON.parse(String(row.rq_version_ids ?? "[]")),
    designComparisonId: row.design_comparison_id ? String(row.design_comparison_id) : undefined,
    samplingPlanId: row.sampling_plan_id ? String(row.sampling_plan_id) : undefined,
    analysisPlanId: row.analysis_plan_id ? String(row.analysis_plan_id) : undefined,
    riskRegisterItemIds: JSON.parse(String(row.risk_register_item_ids ?? "[]")),
    authorizationId: row.authorization_id ? String(row.authorization_id) : undefined,
    activity: row.activity ? String(row.activity) as ProtocolVersionRecord["activity"] : undefined,
    population: row.population ? String(row.population) : undefined,
    dataUse: row.data_use ? String(row.data_use) : undefined,
    attribution: String(row.attribution) as ProtocolVersionRecord["attribution"],
    origin: String(row.origin) as ProtocolVersionRecord["origin"],
    artifactVersionId: String(row.artifact_version_id), commandId: String(row.command_id),
    branchId: String(row.branch_id), status: String(row.status) as ProtocolVersionRecord["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function amendmentFromRow(row: Record<string, unknown>): AmendmentRecord {
  return {
    id: String(row.id),
    fromProtocolVersionId: String(row.from_protocol_version_id),
    successorProtocolVersionId: String(row.successor_protocol_version_id),
    changeSummary: String(row.change_summary),
    populationChanged: Number(row.population_changed) === 1,
    dataUseChanged: Number(row.data_use_changed) === 1,
    activity: row.activity ? String(row.activity) as AmendmentRecord["activity"] : undefined,
    attribution: String(row.attribution) as AmendmentRecord["attribution"],
    origin: String(row.origin) as AmendmentRecord["origin"],
    commandId: String(row.command_id), branchId: String(row.branch_id),
    status: String(row.status) as AmendmentRecord["status"],
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

function deviationFromRow(row: Record<string, unknown>): DeviationRecord {
  return {
    id: String(row.id), protocolVersionId: String(row.protocol_version_id), summary: String(row.summary),
    occurredOn: row.occurred_on ? String(row.occurred_on) : undefined,
    populationChanged: Number(row.population_changed) === 1,
    dataUseChanged: Number(row.data_use_changed) === 1,
    population: row.new_population ? String(row.new_population) : undefined,
    dataUse: row.new_data_use ? String(row.new_data_use) : undefined,
    activity: row.activity ? String(row.activity) as DeviationRecord["activity"] : undefined,
    attribution: String(row.attribution) as DeviationRecord["attribution"],
    origin: String(row.origin) as DeviationRecord["origin"],
    commandId: String(row.command_id), branchId: String(row.branch_id), status: "recorded",
    createdAt: String(row.created_at)
  };
}

function operationEntity(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string): { readonly id: string; readonly status: string } | undefined {
  const row = handle.db.prepare("SELECT kind, payload_hash, entity_id, status FROM progress_operations WHERE command_id = ?").get(commandId) as
    | { kind?: unknown; payload_hash?: unknown; entity_id?: unknown; status?: unknown } | undefined;
  if (!row) {return undefined;}
  if (row.kind !== kind || row.payload_hash !== payloadHash) {
    throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
  }
  return typeof row.entity_id === "string" ? { id: row.entity_id, status: String(row.status) } : undefined;
}

function insertOperation(handle: ProjectHandle, commandId: string, kind: string, payloadHash: string, entityId: string, at: string, status: "pending" | "complete"): void {
  handle.db.prepare(`
    INSERT INTO progress_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(commandId, kind, payloadHash, status, entityId, at, at);
}

function completeOperation(handle: ProjectHandle, commandId: string, at: string): void {
  handle.db.prepare("UPDATE progress_operations SET status = 'complete', updated_at = ? WHERE command_id = ?").run(at, commandId);
}

function matchingRq(row: unknown, rqIds: readonly string[]): boolean {
  try {
    const values = JSON.parse(String(row)) as unknown;
    return Array.isArray(values) && values.some((id) => rqIds.includes(String(id)));
  } catch {
    return false;
  }
}

function impactArtifact(handle: ProjectHandle, table: string, id: string, content: unknown): string {
  const row = handle.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined;
  if (typeof row?.artifact_version_id === "string") {return row.artifact_version_id;}
  const logicalId = `e12-impact-${table}-${id}`;
  const existing = handle.db.prepare("SELECT id FROM artifact_versions WHERE logical_id = ? AND version_label = '1.0'").get(logicalId) as { id?: unknown } | undefined;
  if (typeof existing?.id === "string") {return existing.id;}
  return registerArtifactVersion(handle, {
    logicalId,
    version: "1.0",
    content: JSON.stringify({ table, id, content }),
    origin: "e12-impact-reference",
    access: "metadata-only"
  }).id;
}

function writeImpacts(handle: ProjectHandle, source: ProtocolVersionRecord, branchId: string, kind: string, commandId: string): void {
  const dependentIds = new Set<string>([source.artifactVersionId]);
  for (const [table, id] of [
    ["analysis_plans", source.analysisPlanId], ["design_comparisons", source.designComparisonId],
    ["sampling_plans", source.samplingPlanId], ...source.riskRegisterItemIds.map((item) => ["risk_register_items", item] as const)
  ] as const) {
    if (id !== undefined && handle.db.prepare(`SELECT id FROM ${table} WHERE id = ?`).get(id) !== undefined) {
      dependentIds.add(impactArtifact(handle, table, id, { directProtocolReference: source.id }));
    }
  }
  const analysisPlans = handle.db.prepare("SELECT id, rq_version_ids FROM analysis_plans").all() as Array<Record<string, unknown>>;
  for (const row of analysisPlans) {
    if (matchingRq(row.rq_version_ids, source.rqVersionIds)) {dependentIds.add(impactArtifact(handle, "analysis_plans", String(row.id), row));}
  }
  const audits = handle.db.prepare("SELECT id, rq_version_ids FROM alignment_audits").all() as Array<Record<string, unknown>>;
  for (const row of audits) {
    if (matchingRq(row.rq_version_ids, source.rqVersionIds)) {dependentIds.add(impactArtifact(handle, "alignment_audits", String(row.id), row));}
  }
  const risks = handle.db.prepare("SELECT id, branch_id FROM risk_register_items").all() as Array<Record<string, unknown>>;
  for (const row of risks) {
    if (row.branch_id === null || row.branch_id === undefined || String(row.branch_id) === branchId) {dependentIds.add(impactArtifact(handle, "risk_register_items", String(row.id), row));}
  }
  const plans = handle.db.prepare("SELECT id, branch_id, activity FROM data_management_plans").all() as Array<Record<string, unknown>>;
  for (const row of plans) {
    if ((row.branch_id === null || row.branch_id === undefined || String(row.branch_id) === branchId) && (source.activity === undefined || row.activity === source.activity)) {dependentIds.add(impactArtifact(handle, "data_management_plans", String(row.id), row));}
  }
  for (const commitment of listCommitments(handle)) {
    if (commitment.branchId === branchId && commitment.selectedCandidateVersionIds.includes(source.artifactVersionId)) {
      dependentIds.add(source.artifactVersionId);
    }
  }
  for (const dependentId of dependentIds) {
    addImpact(handle, branchId, source.artifactVersionId, dependentId, kind, `${kind} requires method, ethics and analysis impact review`, commandId);
  }
}

export function recordAmendment(handle: ProjectHandle, capability: unknown, request: AmendmentRequest): AmendmentRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  assertIdentifier(request.fromProtocolVersionId, "fromProtocolVersionId");
  const prior = protocol(handle, request.fromProtocolVersionId);
  if (prior.status !== "in-force") {
    throw new ProjectStoreError("invalid-transition", "amendments must name an in-force protocol version");
  }
  const branchId = assertBranch(handle, request.branchId ?? prior.branchId);
  if (branchId !== prior.branchId) {throw new ProjectStoreError("forbidden", "amendment must use the protocol version branch");}
  const changeSummary = requiredText(request.changeSummary, "changeSummary");
  const protocolCount = handle.db.prepare("SELECT COUNT(*) AS count FROM protocol_versions").get() as { count: number };
  const versionLabel = request.versionLabel ?? request.successorVersionLabel ?? `v${protocolCount.count + 1}`;
  const population = request.population === undefined ? prior.population : optionalText(request.population, "population");
  const dataUse = request.dataUse === undefined ? prior.dataUse : optionalText(request.dataUse, "dataUse");
  const actualPopulationChanged = population !== prior.population;
  const actualDataUseChanged = dataUse !== prior.dataUse;
  if (request.populationChanged !== undefined && request.populationChanged !== actualPopulationChanged) {
    throw new ProjectStoreError("invalid-argument", "populationChanged must match the successor population change");
  }
  if (request.dataUseChanged !== undefined && request.dataUseChanged !== actualDataUseChanged) {
    throw new ProjectStoreError("invalid-argument", "dataUseChanged must match the successor data use change");
  }
  const populationChanged = request.populationChanged ?? actualPopulationChanged;
  const dataUseChanged = request.dataUseChanged ?? actualDataUseChanged;
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payload = { fromProtocolVersionId: prior.id, changeSummary, versionLabel, procedureText: request.procedureText ?? prior.procedureText, rqVersionIds: request.rqVersionIds ?? prior.rqVersionIds, designComparisonId: request.designComparisonId ?? prior.designComparisonId ?? null, samplingPlanId: request.samplingPlanId ?? prior.samplingPlanId ?? null, analysisPlanId: request.analysisPlanId ?? prior.analysisPlanId ?? null, riskRegisterItemIds: request.riskRegisterItemIds ?? prior.riskRegisterItemIds, authorizationId: request.authorizationId ?? prior.authorizationId ?? null, activity: request.activity ?? prior.activity ?? null, population: population ?? null, dataUse: dataUse ?? null, populationChanged, dataUseChanged, attribution, origin, branchId };
  const payloadHash = hashPayload(payload);
  const existingOperation = operationEntity(handle, commandId, "amendment", payloadHash);
  if (existingOperation) {
    const row = handle.db.prepare("SELECT * FROM amendments WHERE id = ?").get(existingOperation.id) as Record<string, unknown> | undefined;
    if (!row) {throw new ProjectStoreError("invalid-transition", "prior amendment operation has no amendment");}
    writeImpacts(handle, prior, branchId, "protocol-amendment", commandId);
    if (existingOperation.status !== "complete") {completeOperation(handle, commandId, isoNow());}
    return amendmentFromRow(row);
  }
  assertActivity(payload.activity ?? undefined);
  const successorRequest: ProtocolVersionRequest = {
    versionLabel,
    procedureText: payload.procedureText,
    rqVersionIds: payload.rqVersionIds,
    designComparisonId: payload.designComparisonId ?? undefined,
    samplingPlanId: payload.samplingPlanId ?? undefined,
    analysisPlanId: payload.analysisPlanId ?? undefined,
    riskRegisterItemIds: payload.riskRegisterItemIds,
    authorizationId: payload.authorizationId ?? undefined,
    activity: payload.activity ?? undefined,
    population: payload.population ?? undefined,
    dataUse: payload.dataUse ?? undefined,
    attribution,
    origin,
    branchId,
    commandId: `${commandId}-successor`
  };
  const successor = recordProtocolVersion(handle, capability, successorRequest);
  const id = newId("amendment");
  const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare(`
      INSERT INTO amendments (id, from_protocol_version_id, successor_protocol_version_id, change_summary, population_changed, data_use_changed, activity, attribution, origin, command_id, branch_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)
    `).run(id, prior.id, successor.id, changeSummary, populationChanged ? 1 : 0, dataUseChanged ? 1 : 0, payload.activity ?? null, attribution, origin, commandId, branchId, createdAt, createdAt);
    insertOperation(handle, commandId, "amendment", payloadHash, id, createdAt, "pending");
  });
  writeImpacts(handle, prior, branchId, "protocol-amendment", commandId);
  completeOperation(handle, commandId, isoNow());
  return amendmentFromRow(handle.db.prepare("SELECT * FROM amendments WHERE id = ?").get(id) as Record<string, unknown>);
}

export function inspectAmendments(handle: ProjectHandle, capability: unknown, query: AmendmentQuery = {}): readonly AmendmentRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const conditions: string[] = [];
  const params: string[] = [];
  for (const [column, value] of [["id", query.id], ["from_protocol_version_id", query.fromProtocolVersionId], ["branch_id", query.branchId], ["status", query.status]] as const) {
    if (value !== undefined) { conditions.push(`${column} = ?`); params.push(value); }
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return (handle.db.prepare(`SELECT * FROM amendments${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>).map(amendmentFromRow);
}

export function recordDeviation(handle: ProjectHandle, capability: unknown, request: DeviationRequest): DeviationRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  assertIdentifier(request.protocolVersionId, "protocolVersionId");
  const prior = protocol(handle, request.protocolVersionId);
  const branchId = assertBranch(handle, request.branchId ?? prior.branchId);
  if (branchId !== prior.branchId) {throw new ProjectStoreError("forbidden", "deviation must use the protocol version branch");}
  const summary = requiredText(request.summary, "summary");
  const occurredOn = optionalText(request.occurredOn, "occurredOn");
  assertActivity(request.activity);
  const population = optionalText(request.population, "population");
  const dataUse = optionalText(request.dataUse, "dataUse");
  const actualPopulationChanged = population !== undefined && population !== prior.population;
  const actualDataUseChanged = dataUse !== undefined && dataUse !== prior.dataUse;
  if (request.populationChanged !== undefined && request.populationChanged !== actualPopulationChanged) {
    throw new ProjectStoreError("invalid-argument", "populationChanged must match the deviation population change");
  }
  if (request.dataUseChanged !== undefined && request.dataUseChanged !== actualDataUseChanged) {
    throw new ProjectStoreError("invalid-argument", "dataUseChanged must match the deviation data use change");
  }
  const populationChanged = request.populationChanged ?? actualPopulationChanged;
  const dataUseChanged = request.dataUseChanged ?? actualDataUseChanged;
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({ protocolVersionId: prior.id, summary, occurredOn: occurredOn ?? null, populationChanged, dataUseChanged, population: population ?? null, dataUse: dataUse ?? null, activity: request.activity ?? null, attribution, origin, branchId });
  const existingOperation = operationEntity(handle, commandId, "deviation", payloadHash);
  if (existingOperation) {
    const row = handle.db.prepare("SELECT * FROM deviations WHERE id = ?").get(existingOperation.id) as Record<string, unknown> | undefined;
    if (!row) {throw new ProjectStoreError("invalid-transition", "prior deviation operation has no deviation");}
    writeImpacts(handle, prior, branchId, "protocol-deviation", commandId);
    if (existingOperation.status !== "complete") {completeOperation(handle, commandId, isoNow());}
    return deviationFromRow(row);
  }
  const id = newId("deviation");
  const createdAt = isoNow();
  const artifact = registerArtifactVersion(handle, { logicalId: `protocol-deviation-${id}`, version: "1.0", content: JSON.stringify({ protocolVersionId: prior.id, summary, occurredOn, populationChanged, dataUseChanged, population, dataUse, activity: request.activity, attribution, origin }), origin: "protocol-deviation", access: "metadata-only" });
  try {
    transaction(handle.db, () => {
      handle.db.prepare(`
        INSERT INTO deviations (id, protocol_version_id, summary, occurred_on, population_changed, data_use_changed, new_population, new_data_use, activity, attribution, origin, command_id, branch_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, prior.id, summary, occurredOn ?? null, populationChanged ? 1 : 0, dataUseChanged ? 1 : 0, population ?? null, dataUse ?? null, request.activity ?? null, attribution, origin, commandId, branchId, createdAt);
      insertOperation(handle, commandId, "deviation", payloadHash, id, createdAt, "pending");
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }
  writeImpacts(handle, prior, branchId, "protocol-deviation", commandId);
  completeOperation(handle, commandId, isoNow());
  return deviationFromRow(handle.db.prepare("SELECT * FROM deviations WHERE id = ?").get(id) as Record<string, unknown>);
}

export function inspectDeviations(handle: ProjectHandle, capability: unknown, query: { readonly id?: string; readonly protocolVersionId?: string; readonly branchId?: string } = {}): readonly DeviationRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const conditions: string[] = [];
  const params: string[] = [];
  for (const [column, value] of [["id", query.id], ["protocol_version_id", query.protocolVersionId], ["branch_id", query.branchId]] as const) {
    if (value !== undefined) { conditions.push(`${column} = ?`); params.push(value); }
  }
  const where = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
  return (handle.db.prepare(`SELECT * FROM deviations${where} ORDER BY created_at, rowid`).all(...params) as Array<Record<string, unknown>>).map(deviationFromRow);
}

export function assessProtocolCurrency(handle: ProjectHandle, capability: unknown, request: { readonly protocolVersionId: string; readonly branchId?: string; readonly population?: string; readonly dataUse?: string; readonly activity?: string }): ProtocolCurrencyAssessment {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  assertIdentifier(request.protocolVersionId, "protocolVersionId");
  const current = protocol(handle, request.protocolVersionId);
  if (request.branchId !== undefined && request.branchId !== current.branchId) {
    throw new ProjectStoreError("forbidden", "protocol currency must use the protocol version branch");
  }
  if (current.status === "superseded") {
    return { protocolVersionId: current.id, status: "superseded", materialChange: true, contextMatches: false, reason: "protocol version is superseded" };
  }
  if (current.status !== "in-force") {
    return { protocolVersionId: current.id, status: "needs-review", materialChange: true, contextMatches: false, reason: "protocol version is not in force" };
  }
  const amendments = handle.db.prepare("SELECT population_changed, data_use_changed, successor_protocol_version_id FROM amendments WHERE from_protocol_version_id = ? AND branch_id = ? ORDER BY created_at DESC").all(current.id, current.branchId) as Array<Record<string, unknown>>;
  const deviations = handle.db.prepare("SELECT population_changed, data_use_changed, new_population, new_data_use, activity FROM deviations WHERE protocol_version_id = ? AND branch_id = ? ORDER BY created_at DESC").all(current.id, current.branchId) as Array<Record<string, unknown>>;
  const materialAmendment = amendments.find((row) => {
    const successor = protocol(handle, String(row.successor_protocol_version_id));
    return Number(row.population_changed) === 1 || Number(row.data_use_changed) === 1
      || successor.population !== current.population || successor.dataUse !== current.dataUse || successor.activity !== current.activity;
  });
  const materialDeviation = deviations.find((row) => Number(row.population_changed) === 1 || Number(row.data_use_changed) === 1
    || (row.new_population !== null && String(row.new_population) !== (current.population ?? null))
    || (row.new_data_use !== null && String(row.new_data_use) !== (current.dataUse ?? null))
    || (row.activity !== null && String(row.activity) !== (current.activity ?? null)));
  const successor = materialAmendment ? protocol(handle, String(materialAmendment.successor_protocol_version_id)) : undefined;
  const requiredPopulation = successor?.population ?? (materialDeviation?.new_population ? String(materialDeviation.new_population) : undefined);
  const requiredDataUse = successor?.dataUse ?? (materialDeviation?.new_data_use ? String(materialDeviation.new_data_use) : undefined);
  const requiredActivity = successor?.activity ?? (materialDeviation?.activity ? String(materialDeviation.activity) as ProtocolCurrencyAssessment["requiredActivity"] : undefined);
  const materialChange = materialAmendment !== undefined || materialDeviation !== undefined || (successor !== undefined && successor.activity !== current.activity);
  if (!materialChange) {return { protocolVersionId: current.id, status: "current", materialChange: false, contextMatches: true, reason: "protocol version has no recorded material change" };}
  const populationChanged = Number(materialAmendment?.population_changed) === 1 || Number(materialDeviation?.population_changed) === 1;
  const dataUseChanged = Number(materialAmendment?.data_use_changed) === 1 || Number(materialDeviation?.data_use_changed) === 1;
  const contextMatches = (!populationChanged || (requiredPopulation !== undefined && request.population === requiredPopulation))
    && (!dataUseChanged || (requiredDataUse !== undefined && request.dataUse === requiredDataUse))
    && (requiredActivity === undefined || request.activity === requiredActivity);
  return { protocolVersionId: current.id, status: "needs-review", materialChange: true, contextMatches, requiredPopulation, requiredDataUse, requiredActivity, reason: contextMatches ? "material protocol change requires current external authorization" : "material protocol change is outside the named work scope" };
}
