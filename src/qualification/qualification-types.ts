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
