// story: e09s05
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  allowedMethodology,
  newId,
  isoNow
} from "./methodology-utils.js";
import type {
  AlignmentAuditRecord,
  AlignmentAuditRequest,
  AlignmentChainLink,
  AlignmentAuditStatus,
  AnalysisPlanRecord,
  AnalysisPlanRequest,
  AnalysisPlanStatus,
  AlignmentInspection
} from "./alignment-types.js";

export function recordAlignmentAudit(
  handle: ProjectHandle,
  capability: unknown,
  request: AlignmentAuditRequest
): AlignmentAuditRecord {
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:audit");

  const comp = handle.db
    .prepare(`SELECT id FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string } | undefined;

  if (!comp) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  if (!Array.isArray(request.rqVersionIds) || request.rqVersionIds.length === 0) {
    throw new ProjectStoreError("invalid-argument", "At least one RQ version ID is required");
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

export function recordAnalysisPlan(
  handle: ProjectHandle,
  capability: unknown,
  request: AnalysisPlanRequest
): AnalysisPlanRecord {
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:audit");

  const comp = handle.db
    .prepare(`SELECT id FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string } | undefined;

  if (!comp) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
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

export function inspectAlignment(
  handle: ProjectHandle,
  capability: unknown,
  comparisonId: string
): AlignmentInspection {
  assertMethodologySchema(handle.db);
  if (
    !allowedMethodology(handle, capability, "methodology:audit") &&
    !allowedMethodology(handle, capability, "methodology:inspect")
  ) {
    assertMethodologyAccess(handle, capability, "methodology:inspect");
  }

  const auditRow = handle.db
    .prepare(
      `SELECT id, comparison_id, rq_version_ids, chain_links, status, issues, created_at, updated_at
       FROM alignment_audits WHERE comparison_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(comparisonId) as
    | {
        id: string;
        comparison_id: string;
        rq_version_ids: string;
        chain_links: string;
        status: string;
        issues: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  const planRow = handle.db
    .prepare(
      `SELECT id, comparison_id, profile_id, rq_version_ids, confirmatory_or_exploratory, assumptions, uncertainty, escalation, escalation_reason, status, created_at, updated_at
       FROM analysis_plans WHERE comparison_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(comparisonId) as
    | {
        id: string;
        comparison_id: string;
        profile_id: string;
        rq_version_ids: string;
        confirmatory_or_exploratory: string;
        assumptions: string;
        uncertainty: string;
        escalation: string;
        escalation_reason: string | null;
        status: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  // Check RQ supersession (AC-07)
  const referencedRqIds = new Set<string>();
  if (auditRow) {
    const ids = JSON.parse(auditRow.rq_version_ids) as string[];
    ids.forEach((id) => referencedRqIds.add(id));
  }
  if (planRow) {
    const ids = JSON.parse(planRow.rq_version_ids) as string[];
    ids.forEach((id) => referencedRqIds.add(id));
  }

  let needsReview = false;
  for (const rqId of referencedRqIds) {
    const rq = handle.db
      .prepare(`SELECT status, superseded_by FROM research_questions WHERE id = ?`)
      .get(rqId) as { status: string; superseded_by: string | null } | undefined;
    if (rq && (rq.status === "superseded" || rq.superseded_by !== null)) {
      needsReview = true;
      break;
    }
  }

  let audit: AlignmentAuditRecord | undefined;
  if (auditRow) {
    audit = {
      id: auditRow.id,
      comparisonId: auditRow.comparison_id,
      rqVersionIds: JSON.parse(auditRow.rq_version_ids) as string[],
      chainLinks: JSON.parse(auditRow.chain_links) as AlignmentChainLink[],
      status: (needsReview ? "needs-review" : auditRow.status) as AlignmentAuditStatus,
      issues: JSON.parse(auditRow.issues) as string[],
      createdAt: auditRow.created_at,
      updatedAt: auditRow.updated_at
    };
  }

  let analysisPlan: AnalysisPlanRecord | undefined;
  if (planRow) {
    analysisPlan = {
      id: planRow.id,
      comparisonId: planRow.comparison_id,
      profileId: planRow.profile_id,
      rqVersionIds: JSON.parse(planRow.rq_version_ids) as string[],
      confirmatoryOrExploratory: planRow.confirmatory_or_exploratory as AnalysisPlanRecord["confirmatoryOrExploratory"],
      assumptions: JSON.parse(planRow.assumptions) as string[],
      uncertainty: JSON.parse(planRow.uncertainty) as string[],
      escalation: planRow.escalation as AnalysisPlanRecord["escalation"],
      escalationReason: planRow.escalation_reason ?? undefined,
      status: (needsReview ? "needs-review" : planRow.status) as AnalysisPlanStatus,
      createdAt: planRow.created_at,
      updatedAt: planRow.updated_at
    };
  }

  const overallStatus: AlignmentAuditStatus = needsReview
    ? "needs-review"
    : audit
    ? audit.status
    : "aligned";

  const allIssues = audit ? [...audit.issues] : [];
  if (needsReview) {
    allIssues.push("Referenced research question has been superseded by a newer version; alignment and plan require review.");
  }

  return {
    comparisonId,
    audit,
    analysisPlan,
    status: overallStatus,
    issues: allIssues,
    needsReview
  };
}
