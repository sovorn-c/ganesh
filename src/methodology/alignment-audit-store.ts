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
  AlignmentAuditRecord,
  AlignmentAuditRequest,
  AlignmentAuditStatus
} from "./alignment-types.js";

export function recordAlignmentAudit(
  handle: ProjectHandle,
  capability: unknown,
  request: AlignmentAuditRequest
): AlignmentAuditRecord {
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
  const auditOrientationId = validateRqVersionIds(handle.db, request.rqVersionIds);
  if (compOrientationId !== auditOrientationId) {
    throw new ProjectStoreError("invalid-argument", "research question orientation does not match design comparison");
  }

  if (!Array.isArray(request.chainLinks) || request.chainLinks.length === 0) {
    throw new ProjectStoreError("invalid-argument", "Chain links are required");
  }

  for (const link of request.chainLinks) {
    if (link.status === "not-applicable" && (!link.notApplicableReason || !link.notApplicableReason.trim())) {
      throw new ProjectStoreError(
        "invalid-argument",
        `Chain link '${link.link}' marked not-applicable requires a methodological reason`
      );
    }
  }

  const issues: string[] = request.issues ? [...request.issues] : [];

  // AC-12: Causal claim on associational/cross-sectional evidence requires identification.
  // Setting designLabel to "longitudinal" without identification strategy does NOT clear the mismatch.
  const isCausalClaim = request.claimType === "causal";
  const isAssociational =
    request.evidenceType === "associational" || request.evidenceType === "cross-sectional";
  const hasIdentification = Boolean(request.identificationStrategy && request.identificationStrategy.trim());

  let hasCausalMismatch = false;
  if (isCausalClaim && isAssociational && !hasIdentification) {
    hasCausalMismatch = true;
    issues.push(
      "Causal claim on associational/cross-sectional evidence requires explicit identification strategy; longitudinal design label alone does not establish causal identification."
    );
  }

  let status: AlignmentAuditStatus;
  if (hasCausalMismatch || request.chainLinks.some((l) => l.status === "mismatch")) {
    status = "mismatch";
  } else if (request.chainLinks.some((l) => l.status === "gap")) {
    status = "gap";
  } else {
    status = "aligned";
  }

  const id = newId("alg");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO alignment_audits (id, comparison_id, rq_version_ids, chain_links, status, issues, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      request.comparisonId,
      JSON.stringify(request.rqVersionIds),
      JSON.stringify(request.chainLinks),
      status,
      JSON.stringify(issues),
      now,
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    rqVersionIds: [...request.rqVersionIds],
    chainLinks: request.chainLinks.map((l) => ({ ...l })),
    status,
    issues,
    createdAt: now,
    updatedAt: now
  };
}
