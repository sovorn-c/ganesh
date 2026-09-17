// story: e11s04
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isWorkerCapability } from "../authority/capability-broker.js";
import { newId } from "../persistence/storage-utils.js";
import { METHOD_PROFILES, type MethodProfileId } from "../methodology/profile-types.js";
import type { AnalysisDiagnostic, AnalysisDiagnosticRecord, AnalysisDiagnosticRequest, AnalysisDiagnosticStatus, AnalysisDiagnosticQuery } from "./analysis-types.js";
import { assertAnalysisSchema, assertId, assertInspectionAccess, assertOwner, ensureWritableAnalysis, hashPayload, now, operationResult, recordOperation } from "./analysis-utils.js";

function diagnosticFromRow(row: Record<string, unknown>): AnalysisDiagnosticRecord {
  const limitations = JSON.parse(String(row.limitations ?? "[]")) as AnalysisDiagnostic[];
  return {
    id: String(row.id),
    runId: String(row.run_id),
    ...(typeof row.profile_id === "string" ? { profileId: row.profile_id } : {}),
    status: String(row.status) as AnalysisDiagnosticStatus,
    diagnostics: JSON.parse(String(row.diagnostics ?? "[]")) as AnalysisDiagnostic[],
    limitations,
    limitationCodes: limitations.map((item) => item.code),
    ...(typeof row.design_label === "string" ? { designLabel: row.design_label } : {}),
    ...(typeof row.evidence_type === "string" ? { evidenceType: row.evidence_type } : {}),
    ...(typeof row.claim_type === "string" ? { claimType: row.claim_type } : {}),
    ...(typeof row.identification_strategy === "string" ? { identificationStrategy: row.identification_strategy } : {}),
    attribution: String(row.attribution) as AnalysisDiagnosticRecord["attribution"],
    origin: String(row.origin) as AnalysisDiagnosticRecord["origin"],
    commandId: String(row.command_id),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

function latestPlanDetails(handle: ProjectHandle, runId: string): { profileId?: string; details: Record<string, unknown>; planStatus?: string; planKind?: string } {
  const run = handle.db.prepare("SELECT analysis_plan_id, profile_id, confirmatory_or_exploratory FROM analysis_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!run) {throw new ProjectStoreError("not-found", `analysis run ${runId} was not found`);}
  const profileId = typeof run.profile_id === "string" ? run.profile_id : undefined;
  if (typeof run.analysis_plan_id !== "string") {return { profileId, details: {}, planKind: typeof run.confirmatory_or_exploratory === "string" ? run.confirmatory_or_exploratory : undefined };}
  const plan = handle.db.prepare("SELECT comparison_id, profile_id, confirmatory_or_exploratory, status FROM analysis_plans WHERE id = ?").get(run.analysis_plan_id) as Record<string, unknown> | undefined;
  if (!plan) {return { profileId, details: {}, planStatus: "missing" };}
  const binding = handle.db.prepare("SELECT details FROM method_profile_bindings WHERE comparison_id = ? AND profile_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(String(plan.comparison_id), String(plan.profile_id)) as { details?: unknown } | undefined;
  let details: Record<string, unknown> = {};
  if (typeof binding?.details === "string") {
    try { details = JSON.parse(binding.details) as Record<string, unknown>; } catch { details = {}; }
  }
  return {
    profileId: typeof plan.profile_id === "string" ? plan.profile_id : profileId,
    details,
    planStatus: typeof plan.status === "string" ? plan.status : undefined,
    planKind: typeof plan.confirmatory_or_exploratory === "string" ? plan.confirmatory_or_exploratory : undefined
  };
}

function limitation(code: string, message: string, severity: AnalysisDiagnostic["severity"] = "limit"): AnalysisDiagnostic {
  return { code, message, severity };
}

function assertProfile(value: string | undefined): value is MethodProfileId {
  if (value === undefined) {return false;}
  if (!(METHOD_PROFILES as readonly string[]).includes(value)) {
    throw new ProjectStoreError("invalid-argument", `Unsupported method profile: ${value}`);
  }
  return true;
}

export function attachAnalysisDiagnostics(handle: ProjectHandle, capability: unknown, request: AnalysisDiagnosticRequest): AnalysisDiagnosticRecord {
  ensureWritableAnalysis(handle);
  assertOwner(handle, capability);
  const runId = assertId(request.runId, "runId");
  const run = handle.db.prepare("SELECT id, profile_id, analysis_plan_id FROM analysis_runs WHERE id = ?").get(runId) as Record<string, unknown> | undefined;
  if (!run) {throw new ProjectStoreError("not-found", `analysis run ${runId} was not found`);}
  const plan = latestPlanDetails(handle, runId);
  const profileId = request.profileId ?? plan.profileId;
  assertProfile(profileId);
  const details = { ...plan.details, ...(request.profileDetails ?? {}) };
  if (request.integrationRationale !== undefined) {details.integrationRationale = request.integrationRationale;}
  if (request.evaluationPlan !== undefined) {details.evaluationPlan = request.evaluationPlan;}
  const diagnostics = [...(request.diagnostics ?? [])];
  const limitations = [...(request.limitations ?? [])];
  if (!profileId) {
    limitations.push(limitation("missing-profile", "No E09 method profile was supplied; method-appropriate diagnostics are limited."));
  } else if (profileId === "quantitative") {
    diagnostics.push({ code: "quantitative-profile", message: "Quantitative run recorded; statistical inference remains dependent on its assumptions and observation structure.", severity: "info" });
    if (details.independentObservations === false) {limitations.push(limitation("dependent-observations", "Independent observations were not established; dependence or clustering must be addressed."));}
  } else if (profileId === "qualitative") {
    diagnostics.push({ code: "qualitative-profile", message: "Qualitative run recorded; interpretation remains contextual and is not statistical generalization.", severity: "info" });
    if (details.approach === "reflexive-thematic-analysis") {diagnostics.push({ code: "reflexive-thematic-analysis", message: "Reflexive thematic analysis does not require inter-coder reliability or statistical power calculations by default.", severity: "info" });}
  } else if (profileId === "mixed-methods") {
    diagnostics.push({ code: "mixed-methods-profile", message: "Mixed-methods run recorded; quantitative and qualitative components require explicit integration.", severity: "info" });
    if (typeof details.integrationRationale !== "string" || !details.integrationRationale.trim()) {limitations.push(limitation("missing-integration-rationale", "Mixed-methods analysis lacks an explicit integration rationale."));}
  } else if (profileId === "artifact-evaluation-design-science") {
    diagnostics.push({ code: "artifact-evaluation-profile", message: "Artifact evaluation run recorded; implementation alone is not an empirical contribution.", severity: "info" });
    if (typeof details.evaluationPlan !== "string" || !details.evaluationPlan.trim()) {limitations.push(limitation("missing-evaluation", "Artifact construction without an evaluation plan is an implementation, not an empirical research contribution."));}
  }

  const evidenceType = request.evidenceType;
  const claimType = request.claimType;
  const strategy = request.identificationStrategy?.trim() ?? "";
  if (claimType === "causal" && (evidenceType === "associational" || evidenceType === "cross-sectional") && !strategy) {
    limitations.push(limitation("causal-identification-mismatch", "Associational evidence cannot support an unsupported causal conclusion; a longitudinal design label alone does not establish causal identification."));
  }
  if (request.designLabel === "longitudinal" && claimType === "causal" && (evidenceType === "associational" || evidenceType === "cross-sectional") && !strategy && !limitations.some((item) => item.code === "causal-identification-mismatch")) {
    limitations.push(limitation("causal-identification-mismatch", "A longitudinal design label alone does not establish causal identification."));
  }
  if (request.confirmatoryOrExploratory === "confirmatory" && (plan.planKind !== "confirmatory" || plan.planStatus !== "current")) {
    limitations.push(limitation("confirmatory-plan-required", "Confirmatory analysis requires a current confirmatory E09 analysis plan; this execution is exploratory."));
  }
  const status: AnalysisDiagnosticStatus = limitations.some((item) => item.code === "missing-integration-rationale")
    ? "incomplete"
    : limitations.some((item) => item.code === "missing-evaluation")
      ? "implementation-not-contribution"
      : limitations.length > 0 ? "needs-review" : "recorded";
  const commandId = request.commandId ?? newId("analysis-diagnostic-command");
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({ runId, profileId: profileId ?? null, diagnostics, limitations, designLabel: request.designLabel ?? null, evidenceType: evidenceType ?? null, claimType: claimType ?? null, identificationStrategy: strategy });
  const existingId = operationResult(handle, commandId, "analysis-diagnostic", payloadHash);
  if (existingId) {return diagnosticFromRow(handle.db.prepare("SELECT * FROM analysis_diagnostics WHERE id = ?").get(existingId) as Record<string, unknown>);}
  const id = newId("analysis-diagnostic");
  const createdAt = now();
  handle.db.prepare(`
    INSERT INTO analysis_diagnostics (id, run_id, profile_id, status, diagnostics, limitations, design_label, evidence_type, claim_type, identification_strategy, attribution, origin, command_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'human-stated', 'owner-recorded', ?, ?, ?)
  `).run(id, runId, profileId ?? null, status, JSON.stringify(diagnostics), JSON.stringify(limitations), request.designLabel ?? null, evidenceType ?? null, claimType ?? null, strategy || null, commandId, createdAt, createdAt);
  recordOperation(handle, commandId, "analysis-diagnostic", payloadHash, id, createdAt);
  return diagnosticFromRow(handle.db.prepare("SELECT * FROM analysis_diagnostics WHERE id = ?").get(id) as Record<string, unknown>);
}

export function inspectAnalysisDiagnostics(handle: ProjectHandle, capability: unknown, query: AnalysisDiagnosticQuery = {}): readonly AnalysisDiagnosticRecord[] {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertInspectionAccess(handle, capability);
  const rows = query.runId === undefined
    ? handle.db.prepare("SELECT * FROM analysis_diagnostics ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM analysis_diagnostics WHERE run_id = ? ORDER BY created_at, rowid").all(query.runId);
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const diagnostic = diagnosticFromRow(row);
    if (!isWorkerCapability(capability)) {
      return diagnostic;
    }
    const redacted = { code: "redacted-analysis-detail", message: "analysis detail withheld for worker inspection", severity: "info" as const };
    return {
      ...diagnostic,
      diagnostics: diagnostic.diagnostics.length === 0 ? [] : [redacted],
      limitations: diagnostic.limitations.length === 0 ? [] : [redacted],
      limitationCodes: diagnostic.limitations.length === 0 ? [] : [redacted.code]
    };
  });
}
