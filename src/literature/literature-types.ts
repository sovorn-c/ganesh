import type { ProjectHandle } from "../project/project-types.js";

export type LiteratureOrigin = "owner-recorded" | "specialist-proposed";
export type LiteratureOperationStatus = "pending" | "complete" | "failed";

export interface LiteratureOperation {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly status: LiteratureOperationStatus;
  readonly resultId?: string;
  readonly resultKind?: string;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ReviewProtocol {
  readonly id: string;
  readonly versionLabel: string;
  readonly artifactVersionId: string;
  readonly eligibility: Record<string, unknown>;
  readonly scope: Record<string, unknown>;
  readonly origin: LiteratureOrigin;
  readonly createdAt: string;
}

export interface ReviewProtocolRequest {
  readonly commandId: string;
  readonly id?: string;
  readonly versionLabel?: string;
  readonly eligibility: Record<string, unknown>;
  readonly scope?: Record<string, unknown>;
  readonly origin?: LiteratureOrigin;
  readonly candidate?: unknown;
}

export interface QueryVersion {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly versionLabel: string;
  readonly expression: string;
  readonly destination: string;
  readonly purpose: string;
  readonly parentQueryVersionId?: string;
  readonly supersedesQueryVersionId?: string;
  readonly artifactVersionId: string;
  readonly origin: LiteratureOrigin;
  readonly createdAt: string;
}

export interface QueryVersionRequest {
  readonly commandId: string;
  readonly id?: string;
  readonly protocolVersionId: string;
  readonly versionLabel?: string;
  readonly expression: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly parentQueryVersionId?: string;
  readonly supersedesQueryVersionId?: string;
  readonly origin?: LiteratureOrigin;
  readonly candidate?: unknown;
}

export interface LandscapeMap {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly queryVersionIds: readonly string[];
  readonly description: string;
  readonly searchedAt: string;
  readonly origin: LiteratureOrigin;
  readonly createdAt: string;
}

export interface LandscapeMapRequest {
  readonly commandId: string;
  readonly id?: string;
  readonly protocolVersionId: string;
  readonly queryVersionIds: readonly string[];
  readonly description: string;
  readonly searchedAt?: string;
  readonly origin?: LiteratureOrigin;
}

export interface CorpusRecord {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly sourceVersionId?: string;
  readonly bibliographicIdentity: Record<string, unknown>;
  readonly origin: LiteratureOrigin | "retrieval";
  readonly createdAt: string;
}

export interface CorpusIdentityRequest {
  readonly commandId: string;
  readonly id?: string;
  readonly protocolVersionId: string;
  readonly sourceVersionId?: string;
  readonly bibliographicIdentity: Record<string, unknown>;
}

export interface CoverageLimit {
  readonly kind: string;
  readonly reason: string;
  readonly criterionVersionId?: string;
  readonly queryVersionId?: string;
  readonly sourceId?: string;
}

export interface RetrievalHit {
  readonly corpusRecordId?: string;
  readonly sourceVersionId?: string;
  readonly bibliographicIdentity?: Record<string, unknown>;
  readonly evidenceItemId?: string;
}

export interface RetrievalReport {
  readonly hits?: readonly RetrievalHit[];
  readonly coverageLimits?: readonly CoverageLimit[];
  readonly providerCaps?: readonly CoverageLimit[];
  readonly failedPages?: readonly CoverageLimit[];
  readonly inaccessibleSources?: readonly CoverageLimit[];
  readonly status?: "complete" | "failed";
  readonly errorCode?: string;
}

export interface LiteratureRetrievalAdapter {
  retrieve(request: { readonly query: QueryVersion; readonly protocol: ReviewProtocol }): RetrievalReport | Promise<RetrievalReport>;
}

export interface SearchEvent {
  readonly id: string;
  readonly protocolVersionId: string;
  readonly queryVersionId: string;
  readonly searchedAt: string;
  readonly destination: string;
  readonly purpose: string;
  readonly status: "complete" | "failed";
  readonly liveRerunOf?: string;
  readonly coverageLimits: readonly CoverageLimit[];
  readonly adapterCode?: string;
  readonly createdAt: string;
}

export interface CorpusSnapshot {
  readonly id: string;
  readonly searchEventId: string;
  readonly corpusRecordIds: readonly string[];
  readonly createdAt: string;
}

export interface RetrievalRequest {
  readonly commandId: string;
  readonly queryVersionId: string;
  readonly adapter?: LiteratureRetrievalAdapter;
  readonly searchedAt?: string;
  readonly liveRerunOfSearchEventId?: string;
}

export interface CitationExplorationRequest {
  readonly commandId: string;
  readonly protocolVersionId: string;
  readonly corpusRecordIds?: readonly string[];
  readonly sourceVersionIds?: readonly string[];
  readonly maxHops?: number;
  readonly maxRecords?: number;
  readonly edges?: readonly { readonly fromRecordId: string; readonly toRecordId: string; readonly relation?: "cites" | "cited-by" }[];
}

export interface CitationEdge {
  readonly id: string;
  readonly fromRecordId: string;
  readonly toRecordId: string;
  readonly relation: "cites" | "cited-by";
  readonly createdAt: string;
}

export type ScreeningDecisionKind = "include" | "exclude" | "uncertain";

export interface ScreeningDecision {
  readonly id: string;
  readonly corpusRecordId: string;
  readonly protocolVersionId: string;
  readonly criterionId: string;
  readonly decision: ScreeningDecisionKind;
  readonly reason: string;
  readonly supersededByDecisionId?: string;
  readonly createdAt: string;
}

export interface ScreeningDecisionRequest {
  readonly commandId: string;
  readonly corpusRecordId: string;
  readonly protocolVersionId: string;
  readonly criterionId: string;
  readonly decision: ScreeningDecisionKind;
  readonly reason: string;
  readonly saturated?: boolean;
  readonly paperCount?: number;
  readonly stopRule?: string;
}

export interface EligibilityAmendment {
  readonly id: string;
  readonly fromProtocolVersionId: string;
  readonly toProtocolVersionId: string;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface EligibilityAmendmentRequest {
  readonly commandId: string;
  readonly fromProtocolVersionId: string;
  readonly eligibility: Record<string, unknown>;
  readonly scope?: Record<string, unknown>;
  readonly rationale: string;
  readonly versionLabel?: string;
}

export interface UncertaintyQueueEntry {
  readonly id: string;
  readonly decisionId: string;
  readonly corpusRecordId: string;
  readonly status: "open" | "resolved";
  readonly resolvedByDecisionId?: string;
  readonly createdAt: string;
}
export interface ScreeningCounts {
  readonly included: number;
  readonly excluded: number;
  readonly uncertain: number;
}

export interface GapAssessment {
  readonly id: string;
  readonly snapshotId: string;
  readonly queryVersionIds: readonly string[];
  readonly searchedAt: string;
  readonly proposition: string;
  readonly status: "proposed" | "revised" | "rejected" | "narrowed";
  readonly qualifications: readonly string[];
  readonly origin: LiteratureOrigin;
  readonly createdAt: string;
}

export interface GapAssessmentRequest {
  readonly commandId: string;
  readonly snapshotId: string;
  readonly queryVersionIds: readonly string[];
  readonly searchedAt?: string;
  readonly proposition: string;
  readonly status?: GapAssessment["status"];
  readonly qualifications?: readonly string[];
  readonly origin?: LiteratureOrigin;
}

export interface ContributionProposal {
  readonly id: string;
  readonly gapId: string;
  readonly proposition: string;
  readonly qualifications: readonly string[];
  readonly origin: LiteratureOrigin;
  readonly createdAt: string;
}

export interface ContributionProposalRequest {
  readonly commandId: string;
  readonly gapId: string;
  readonly proposition: string;
  readonly qualifications: readonly string[];
  readonly origin?: LiteratureOrigin;
}
export interface CounterSearchRequest {
  readonly commandId: string;
  readonly gapId: string;
  readonly queryVersionId: string;
  readonly adapter?: LiteratureRetrievalAdapter;
  readonly searchedAt?: string;
  readonly contraryHits?: readonly RetrievalHit[];
}
export interface CounterSearchResult {
  readonly id: string;
  readonly gap: GapAssessment;
  readonly searchEvent: SearchEvent;
  readonly snapshot: CorpusSnapshot;
  readonly contraryCorpusRecordIds: readonly string[];
  readonly challengingEvidenceItemIds: readonly string[];
}
export interface GapInspection {
  readonly gap: GapAssessment;
  readonly snapshot: CorpusSnapshot;
  readonly contraryCorpusRecords: readonly CorpusRecord[];
  readonly challengingEvidenceItemIds: readonly string[];
}
export interface SpecialistCandidateRequest {
  readonly commandId: string;
  readonly candidate: unknown;
}
export type LiteratureProject = ProjectHandle;
