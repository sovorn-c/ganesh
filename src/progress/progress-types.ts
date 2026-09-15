import type { ResearchActivity } from "../ethics/ethics-types.js";
import type { MethodologyOrigin, ViewAttribution } from "../methodology/methodology-types.js";

export type ProgressOrigin = MethodologyOrigin;
export type ProtocolVersionStatus = "candidate" | "in-force" | "superseded";

export interface ProtocolVersionRequest {
  readonly versionLabel?: string;
  readonly version?: string;
  readonly procedureText: string;
  readonly rqVersionIds?: readonly string[];
  readonly designComparisonId?: string;
  readonly samplingPlanId?: string;
  readonly analysisPlanId?: string;
  readonly riskRegisterItemIds?: readonly string[];
  readonly authorizationId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataUse?: string;
  readonly attribution?: ViewAttribution;
  readonly origin?: ProgressOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface ProtocolVersionRecord {
  readonly id: string;
  readonly versionLabel: string;
  readonly procedureText: string;
  readonly rqVersionIds: readonly string[];
  readonly designComparisonId?: string;
  readonly samplingPlanId?: string;
  readonly analysisPlanId?: string;
  readonly riskRegisterItemIds: readonly string[];
  readonly authorizationId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataUse?: string;
  readonly attribution: ViewAttribution;
  readonly origin: ProgressOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId: string;
  readonly status: ProtocolVersionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ProtocolVersionQuery {
  readonly id?: string;
  readonly branchId?: string;
  readonly status?: ProtocolVersionStatus;
}

export interface BindProtocolInForceRequest {
  readonly protocolVersionId: string;
  readonly commitmentId?: string;
  readonly branchId?: string;
  readonly commandId?: string;
}

export interface ProgressRecordRequest {
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly occurredOn?: string;
  readonly activity?: ResearchActivity;
  readonly attribution?: ViewAttribution;
  readonly origin?: ProgressOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface ProgressRecord {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly occurredOn?: string;
  readonly activity?: ResearchActivity;
  readonly attribution: ViewAttribution;
  readonly origin: ProgressOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId: string;
  readonly retrospective: boolean;
  readonly correctsProgressId?: string;
  readonly createdAt: string;
}

export interface ProgressQuery {
  readonly id?: string;
  readonly protocolVersionId?: string;
  readonly branchId?: string;
  readonly includeRetrospective?: boolean;
}

export interface ReportedExecutionRequest {
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly evidenceVersionIds?: readonly string[];
  readonly reproduced?: boolean;
  readonly attribution?: ViewAttribution;
  readonly origin?: ProgressOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface ReportedExecutionRecord {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly evidenceVersionIds: readonly string[];
  readonly reproduced: false;
  readonly attribution: ViewAttribution;
  readonly origin: ProgressOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId: string;
  readonly createdAt: string;
}

export interface ProgressCandidateRequest {
  readonly kind: "protocol" | "progress" | "reported-execution" | "reported-prior-commitment" | "amendment" | "deviation";
  readonly payload: Record<string, unknown>;
  readonly specialistRole?: string;
  readonly commandId?: string;
}

export interface ProgressCandidateRecord {
  readonly id: string;
  readonly kind: ProgressCandidateRequest["kind"];
  readonly payload: Record<string, unknown>;
  readonly specialistRole: string;
  readonly attribution: "agent-inferred";
  readonly origin: "specialist-proposed";
  readonly status: "proposed";
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ProgressCorrectionRequest {
  readonly progressId: string;
  readonly summary: string;
  readonly occurredOn?: string;
  readonly attribution?: ViewAttribution;
  readonly origin?: ProgressOrigin;
  readonly commandId?: string;
}
