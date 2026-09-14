// story: e09s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  newId,
  isoNow
} from "./methodology-utils.js";
import type {
  DesignOption,
  SamplingPlanRecord,
  SamplingPlanRequest,
  InstrumentRecord,
  InstrumentRequest,
  PilotPlanRecord,
  PilotPlanRequest
} from "./methodology-types.js";

const FORBIDDEN_RECRUITMENT_ACTIONS = new Set([
  "execute",
  "recruit",
  "contact",
  "consent",
  "collect"
]);

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
