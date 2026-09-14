// story: e09s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  allowedMethodology,
  newId,
  isoNow,
  validateRqVersionIds
} from "./methodology-utils.js";
import type {
  DesignComparisonRecord,
  DesignComparisonRequest,
  DesignOption,
  SamplingPlanRecord,
  SamplingPlanRequest,
  InstrumentRecord,
  InstrumentRequest,
  PilotPlanRecord,
  PilotPlanRequest,
  StudyDesignInspection
} from "./methodology-types.js";

const FORBIDDEN_RECRUITMENT_ACTIONS = new Set([
  "execute",
  "recruit",
  "contact",
  "consent",
  "collect"
]);

export function recordDesignComparison(
  handle: ProjectHandle,
  capability: unknown,
  request: DesignComparisonRequest
): DesignComparisonRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  if (!request.branchId || typeof request.branchId !== "string" || !request.branchId.trim()) {
    throw new ProjectStoreError("invalid-argument", "branchId is required");
  }
  if (!Array.isArray(request.researchQuestionIds) || request.researchQuestionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "At least one research question is required");
  }
  validateRqVersionIds(handle.db, request.researchQuestionIds);
  if (!Array.isArray(request.designs) || request.designs.length < 2) {
    throw new ProjectStoreError("invalid-argument", "At least two designs are required for comparison");
  }

  for (const d of request.designs) {
    if (!d.id || !d.name || !d.rationale || !d.fit || !d.feasibility) {
      throw new ProjectStoreError("invalid-argument", "Each design must specify id, name, rationale, fit, and feasibility");
    }
  }

  const id = newId("cmp");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO design_comparisons (id, branch_id, rq_ids, designs, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      request.branchId.trim(),
      JSON.stringify(request.researchQuestionIds),
      JSON.stringify(request.designs),
      now,
      now
    );

  return {
    id,
    branchId: request.branchId.trim(),
    researchQuestionIds: [...request.researchQuestionIds],
    designs: request.designs.map((d) => ({ ...d })),
    createdAt: now,
    updatedAt: now
  };
}

export function updateDesignComparison(
  handle: ProjectHandle,
  capability: unknown,
  comparisonId: string,
  updates: {
    readonly designs?: readonly DesignOption[];
    readonly researchQuestionIds?: readonly string[];
  }
): DesignComparisonRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  const row = handle.db
    .prepare(`SELECT id, branch_id, rq_ids, designs, created_at, updated_at FROM design_comparisons WHERE id = ?`)
    .get(comparisonId) as
    | {
        id: string;
        branch_id: string;
        rq_ids: string;
        designs: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${comparisonId}`);
  }

  let finalDesigns = JSON.parse(row.designs) as DesignOption[];
  let finalRqIds = JSON.parse(row.rq_ids) as string[];

  if (updates.designs !== undefined) {
    if (!Array.isArray(updates.designs) || updates.designs.length < 2) {
      throw new ProjectStoreError("invalid-argument", "At least two designs are required");
    }
    finalDesigns = updates.designs.map((d) => ({ ...d }));
  }

  if (updates.researchQuestionIds !== undefined) {
    if (!Array.isArray(updates.researchQuestionIds) || updates.researchQuestionIds.length === 0) {
      throw new ProjectStoreError("invalid-argument", "At least one research question is required");
    }
    validateRqVersionIds(handle.db, updates.researchQuestionIds);
    finalRqIds = [...updates.researchQuestionIds];
  }

  const now = isoNow();
  handle.db
    .prepare(`UPDATE design_comparisons SET rq_ids = ?, designs = ?, updated_at = ? WHERE id = ?`)
    .run(JSON.stringify(finalRqIds), JSON.stringify(finalDesigns), now, comparisonId);

  return {
    id: row.id,
    branchId: row.branch_id,
    researchQuestionIds: finalRqIds,
    designs: finalDesigns,
    createdAt: row.created_at,
    updatedAt: now
  };
}

export function recordSamplingPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: SamplingPlanRequest
): SamplingPlanRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  if (request.action && FORBIDDEN_RECRUITMENT_ACTIONS.has(request.action.toLowerCase().trim())) {
    throw new ProjectStoreError(
      "recruitment-not-executed",
      `Recruitment action '${request.action}' is refused; sampling plans cannot execute recruitment, contact, or consent`
    );
  }

  const comparison = handle.db
    .prepare(`SELECT id, designs FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string; designs: string } | undefined;

  if (!comparison) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  const designs = JSON.parse(comparison.designs) as DesignOption[];
  if (!designs.some((d) => d.id === request.designId)) {
    throw new ProjectStoreError("invalid-argument", `Design not found in comparison: ${request.designId}`);
  }

  const id = newId("smp");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO sampling_plans (id, comparison_id, design_id, population, access_path, recruitment_approach, non_execution_flag, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    )
    .run(
      id,
      request.comparisonId,
      request.designId,
      request.population,
      request.accessPath,
      request.recruitmentApproach,
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    designId: request.designId,
    population: request.population,
    accessPath: request.accessPath,
    recruitmentApproach: request.recruitmentApproach,
    nonExecutionFlag: true,
    createdAt: now
  };
}

export function recordInstrument(
  handle: ProjectHandle,
  capability: unknown,
  request: InstrumentRequest
): InstrumentRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  const comparison = handle.db
    .prepare(`SELECT id, designs FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string; designs: string } | undefined;

  if (!comparison) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  const designs = JSON.parse(comparison.designs) as DesignOption[];
  if (!designs.some((d) => d.id === request.designId)) {
    throw new ProjectStoreError("invalid-argument", `Design not found in comparison: ${request.designId}`);
  }

  if (request.constructIds && request.constructIds.length > 0) {
    for (const cId of request.constructIds) {
      const cRow = handle.db.prepare("SELECT id FROM constructs WHERE id = ?").get(cId);
      if (!cRow) {
        throw new ProjectStoreError("not-found", `Construct not found: ${cId}`);
      }
    }
  }

  const rightsIssue = request.rightsBasis === "unknown" || request.rightsBasis === "unverified-reuse";
  const id = newId("ins");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO instruments (id, comparison_id, design_id, name, purpose, construct_ids, rights_basis, rights_issue, validated_by_generation, fit_notes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      id,
      request.comparisonId,
      request.designId,
      request.name,
      request.purpose,
      request.constructIds ? JSON.stringify(request.constructIds) : null,
      request.rightsBasis,
      rightsIssue ? 1 : 0,
      request.fitNotes,
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    designId: request.designId,
    name: request.name,
    purpose: request.purpose,
    constructIds: request.constructIds ? [...request.constructIds] : undefined,
    rightsBasis: request.rightsBasis,
    rightsIssue,
    validatedByGeneration: false,
    fitNotes: request.fitNotes,
    createdAt: now
  };
}

export function recordPilotPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: PilotPlanRequest
): PilotPlanRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  const comparison = handle.db
    .prepare(`SELECT id, designs FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string; designs: string } | undefined;

  if (!comparison) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  const designs = JSON.parse(comparison.designs) as DesignOption[];
  if (!designs.some((d) => d.id === request.designId)) {
    throw new ProjectStoreError("invalid-argument", `Design not found in comparison: ${request.designId}`);
  }

  const id = newId("plt");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO pilot_plans (id, comparison_id, design_id, feasibility_questions, stop_conditions, completed, created_at)
       VALUES (?, ?, ?, ?, ?, 0, ?)`
    )
    .run(
      id,
      request.comparisonId,
      request.designId,
      JSON.stringify(request.feasibilityQuestions),
      JSON.stringify(request.stopConditions),
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    designId: request.designId,
    feasibilityQuestions: [...request.feasibilityQuestions],
    stopConditions: [...request.stopConditions],
    completed: false,
    createdAt: now
  };
}

export function inspectStudyDesign(
  handle: ProjectHandle,
  capability: unknown,
  comparisonId: string
): StudyDesignInspection {
  handle.assertCurrent();
  assertMethodologySchema(handle.db);
  if (
    !allowedMethodology(handle, capability, "methodology:design") &&
    !allowedMethodology(handle, capability, "methodology:inspect")
  ) {
    assertMethodologyAccess(handle, capability, "methodology:inspect");
  }

  const compRow = handle.db
    .prepare(`SELECT id, branch_id, rq_ids, designs, created_at, updated_at FROM design_comparisons WHERE id = ?`)
    .get(comparisonId) as
    | {
        id: string;
        branch_id: string;
        rq_ids: string;
        designs: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!compRow) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${comparisonId}`);
  }

  const comparison: DesignComparisonRecord = {
    id: compRow.id,
    branchId: compRow.branch_id,
    researchQuestionIds: JSON.parse(compRow.rq_ids) as string[],
    designs: JSON.parse(compRow.designs) as DesignOption[],
    createdAt: compRow.created_at,
    updatedAt: compRow.updated_at
  };

  const samplingRows = handle.db
    .prepare(
      `SELECT id, comparison_id, design_id, population, access_path, recruitment_approach, non_execution_flag, created_at
       FROM sampling_plans WHERE comparison_id = ? ORDER BY created_at ASC`
    )
    .all(comparisonId) as Array<{
    id: string;
    comparison_id: string;
    design_id: string;
    population: string;
    access_path: string;
    recruitment_approach: string;
    non_execution_flag: number;
    created_at: string;
  }>;

  const samplingPlans: SamplingPlanRecord[] = samplingRows.map((r) => ({
    id: r.id,
    comparisonId: r.comparison_id,
    designId: r.design_id,
    population: r.population,
    accessPath: r.access_path,
    recruitmentApproach: r.recruitment_approach,
    nonExecutionFlag: Boolean(r.non_execution_flag),
    createdAt: r.created_at
  }));

  const instRows = handle.db
    .prepare(
      `SELECT id, comparison_id, design_id, name, purpose, construct_ids, rights_basis, rights_issue, validated_by_generation, fit_notes, created_at
       FROM instruments WHERE comparison_id = ? ORDER BY created_at ASC`
    )
    .all(comparisonId) as Array<{
    id: string;
    comparison_id: string;
    design_id: string;
    name: string;
    purpose: string;
    construct_ids: string | null;
    rights_basis: string;
    rights_issue: number;
    validated_by_generation: number;
    fit_notes: string;
    created_at: string;
  }>;

  const instruments: InstrumentRecord[] = instRows.map((r) => ({
    id: r.id,
    comparisonId: r.comparison_id,
    designId: r.design_id,
    name: r.name,
    purpose: r.purpose,
    constructIds: r.construct_ids ? (JSON.parse(r.construct_ids) as string[]) : undefined,
    rightsBasis: r.rights_basis as InstrumentRecord["rightsBasis"],
    rightsIssue: Boolean(r.rights_issue),
    validatedByGeneration: Boolean(r.validated_by_generation),
    fitNotes: r.fit_notes,
    createdAt: r.created_at
  }));

  const pilotRows = handle.db
    .prepare(
      `SELECT id, comparison_id, design_id, feasibility_questions, stop_conditions, completed, created_at
       FROM pilot_plans WHERE comparison_id = ? ORDER BY created_at ASC`
    )
    .all(comparisonId) as Array<{
    id: string;
    comparison_id: string;
    design_id: string;
    feasibility_questions: string;
    stop_conditions: string;
    completed: number;
    created_at: string;
  }>;

  const pilotPlans: PilotPlanRecord[] = pilotRows.map((r) => ({
    id: r.id,
    comparisonId: r.comparison_id,
    designId: r.design_id,
    feasibilityQuestions: JSON.parse(r.feasibility_questions) as string[],
    stopConditions: JSON.parse(r.stop_conditions) as string[],
    completed: Boolean(r.completed),
    createdAt: r.created_at
  }));

  return {
    comparison,
    samplingPlans,
    instruments,
    pilotPlans,
    branchId: compRow.branch_id,
    fitSummary: {
      designCount: comparison.designs.length,
      hasSamplingPlan: samplingPlans.length > 0,
      hasInstruments: instruments.length > 0,
      hasPilotPlan: pilotPlans.length > 0,
      rightsIssuesCount: instruments.filter((i) => i.rightsIssue).length
    }
  };
}
