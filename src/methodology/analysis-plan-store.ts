// story: e09s05
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  newId,
  isoNow,
  validateRqVersionIds
} from "./methodology-utils.js";
import type {
  AnalysisPlanRecord,
  AnalysisPlanRequest,
  AnalysisPlanStatus
} from "./alignment-types.js";

export function recordAnalysisPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: AnalysisPlanRequest
): AnalysisPlanRecord {
  assertWritable(handle);
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:audit");

  const comp = handle.db
    .prepare(`SELECT id, rq_ids FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string; rq_ids: string } | undefined;

  if (!comp) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  if (!Array.isArray(request.rqVersionIds) || request.rqVersionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "At least one RQ version ID is required");
  }

  const compRqIds = JSON.parse(comp.rq_ids) as string[];
  const compOrientationId = validateRqVersionIds(handle.db, compRqIds);
  const planOrientationId = validateRqVersionIds(handle.db, request.rqVersionIds);
  if (compOrientationId !== planOrientationId) {
    throw new ProjectStoreError("invalid-argument", "research question orientation does not match design comparison");
  }

  if (request.escalation === "none" && (!request.escalationReason || !request.escalationReason.trim())) {
    throw new ProjectStoreError("invalid-argument", "Escalation 'none' requires a stored reason");
  }

  const id = newId("anp");
  const now = isoNow();
  const status: AnalysisPlanStatus = "current";

  handle.db
    .prepare(
      `INSERT INTO analysis_plans (id, comparison_id, profile_id, rq_version_ids, confirmatory_or_exploratory, assumptions, uncertainty, escalation, escalation_reason, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      request.comparisonId,
      request.profileId,
      JSON.stringify(request.rqVersionIds),
      request.confirmatoryOrExploratory,
      JSON.stringify(request.assumptions),
      JSON.stringify(request.uncertainty),
      request.escalation,
      request.escalationReason ?? null,
      status,
      now,
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    profileId: request.profileId,
    rqVersionIds: [...request.rqVersionIds],
    confirmatoryOrExploratory: request.confirmatoryOrExploratory,
    assumptions: [...request.assumptions],
    uncertainty: [...request.uncertainty],
    escalation: request.escalation,
    escalationReason: request.escalationReason,
    status,
    createdAt: now,
    updatedAt: now
  };
}
