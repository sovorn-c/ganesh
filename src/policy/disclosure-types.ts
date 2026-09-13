// story: e03s02
export type DisclosureOperationKind =
  | "prompt"
  | "attachment"
  | "summary"
  | "compaction"
  | "snippet"
  | "embedding"
  | "telemetry"
  | "export"
  | "diagnostic"
  | "analysis"
  | "inspection"
  | "retrieval";

export const DISCLOSURE_OPERATIONS: readonly DisclosureOperationKind[] = [
  "prompt",
  "attachment",
  "summary",
  "compaction",
  "snippet",
  "embedding",
  "telemetry",
  "export",
  "diagnostic",
  "analysis",
  "inspection",
  "retrieval"
];

export interface DisclosureRequest {
  readonly sourceVersions: readonly string[];
  readonly operation: DisclosureOperationKind;
  readonly destination: string;
  readonly purpose: string;
  readonly transformation?: string;
  readonly branchId?: string;
  readonly correlationId?: string;
  readonly payload?: unknown;
  readonly actor?: string;
  readonly optIn?: boolean;
}

export interface DisclosureDecision {
  readonly id: string;
  readonly correlationId: string;
  readonly operation: DisclosureOperationKind;
  readonly destination: string;
  readonly purpose: string;
  readonly sourceVersions: readonly string[];
  readonly transformation?: string;
  readonly branchId?: string;
  readonly status: "allow" | "deny";
  readonly reason: string;
  readonly policyDecisionId?: string;
  readonly createdAt: string;
}

export interface DerivedMaterialRecord {
  readonly id: string;
  readonly candidateVersionId?: string;
  readonly sourceVersionIds: readonly string[];
  readonly transformation: string;
  readonly inheritedRestrictions: readonly string[];
  readonly branchId?: string;
  readonly createdAt: string;
}

export interface EffectiveRestrictions {
  readonly sourceVersionIds: readonly string[];
  readonly allResolvedVersionIds: readonly string[];
  readonly highestSensitivity: string;
  readonly isLocalOnly: boolean;
  readonly isWithdrawn: boolean;
  readonly isExpired: boolean;
  readonly permittedDestinations: readonly string[];
  readonly permittedPurposes: readonly string[];
  readonly permittedTransformations: readonly string[];
  readonly restrictions: readonly string[];
}
