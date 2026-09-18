// story: e17s01

export interface AcceptanceScenarioMapping {
  readonly scenarioId: string;
  readonly title?: string;
  readonly testPattern: string;
  readonly verificationPointer: string;
  readonly description?: string;
}

export interface AcceptanceCatalog {
  readonly version?: string;
  readonly catalog?: string;
  readonly scenarios: readonly AcceptanceScenarioMapping[];
  readonly certified?: never;
  readonly scholarlyCertification?: never;
}

export interface QualificationRunResult {
  readonly passed: boolean;
  readonly matchedCount: number;
  readonly error?: string;
}

export type QualificationRunner = (
  testPattern: string,
  verificationPointer?: string
) => QualificationRunResult;

export interface QualificationRunnerPort {
  readonly run: QualificationRunner;
}

export interface AcceptanceEvidenceRow {
  readonly scenarioId: string;
  readonly title?: string;
  readonly testPattern: string;
  readonly verificationPointer: string;
  readonly status: "pass" | "failed";
  readonly matchedCount?: number;
  readonly reason?: string;
}

export interface AcceptanceEvidenceReport {
  readonly status: "pass" | "failed";
  readonly scenariosTotal: number;
  readonly scenariosPassing: number;
  readonly scenariosFailing: number;
  readonly rows: readonly AcceptanceEvidenceRow[];
  readonly scholarlyCertification: "not-inferred";
  readonly reasons?: readonly string[];
}

export interface AcceptanceEvidenceOptions {
  readonly runner?: QualificationRunnerPort | QualificationRunner;
  readonly mode?: "catalog" | "execute";
  readonly catalogFile?: string;
}

export type AdversarialClassId =
  | "approval-forgery"
  | "stale-state"
  | "malicious-import"
  | "permission-race"
  | "cancellation"
  | "recovery";

export interface AdversarialClassMapping {
  readonly classId: AdversarialClassId | string;
  readonly title?: string;
  readonly testPattern: string;
  readonly verificationPointer: string;
  readonly expectedBehavior?: string;
}

export interface AdversarialCatalog {
  readonly version?: string;
  readonly catalog?: string;
  readonly classes: readonly AdversarialClassMapping[];
  readonly certified?: never;
  readonly securityCertification?: never;
}

export interface AdversarialEvidenceRow {
  readonly classId: AdversarialClassId | string;
  readonly title?: string;
  readonly testPattern: string;
  readonly verificationPointer: string;
  readonly status: "pass" | "failed";
  readonly matchedCount?: number;
  readonly reason?: string;
}

export interface AdversarialQualificationReport {
  readonly status: "pass" | "failed";
  readonly classesTotal: number;
  readonly classesPassing: number;
  readonly classesFailing: number;
  readonly rows: readonly AdversarialEvidenceRow[];
  readonly securityCertification: "not-inferred";
  readonly reasons?: readonly string[];
}

export interface AdversarialQualificationOptions {
  readonly runner?: QualificationRunnerPort | QualificationRunner;
  readonly mode?: "catalog" | "execute";
  readonly catalogFile?: string;
}

// story: e17s03

export interface CompetencyWorkedExample {
  readonly summary: string;
  readonly context: string;
  readonly outcome: string;
}

export interface CompetencyOutputSchema {
  readonly separatesObservationsFromInferences: boolean;
  readonly includesContraryOrLimitations: boolean;
  readonly format?: string;
  readonly fields?: readonly string[];
}

export interface CompetencyProvenanceRequirement {
  readonly requiresLocators?: boolean;
  readonly separatesObservationInferenceRecommendation?: boolean;
  readonly includesContraryEvidence?: boolean;
}

export interface CompetencyItem {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly purpose: string;
  readonly owningRole: "Supervisor" | "Discovery" | "Evidence" | "Methodology" | "Reviewer" | string;
  readonly applicableProfiles: readonly string[];
  readonly unsupportedContexts: readonly string[];
  readonly requiredInputs: readonly string[];
  readonly outputSchema: CompetencyOutputSchema;
  readonly failureConditions: readonly string[] | string;
  readonly workedSuccess: CompetencyWorkedExample | string;
  readonly workedFailure: CompetencyWorkedExample | string;
  readonly source: string;
  readonly license: string;
  readonly adaptationRecord?: string;
  readonly directDependencies?: readonly string[];
  readonly outputProvenance?: CompetencyProvenanceRequirement;
  readonly scholarlyCertified?: never;
  readonly statisticallyValidated?: never;
}

export interface CompetencyInventory {
  readonly version?: string;
  readonly catalog?: string;
  readonly competencies: readonly CompetencyItem[];
  readonly scholarlyCertified?: never;
  readonly statisticallyValidated?: never;
  readonly certified?: never;
}

export interface CompetencyInventoryRow {
  readonly id: string;
  readonly name: string;
  readonly status: "pass" | "failed";
  readonly reason?: string;
}

export interface CompetencyInventoryReport {
  readonly status: "pass" | "failed";
  readonly competenciesTotal: number;
  readonly competenciesPassing: number;
  readonly competenciesFailing: number;
  readonly rows: readonly CompetencyInventoryRow[];
  readonly scholarlyCertification: "not-inferred";
  readonly reasons?: readonly string[];
}

export interface CompetencyInventoryOptions {
  readonly inventoryFile?: string;
  readonly dependenciesDocPath?: string;
}

// story: e17s04

export type QualificationMethodProfileId =
  | "quantitative"
  | "qualitative"
  | "mixed-methods"
  | "artifact-evaluation"
  | "artifact-evaluation-design-science";

export type DisciplinaryContextId =
  | "empirical-social-science"
  | "information-systems"
  | "hci"
  | "education"
  | "computing";

export interface CasePackRubric {
  readonly id: string;
  readonly name: string;
  readonly dimensions: readonly string[];
  readonly criteria?: Record<string, string>;
}

export interface CasePack {
  readonly id: string;
  readonly title: string;
  readonly methodProfile: QualificationMethodProfileId | string;
  readonly disciplinaryContext: DisciplinaryContextId | string;
  readonly rubric: CasePackRubric;
  readonly isDisagreementCase?: boolean;
  readonly outOfCompetence?: boolean;
  readonly excerpt?: string;
  readonly purpose?: string;
}

export interface CasePackCatalog {
  readonly version?: string;
  readonly cases: readonly CasePack[];
}

export type EvaluatorKind = "synthetic" | "qualified-human";

export interface HumanEvaluationRecord {
  readonly caseId: string;
  readonly evaluatorKind: EvaluatorKind;
  readonly evaluatorRole: string;
  readonly disposition: "accept" | "revise" | "reject" | "escalated";
  readonly rubricScores?: Record<string, number | string>;
  readonly notes?: string;
  readonly modelGroundTruthOnly?: boolean;
  readonly oracleKind?: string;
  readonly retainedPositions?: readonly string[];
  readonly dissentPreserved?: boolean;
  readonly escalationRequired?: boolean;
  readonly escalated?: boolean;
}

export interface HumanEvaluationRow {
  readonly caseId: string;
  readonly methodProfile: string;
  readonly disciplinaryContext: string;
  readonly status: "pass" | "failed";
  readonly evaluatorKind?: EvaluatorKind;
  readonly reason?: string;
}

export interface HumanEvaluationProtocolReport {
  readonly status: "pass" | "failed";
  readonly casesTotal: number;
  readonly casesEvaluated: number;
  readonly profilesCovered: readonly string[];
  readonly contextsCovered: readonly string[];
  readonly evaluatorKindsPresent: readonly EvaluatorKind[];
  readonly hasQualifiedHumanCoverage: boolean;
  readonly rows: readonly HumanEvaluationRow[];
  readonly scholarlyCertification: "not-inferred";
  readonly reasons?: readonly string[];
}

export interface HumanEvaluationProtocolOptions {
  readonly casePacksDir?: string;
  readonly evaluationsDir?: string;
  readonly casePacksFile?: string;
  readonly evaluationsFile?: string;
}

// story: e17s05

export interface SafetyDefectItem {
  readonly id: string;
  readonly severity: "low" | "medium" | "high" | "critical" | string;
  readonly title: string;
  readonly status: "open" | "resolved" | "mitigated" | string;
  readonly description?: string;
}

export interface SafetyDefectLedger {
  readonly version?: string;
  readonly defects: readonly SafetyDefectItem[];
}

export interface OutcomeEvidenceItem {
  readonly id: string;
  readonly epicId: string;
  readonly title: string;
  readonly status: "passed" | "blocked" | "unimplemented" | string;
  readonly verificationPointer?: string;
}

export interface OutcomeEvidenceCatalog {
  readonly version?: string;
  readonly outcomes: readonly OutcomeEvidenceItem[];
}

export interface ReleaseQualificationReport {
  readonly localQualification: "pass" | "failed";
  readonly shipment: "authorized" | "blocked";
  readonly acceptance: AcceptanceEvidenceReport;
  readonly adversarial: AdversarialQualificationReport;
  readonly competency: CompetencyInventoryReport;
  readonly humanEvaluation: HumanEvaluationProtocolReport;
  readonly outcomes: readonly OutcomeEvidenceItem[];
  readonly safetyDefects: readonly SafetyDefectItem[];
  readonly hostedCi: false;
  readonly productionReady: false;
  readonly scholarlyCertification: "not-inferred";
  readonly reasons?: readonly string[];
}

export interface ReleaseQualificationOptions {
  readonly runner?: QualificationRunnerPort | QualificationRunner;
  readonly mode?: "catalog" | "execute";
  readonly acceptanceCatalogFile?: string;
  readonly adversarialCatalogFile?: string;
  readonly competencyInventoryFile?: string;
  readonly casePacksFile?: string;
  readonly evaluationsFile?: string;
  readonly safetyDefectsFile?: string;
  readonly outcomeEvidenceFile?: string;
}
