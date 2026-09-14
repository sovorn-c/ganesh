// story: e09s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  allowedMethodology
} from "./methodology-utils.js";
import type {
  DesignComparisonRecord,
  DesignOption,
  SamplingPlanRecord,
  InstrumentRecord,
  PilotPlanRecord,
  StudyDesignInspection
} from "./methodology-types.js";

export { recordDesignComparison, updateDesignComparison } from "./design-comparison-store.js";
export { recordSamplingPlan, recordInstrument, recordPilotPlan } from "./design-operationalization-store.js";

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
       FROM sampling_plans WHERE comparison_id = ? ORDER BY created_at ASC, rowid ASC`
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
       FROM instruments WHERE comparison_id = ? ORDER BY created_at ASC, rowid ASC`
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
       FROM pilot_plans WHERE comparison_id = ? ORDER BY created_at ASC, rowid ASC`
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
