// story: e13s01, e13s02, e13s03, e13s04

export type FindingKind = "positive" | "negative" | "inconclusive" | "insufficient-evidence";
export type AssertionRole = "supports" | "qualifies" | "challenges";
export type DraftAttribution = "human-stated" | "agent-inferred" | "unknown";
export type DraftOrigin = "owner-recorded" | "specialist-proposed";
export type DraftStatus = "candidate";

export interface RecordDraftRequest {
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly findingKind?: FindingKind;
  readonly nextAction?: string;
  readonly attribution?: DraftAttribution;
  readonly commandId: string;
  readonly branchId?: string;
  readonly priorDraftId?: string;
  readonly versionNumber?: number;
}

export interface DraftRecord {
  readonly id: string;
  readonly title: string;
  readonly bodyMarkdown: string;
  readonly bodyHash: string;
  readonly findingKind: FindingKind;
  readonly nextAction?: string;
  readonly attribution: DraftAttribution;
  readonly origin: DraftOrigin;
  readonly artifactVersionId: string;
  readonly branchId: string;
  readonly status: DraftStatus;
  readonly versionNumber: number;
  readonly priorDraftId?: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LinkDraftAssertionRequest {
  readonly draftId: string;
  readonly claimId?: string;
  readonly evidenceItemId?: string;
  readonly analysisRunId?: string;
  readonly role: AssertionRole;
  readonly commandId: string;
}

export interface AssertionLink {
  readonly id: string;
  readonly draftId: string;
  readonly claimId?: string;
  readonly evidenceItemId?: string;
  readonly analysisRunId?: string;
  readonly role: AssertionRole;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface RecordDraftLimitationRequest {
  readonly draftId: string;
  readonly limitationText: string;
  readonly commandId: string;
}

export interface DraftLimitation {
  readonly id: string;
  readonly draftId: string;
  readonly limitationText: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface RecordAiContributionRequest {
  readonly draftId: string;
  readonly summary: string;
  readonly disclosureNeeded: boolean;
  readonly commandId: string;
}

export interface AiContributionRecord {
  readonly id: string;
  readonly draftId: string;
  readonly summary: string;
  readonly disclosureNeeded: boolean;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface CompleteWithInsufficientEvidenceRequest {
  readonly draftId: string;
  readonly nextAction: string;
  readonly commandId: string;
}

export interface IngestWritingCandidateRequest {
  readonly payload: Record<string, unknown> | string;
  readonly attribution?: DraftAttribution;
  readonly commandId: string;
}

export interface WritingCandidateRecord {
  readonly id: string;
  readonly payload: string;
  readonly attribution: DraftAttribution;
  readonly origin: "specialist-proposed";
  readonly status: "candidate";
  readonly commandId: string;
  readonly createdAt: string;
}

export interface UnsupportedCitationDetail {
  readonly claimId: string;
  readonly citationId?: string;
  readonly sourceVersionId?: string;
  readonly supportStatus: string;
  readonly accessStatus?: string;
}

export interface InspectDraftQuery {
  readonly draftId: string;
}

export interface DraftInspection {
  readonly draft: DraftRecord;
  readonly assertions: readonly AssertionLink[];
  readonly limitations: readonly DraftLimitation[];
  readonly aiContributions: readonly AiContributionRecord[];
  readonly unsupportedCitations: readonly UnsupportedCitationDetail[];
  readonly missingLinks: readonly string[];
}

// e13s02 types
export type ReviewIssueStatus = "open" | "resolved" | "deferred";

export interface RecordReviewIssueRequest {
  readonly draftId: string;
  readonly rank: number;
  readonly title: string;
  readonly description: string;
  readonly evidenceVersionId?: string;
  readonly commandId: string;
}

export interface ReviewIssue {
  readonly id: string;
  readonly draftId: string;
  readonly rank: number;
  readonly title: string;
  readonly description: string;
  readonly evidenceVersionId?: string;
  readonly status: ReviewIssueStatus;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ListReviewIssuesQuery {
  readonly draftId: string;
}

export interface RequestDraftRevisionRequest {
  readonly draftId: string;
  readonly revisedBodyMarkdown: string;
  readonly reason: string;
  readonly commandId: string;
}

// e13s03 types
export type ReviewCycleStatus = "open" | "completed" | "returned-to-owner";
export type ReviewCycleDisposition = "adopted" | "revised" | "rejected" | "returned-to-owner";

export interface OpenReviewCycleRequest {
  readonly draftId: string;
  readonly commandId: string;
}

export interface ReviewCycle {
  readonly id: string;
  readonly draftId: string;
  readonly status: ReviewCycleStatus;
  readonly revisionCount: number;
  readonly disposition?: ReviewCycleDisposition;
  readonly dispositionNotes?: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface RecordSupervisorFeedbackRequest {
  readonly cycleId: string;
  readonly draftId: string;
  readonly supervisorName: string;
  readonly supervisorRole: string;
  readonly feedbackText: string;
  readonly dissentText?: string;
  readonly artifactVersionId?: string;
  readonly commandId: string;
}

export interface SupervisorFeedback {
  readonly id: string;
  readonly cycleId: string;
  readonly draftId: string;
  readonly supervisorName: string;
  readonly supervisorRole: string;
  readonly authenticity: "reported";
  readonly feedbackText: string;
  readonly dissentText?: string;
  readonly artifactVersionId?: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface RecordOwnerCycleDispositionRequest {
  readonly cycleId: string;
  readonly disposition: ReviewCycleDisposition;
  readonly notes?: string;
  readonly commandId: string;
}

export interface ReviewCycleInspection {
  readonly cycle: ReviewCycle;
  readonly draft: DraftRecord;
  readonly feedbacks: readonly SupervisorFeedback[];
  readonly issues: readonly ReviewIssue[];
}

// e13s04 types
export interface DraftTableRequest {
  readonly draftId: string;
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly notes?: string;
  readonly commandId: string;
}

export interface DraftTable {
  readonly id: string;
  readonly draftId: string;
  readonly title: string;
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly notes?: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ExportWritingRequest {
  readonly draftId: string;
  readonly destinationPath: string;
  readonly commandId: string;
}

export interface ExportBibliographyRequest extends ExportWritingRequest {
  readonly format: "bibtex" | "ris";
}

export interface WritingExport {
  readonly id: string;
  readonly draftId: string;
  readonly format: string;
  readonly destinationPath: string;
  readonly artifactVersionId?: string;
  readonly formatLimits: readonly string[];
  readonly provenanceLimits: readonly string[];
  readonly omissions: readonly string[];
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ExportReviewPacketRequest {
  readonly draftId: string;
  readonly cycleId?: string;
  readonly destinationPath: string;
  readonly commandId: string;
}

export interface ReviewPacketExport {
  readonly id: string;
  readonly draftId: string;
  readonly cycleId?: string;
  readonly packetPath: string;
  readonly artifactVersionId?: string;
  readonly manifest: Record<string, unknown>;
  readonly omissions: readonly string[];
  readonly commandId: string;
  readonly createdAt: string;
}
