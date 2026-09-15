// story: e10s01
import type { ViewAttribution } from "../methodology/methodology-types.js";
import type { ExternalAuthorizationStatus } from "../decisions/override-types.js";

export const RESEARCH_ACTIVITIES = [
  "literature-only",
  "pilot",
  "participant-recruitment",
  "participant-contact",
  "data-collection",
  "identifiable-analysis",
  "disclosure"
] as const;

export type ResearchActivity = (typeof RESEARCH_ACTIVITIES)[number];

export type EthicsOrigin = "owner-recorded" | "specialist-proposed";

export interface MethodologyRef {
  readonly samplingPlanId?: string;
  readonly designComparisonId?: string;
  readonly rqVersionId?: string;
}

export interface RiskRegisterItemRequest {
  readonly activity: ResearchActivity;
  readonly requirementText: string;
  readonly institutionOrCommunity: string;
  readonly evidenceVersionIds?: readonly string[];
  readonly methodologyRef?: MethodologyRef;
  readonly residualRisk?: string;
  readonly mitigations?: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface RiskRegisterItem {
  readonly id: string;
  readonly activity: ResearchActivity;
  readonly requirementText: string;
  readonly institutionOrCommunity: string;
  readonly evidenceVersionIds: readonly string[];
  readonly methodologyRef?: MethodologyRef;
  readonly residualRisk?: string;
  readonly mitigations: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly status: "recorded" | "superseded";
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RiskRegisterQuery {
  readonly activity?: ResearchActivity;
  readonly branchId?: string;
  readonly includeSuperseded?: boolean;
}

export interface EthicsCandidateRequest {
  readonly kind:
    | "risk-register"
    | "data-management-plan"
    | "retention-plan"
    | "guidance-citation"
    | "consultation-limit";
  readonly payload: Record<string, unknown>;
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
}

export interface EthicsCandidateRecord {
  readonly id: string;
  readonly kind: string;
  readonly payload: Record<string, unknown>;
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly status: "proposed" | "accepted" | "rejected";
  readonly commandId: string;
  readonly createdAt: string;
}

// Story 2 (e10s02) types
export type DataManagementPlanStatus =
  | "recorded"
  | "destination-not-permitted"
  | "superseded";

export interface DataManagementPlanRequest {
  readonly activity: ResearchActivity;
  readonly dataClasses: readonly string[];
  readonly intendedDestinations: readonly string[];
  readonly purposes: readonly string[];
  readonly storageLocation: string;
  readonly issues?: readonly string[];
  readonly evidenceVersionIds?: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface DataManagementPlan {
  readonly id: string;
  readonly activity: ResearchActivity;
  readonly dataClasses: readonly string[];
  readonly intendedDestinations: readonly string[];
  readonly purposes: readonly string[];
  readonly storageLocation: string;
  readonly issues: readonly string[];
  readonly evidenceVersionIds: readonly string[];
  readonly status: DataManagementPlanStatus;
  readonly deniedDestinations?: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ResearchRetentionPlanRequest {
  readonly activity: ResearchActivity;
  readonly dataClasses: readonly string[];
  readonly retainUntil: string;
  readonly destructionIntent: string;
  readonly evidenceVersionIds?: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface ResearchRetentionPlan {
  readonly id: string;
  readonly activity: ResearchActivity;
  readonly dataClasses: readonly string[];
  readonly retainUntil: string;
  readonly destructionIntent: string;
  readonly evidenceVersionIds: readonly string[];
  readonly status: "recorded" | "superseded";
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Story 3 (e10s03) types
export type GuidanceCurrency =
  | "unknown"
  | "owner-reviewed-current"
  | "superseded";

export interface GuidanceCitationRequest {
  readonly title?: string;
  readonly publisher: string;
  readonly uri: string;
  readonly retrievedAt: string;
  readonly currency?: GuidanceCurrency;
  readonly summary: string;
  readonly scopeNote?: string;
  readonly jurisdiction?: string;
  readonly topic?: string;
  readonly evidenceVersionIds?: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
}

export interface GuidanceCitation {
  readonly id: string;
  readonly title?: string;
  readonly publisher: string;
  readonly uri: string;
  readonly retrievedAt: string;
  readonly currency: GuidanceCurrency;
  readonly summary: string;
  readonly scopeNote?: string;
  readonly jurisdiction?: string;
  readonly topic?: string;
  readonly evidenceVersionIds: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ConsultationStatus = "unknown" | "partial" | "recorded-complete";

export interface ConsultationLimitRequest {
  readonly activity: ResearchActivity;
  readonly consultedParties: readonly string[];
  readonly questionsAsked: readonly string[];
  readonly claimsNotMade: readonly string[];
  readonly status?: ConsultationStatus;
  readonly notes?: string;
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
}

export interface ConsultationLimit {
  readonly id: string;
  readonly activity: ResearchActivity;
  readonly consultedParties: readonly string[];
  readonly questionsAsked: readonly string[];
  readonly claimsNotMade: readonly string[];
  readonly status: ConsultationStatus;
  readonly notes?: string;
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// Story 4 (e10s04) types
export interface ExternalAuthorizationRequest {
  readonly activities: readonly ResearchActivity[];
  readonly populationOrDataUse: Record<string, unknown> | string;
  readonly applicabilityBasis: string;
  readonly status?: ExternalAuthorizationStatus;
  readonly evidenceVersionIds?: readonly string[];
  readonly expiresAt?: string;
  readonly attribution?: ViewAttribution;
  readonly origin?: EthicsOrigin;
  readonly commandId?: string;
}

export interface ExternalAuthorizationRecord {
  readonly id: string;
  readonly activities: readonly ResearchActivity[];
  readonly populationOrDataUse: Record<string, unknown> | string;
  readonly applicabilityBasis: string;
  readonly status: ExternalAuthorizationStatus;
  readonly evidenceVersionIds: readonly string[];
  readonly expiresAt?: string;
  readonly withdrawnAt?: string;
  readonly withdrawalReason?: string;
  readonly attribution: ViewAttribution;
  readonly origin: EthicsOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ActivityAuthorizationContext {
  readonly activity: ResearchActivity;
  readonly population?: string;
  readonly dataClasses?: readonly string[];
  readonly dataUse?: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly conditions?: unknown;
}

export interface ActivityAuthorizationAssessment {
  readonly activity: ResearchActivity;
  readonly status: ExternalAuthorizationStatus | "needs-review" | "unauthorized";
  readonly authorizationId?: string;
  readonly applicabilityBasis?: string;
  readonly reason: string;
  readonly permitted: boolean;
}
