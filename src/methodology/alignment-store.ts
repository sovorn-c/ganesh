// story: e09s05
import type { ProjectHandle } from "../project/project-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  allowedMethodology
} from "./methodology-utils.js";
import type {
  AlignmentAuditRecord,
  AlignmentChainLink,
  AlignmentAuditStatus,
  AnalysisPlanRecord,
  AnalysisPlanStatus,
  AlignmentInspection
} from "./alignment-types.js";

export { recordAlignmentAudit } from "./alignment-audit-store.js";
export { recordAnalysisPlan } from "./analysis-plan-store.js";

export function inspectAlignment(
  handle: ProjectHandle,
  capability: unknown,
  comparisonId: string
): AlignmentInspection {
  handle.assertCurrent();
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
       FROM alignment_audits WHERE comparison_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
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
       FROM analysis_plans WHERE comparison_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1`
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
