// story: e09s01
export type ViewAttribution = "human-stated" | "agent-inferred" | "unknown";
export type MethodologyOrigin = "owner-recorded" | "specialist-proposed";
export type ResearchQuestionStatus = "candidate" | "superseded";

export interface OrientationRecord {
  readonly id: string;
  readonly topic: string;
  readonly discipline: string;
  readonly immediateGoal: string;
  readonly unknowns: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface OrientationRequest {
  readonly topic: string;
  readonly discipline: string;
  readonly immediateGoal: string;
  readonly unknowns?: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly commandId?: string;
  readonly origin?: MethodologyOrigin;
}

export interface ProblemFramingRecord {
  readonly id: string;
  readonly orientationId: string;
  readonly statement: string;
  readonly boundaries: string;
  readonly gapAssessmentId?: string;
  readonly contributionProposalId?: string;
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ProblemFramingRequest {
  readonly orientationId: string;
  readonly statement: string;
  readonly boundaries: string;
  readonly gapAssessmentId?: string;
  readonly contributionProposalId?: string;
  readonly attribution?: ViewAttribution;
  readonly commandId?: string;
  readonly origin?: MethodologyOrigin;
}

export interface ResearchQuestionRecord {
  readonly id: string;
  readonly orientationId: string;
  readonly framingId?: string;
  readonly questionText: string;
  readonly status: ResearchQuestionStatus;
  readonly version: number;
  readonly supersededBy?: string;
  readonly gapAssessmentId?: string;
  readonly contributionProposalId?: string;
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ResearchQuestionRequest {
  readonly orientationId: string;
  readonly framingId?: string;
  readonly questionText: string;
  readonly gapAssessmentId?: string;
  readonly contributionProposalId?: string;
  readonly attribution?: ViewAttribution;
  readonly commandId?: string;
  readonly origin?: MethodologyOrigin;
  readonly supersedesId?: string;
}

export interface ResearchQuestionQuery {
  readonly orientationId?: string;
  readonly status?: ResearchQuestionStatus;
}

export interface MethodologyCandidateRecord {
  readonly id: string;
  readonly orientationId: string;
  readonly specialistRole: string;
  readonly candidateType: string;
  readonly payload: Record<string, unknown>;
  readonly origin: "specialist-proposed";
  readonly createdAt: string;
  readonly researchQuestion?: ResearchQuestionRecord;
}

export interface MethodologyCandidateRequest {
  readonly orientationId: string;
  readonly specialistRole?: string;
  readonly candidateType: string;
  readonly payload: Record<string, unknown>;
  readonly commandId?: string;
  readonly origin?: MethodologyOrigin;
}

export interface FramingInspection {
  readonly orientation: OrientationRecord;
  readonly problemFramings: readonly ProblemFramingRecord[];
  readonly researchQuestions: readonly ResearchQuestionRecord[];
  readonly unknowns: readonly string[];
  readonly candidates: readonly MethodologyCandidateRecord[];
}

export interface ConstructRecord {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly rqVersionIds: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ConstructRequest {
  readonly name: string;
  readonly definition: string;
  readonly rqVersionIds: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
}

export interface FrameworkRecord {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly constructRelations: readonly string[];
  readonly rqVersionIds: readonly string[];
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface FrameworkRequest {
  readonly name: string;
  readonly description: string;
  readonly constructRelations?: readonly string[];
  readonly rqVersionIds: readonly string[];
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
}

export interface PositionalityRecord {
  readonly id: string;
  readonly orientationId: string;
  readonly philosophicalStance: string;
  readonly situatedStance: string;
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly commandId: string;
  readonly createdAt: string;
}

export interface PositionalityRequest {
  readonly orientationId: string;
  readonly philosophicalStance?: string;
  readonly situatedStance?: string;
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
}

export interface ConceptualGroundingInspection {
  readonly orientationId: string;
  readonly constructs: readonly ConstructRecord[];
  readonly frameworks: readonly FrameworkRecord[];
  readonly positionality?: PositionalityRecord;
  readonly philosophicalStance: string;
  readonly attribution: ViewAttribution;
}

// story: e09s03
export interface DesignOption {
  readonly id: string;
  readonly name: string;
  readonly rationale: string;
  readonly fit: string;
  readonly feasibility: string;
  readonly tensions: string;
  readonly limits: string;
}

export interface DesignComparisonRecord {
  readonly id: string;
  readonly branchId: string;
  readonly researchQuestionIds: readonly string[];
  readonly designs: readonly DesignOption[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface DesignComparisonRequest {
  readonly branchId: string;
  readonly researchQuestionIds: readonly string[];
  readonly designs: readonly DesignOption[];
}

export interface SamplingPlanRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly designId: string;
  readonly population: string;
  readonly accessPath: string;
  readonly recruitmentApproach: string;
  readonly nonExecutionFlag: boolean;
  readonly createdAt: string;
}

export interface SamplingPlanRequest {
  readonly comparisonId: string;
  readonly designId: string;
  readonly population: string;
  readonly accessPath: string;
  readonly recruitmentApproach: string;
  readonly action?: string;
}

export type InstrumentRightsBasis = "stated-license" | "owner-original" | "unknown" | "unverified-reuse";

export interface InstrumentRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly designId: string;
  readonly name: string;
  readonly purpose: string;
  readonly constructIds?: readonly string[];
  readonly rightsBasis: InstrumentRightsBasis;
  readonly rightsIssue: boolean;
  readonly validatedByGeneration: boolean;
  readonly fitNotes: string;
  readonly createdAt: string;
}

export interface InstrumentRequest {
  readonly comparisonId: string;
  readonly designId: string;
  readonly name: string;
  readonly purpose: string;
  readonly constructIds?: readonly string[];
  readonly rightsBasis: InstrumentRightsBasis;
  readonly fitNotes: string;
  readonly validatedByGeneration?: boolean;
}

export interface PilotPlanRecord {
  readonly id: string;
  readonly comparisonId: string;
  readonly designId: string;
  readonly feasibilityQuestions: readonly string[];
  readonly stopConditions: readonly string[];
  readonly completed: boolean;
  readonly createdAt: string;
}

export interface PilotPlanRequest {
  readonly comparisonId: string;
  readonly designId: string;
  readonly feasibilityQuestions: readonly string[];
  readonly stopConditions: readonly string[];
}

export interface StudyDesignInspection {
  readonly comparison: DesignComparisonRecord;
  readonly samplingPlans: readonly SamplingPlanRecord[];
  readonly instruments: readonly InstrumentRecord[];
  readonly pilotPlans: readonly PilotPlanRecord[];
  readonly branchId: string;
  readonly fitSummary: {
    readonly designCount: number;
    readonly hasSamplingPlan: boolean;
    readonly hasInstruments: boolean;
    readonly hasPilotPlan: boolean;
    readonly rightsIssuesCount: number;
  };
}
