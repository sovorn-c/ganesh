// story: e03s01
export type DataSensitivity = "public" | "confidential" | "participant-identifiable" | "restricted";

export const DATA_SENSITIVITY_LEVELS: readonly DataSensitivity[] = [
  "public",
  "confidential",
  "participant-identifiable",
  "restricted"
];

export interface ClassificationInput {
  readonly sensitivity: DataSensitivity | string;
  readonly basis: string;
  readonly actor?: string;
}

export interface ClassificationRecord {
  readonly id: string;
  readonly inputVersionId: string;
  readonly sensitivity: string;
  readonly basis: string;
  readonly actor: string;
  readonly createdAt: string;
}

export type PermissionStatus = "active" | "withdrawn" | "expired";

export interface ValidityConditions {
  readonly expiresAt?: string;
  readonly notBefore?: string;
  readonly conditions?: Record<string, unknown>;
}

export interface DataUseGrantInput {
  readonly inputVersion: string;
  readonly destination: string;
  readonly purpose: string;
  readonly authority: string;
  readonly allowedTransformations?: readonly string[];
  readonly validity?: ValidityConditions;
  readonly actor?: string;
}

export interface DataUsePermissionRecord {
  readonly id: string;
  readonly inputVersionId: string;
  readonly destination: string;
  readonly purpose: string;
  readonly authority: string;
  readonly allowedTransformations: readonly string[];
  readonly validity: ValidityConditions;
  readonly status: PermissionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface PolicyStatusHistoryRecord {
  readonly id: string;
  readonly permissionId: string;
  readonly previousStatus: PermissionStatus | "";
  readonly newStatus: PermissionStatus;
  readonly reason: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface PolicyEvaluationRequest {
  readonly inputVersions: readonly string[];
  readonly destination: string;
  readonly purpose: string;
  readonly transformation?: string;
  readonly correlationId?: string;
  readonly branchId?: string;
  readonly actor?: string;
}

export type PolicyDecisionResult = "allow" | "deny";

export interface PolicyDecision {
  readonly id: string;
  readonly correlationId: string;
  readonly result: PolicyDecisionResult;
  readonly reason: string;
  readonly inputVersions: readonly string[];
  readonly policyVersions: readonly string[];
  readonly destination: string;
  readonly purpose: string;
  readonly transformation?: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface PolicyHistoryItem {
  readonly kind: "classification" | "grant" | "status-change" | "decision";
  readonly id: string;
  readonly inputVersionId?: string;
  readonly details: string;
  readonly status?: string;
  readonly reason?: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface PolicyRestriction {
  readonly inputVersionId: string;
  readonly sensitivity: string;
  readonly allowedDestinations: readonly string[];
  readonly allowedPurposes: readonly string[];
  readonly allowedTransformations: readonly string[];
  readonly localOnly: boolean;
  readonly isWithdrawn: boolean;
  readonly isExpired: boolean;
}
