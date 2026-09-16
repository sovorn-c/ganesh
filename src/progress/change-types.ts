import type { ResearchActivity } from "../ethics/ethics-types.js";
import type { MethodologyOrigin, ViewAttribution } from "../methodology/methodology-types.js";

export type AmendmentStatus = "proposed" | "adopted" | "superseded";
export type DeviationStatus = "recorded";
export type ProtocolCurrencyStatus = "current" | "superseded" | "needs-review";

export interface AmendmentRequest {
  readonly fromProtocolVersionId: string;
  readonly changeSummary: string;
  readonly procedureText?: string;
  readonly versionLabel?: string;
  readonly successorVersionLabel?: string;
  readonly rqVersionIds?: readonly string[];
  readonly designComparisonId?: string;
  readonly samplingPlanId?: string;
  readonly analysisPlanId?: string;
  readonly riskRegisterItemIds?: readonly string[];
  readonly authorizationId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataUse?: string;
  readonly populationChanged?: boolean;
  readonly dataUseChanged?: boolean;
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface AmendmentRecord {
  readonly id: string;
  readonly fromProtocolVersionId: string;
  readonly successorProtocolVersionId: string;
  readonly changeSummary: string;
  readonly populationChanged: boolean;
  readonly dataUseChanged: boolean;
  readonly activity?: ResearchActivity;
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly commandId: string;
  readonly branchId: string;
  readonly status: AmendmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AmendmentQuery {
  readonly id?: string;
  readonly fromProtocolVersionId?: string;
  readonly branchId?: string;
  readonly status?: AmendmentStatus;
}

export interface DeviationRequest {
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly occurredOn?: string;
  readonly populationChanged?: boolean;
  readonly dataUseChanged?: boolean;
  readonly population?: string;
  readonly dataUse?: string;
  readonly activity?: ResearchActivity;
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface DeviationRecord {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly summary: string;
  readonly occurredOn?: string;
  readonly populationChanged: boolean;
  readonly dataUseChanged: boolean;
  readonly population?: string;
  readonly dataUse?: string;
  readonly activity?: ResearchActivity;
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly commandId: string;
  readonly branchId: string;
  readonly status: DeviationStatus;
  readonly createdAt: string;
}

export interface AmendmentQueryResult {
  readonly id?: string;
  readonly protocolVersionId?: string;
  readonly branchId?: string;
  readonly population?: string;
  readonly dataUse?: string;
  readonly activity?: ResearchActivity;
}

export interface ProtocolCurrencyAssessment {
  readonly protocolVersionId: string;
  readonly status: ProtocolCurrencyStatus;
  readonly materialChange: boolean;
  readonly contextMatches: boolean;
  readonly requiredPopulation?: string;
  readonly requiredDataUse?: string;
  readonly requiredActivity?: ResearchActivity;
  readonly reason: string;
}
