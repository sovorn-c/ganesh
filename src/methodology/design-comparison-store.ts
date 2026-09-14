// story: e09s03
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
  DesignComparisonRecord,
  DesignComparisonRequest,
  DesignOption
} from "./methodology-types.js";

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
