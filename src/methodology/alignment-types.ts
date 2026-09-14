// story: e09s05
export type ChainLinkName =
  | "question"
  | "evidence_needed"
  | "assumptions"
  | "design"
  | "sampling"
  | "analysis"
  | "claim";

export type ChainLinkStatus = "aligned" | "gap" | "mismatch" | "not-applicable";

export interface AlignmentChainLink {
  readonly link: ChainLinkName;
  readonly status: ChainLinkStatus;
  readonly description: string;
  readonly notApplicableReason?: string;
}

export type AlignmentAuditStatus = "aligned" | "gap" | "mismatch" | "needs-review";

export interface AlignmentAuditRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly rqVersionIds: readonly string[];
  readonly chainLinks: readonly AlignmentChainLink[];
  readonly status: AlignmentAuditStatus;
  readonly issues: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AlignmentAuditRequest {
  readonly comparisonId: string;
  readonly rqVersionIds: readonly string[];
  readonly chainLinks: readonly AlignmentChainLink[];
  readonly claimType?: "causal" | "associational" | "descriptive" | "exploratory";
  readonly evidenceType?: "associational" | "cross-sectional" | "experimental" | "quasi-experimental";
  readonly designLabel?: string;
  readonly identificationStrategy?: string;
  readonly issues?: readonly string[];
}

export type ConfirmatoryOrExploratory = "confirmatory" | "exploratory";
export type EscalationKind = "owner-decision" | "expert-review" | "none";
export type AnalysisPlanStatus = "current" | "needs-review" | "superseded";

export interface AnalysisPlanRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly profileId: string;
  readonly rqVersionIds: readonly string[];
  readonly confirmatoryOrExploratory: ConfirmatoryOrExploratory;
  readonly assumptions: readonly string[];
  readonly uncertainty: readonly string[];
  readonly escalation: EscalationKind;
  readonly escalationReason?: string;
  readonly status: AnalysisPlanStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisPlanRequest {
  readonly comparisonId: string;
  readonly profileId: string;
  readonly rqVersionIds: readonly string[];
  readonly confirmatoryOrExploratory: ConfirmatoryOrExploratory;
  readonly assumptions: readonly string[];
  readonly uncertainty: readonly string[];
  readonly escalation: EscalationKind;
  readonly escalationReason?: string;
}

export interface AlignmentInspection {
  readonly comparisonId: string;
  readonly audit?: AlignmentAuditRecord;
  readonly analysisPlan?: AnalysisPlanRecord;
  readonly status: AlignmentAuditStatus;
  readonly issues: readonly string[];
  readonly needsReview: boolean;
}
