// story: e03s05
export type DeclassificationStatus = "pending" | "approved" | "rejected" | "revoked";

export interface DeclassificationRequest {
  readonly id?: string;
  readonly inputVersionIds: readonly string[];
  readonly transformation: string;
  readonly destination: string;
  readonly purpose: string;
  readonly outputVersionId?: string;
  readonly authority: string;
  readonly residualRisk: string;
  readonly validityConditions?: Record<string, unknown> | string;
  readonly status?: DeclassificationStatus;
  readonly actor?: string;
}

export interface DeclassificationRecord {
  readonly id: string;
  readonly inputVersionIds: readonly string[];
  readonly transformation: string;
  readonly destination: string;
  readonly purpose: string;
  readonly outputVersionId: string | null;
  readonly authority: string;
  readonly residualRisk: string;
  readonly validityConditions: string;
  readonly status: DeclassificationStatus;
  readonly createdAt: string;
}

export interface TransformedDisclosureRequest {
  readonly declassificationId: string;
  readonly inputVersionIds: readonly string[];
  readonly transformation: string;
  readonly destination: string;
  readonly purpose: string;
  readonly outputVersionId?: string;
  readonly capability?: unknown;
  readonly actor?: string;
  readonly branchId?: string;
}

export interface TransformedDisclosureResult {
  readonly authorized: boolean;
  readonly declassificationId: string;
  readonly status: "authorized" | "denied";
  readonly reason: string;
  readonly decisionId?: string;
}

export interface AdversarialFixture {
  readonly id: string;
  readonly name: string;
  readonly attackType:
    | "forged-approval"
    | "credential-access"
    | "cross-project-read"
    | "direct-canonical-write"
    | "document-script-injection"
    | "unauthorized-export";
  readonly payload: string | Record<string, unknown>;
}

export interface AdversarialTestResult {
  readonly fixtureId: string;
  readonly name: string;
  readonly attackType: string;
  readonly denied: boolean;
  readonly sideEffectObserved: boolean;
  readonly reason: string;
}

export interface AdversarialSuiteReport {
  readonly passed: boolean;
  readonly totalTests: number;
  readonly totalDenied: number;
  readonly totalSideEffects: number;
  readonly results: readonly AdversarialTestResult[];
}

export interface PolicyAuditPacket {
  readonly projectId: string;
  readonly operationId?: string;
  readonly operations: readonly Record<string, unknown>[];
  readonly checkpoints: readonly Record<string, unknown>[];
  readonly decisions: readonly Record<string, unknown>[];
  readonly disclosureDecisions: readonly Record<string, unknown>[];
  readonly declassifications: readonly Record<string, unknown>[];
  readonly fences: readonly Record<string, unknown>[];
  readonly quarantinedOutputs: readonly Record<string, unknown>[];
  readonly generatedAt: string;
}
