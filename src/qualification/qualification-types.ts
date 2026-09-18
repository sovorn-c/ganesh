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
