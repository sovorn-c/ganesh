// story: e04s04

import type { ResearchActivity } from "../ethics/ethics-types.js";

export type ExternalAuthorizationStatus =
  | "not-required"
  | "documented-approved"
  | "unknown"
  | "pending"
  | "expired"
  | "withdrawn";

export interface ScholarlyFindingInput {
  readonly id?: string;
  readonly findingId?: string;
  readonly affectedVersionIds: readonly string[];
  readonly sourceBasis: string;
  readonly rationale: string;
  readonly severity?: "info" | "low" | "medium" | "high" | "critical" | string;
  readonly reviewerId?: string;
  readonly methodologyPosition?: string;
  readonly actor?: string;
}

export interface ScholarlyFinding {
  readonly id: string;
  readonly affectedVersionIds: readonly string[];
  readonly sourceBasis: string;
  readonly rationale: string;
  readonly severity: string;
  readonly reviewerId: string;
  readonly methodologyPosition: string | null;
  readonly status: "open" | "resolved" | "retained";
  readonly createdAt: string;
}

export interface ReasonedOverrideRequest {
  readonly findingId: string;
  readonly packetId: string;
  readonly candidateVersionId?: string;
  readonly selectedCandidateVersionIds?: readonly string[];
  readonly rationale: string;
  readonly uncertainty?: string;
  readonly dissent?: string;
  readonly commandId: string;
  readonly actor?: string;
  readonly capability?: unknown;
  readonly ownerCapability?: unknown;
}

export interface ReasonedOverride {
  readonly id: string;
  readonly findingId: string;
  readonly packetId: string;
  readonly selectedCandidateVersionIds: readonly string[];
  readonly ownerRationale: string;
  readonly dissent: string;
  readonly uncertainty: string;
  readonly actor: string;
  readonly status: "recorded" | "blocked";
  readonly createdAt: string;
}

export interface CommitmentGateRequest {
  readonly packetId: string;
  readonly candidateVersionIds?: readonly string[];
  readonly selectedCandidateVersionIds?: readonly string[];
  readonly branchId?: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataClasses?: readonly string[];
  readonly dataUse?: string;
  readonly conditions?: unknown;
  readonly externalAuthorization?: ExternalAuthorizationStatus | { readonly status: ExternalAuthorizationStatus; readonly basis?: string };
  readonly operationId?: string;
  readonly lifecyclePhase?: "dispatch" | "external" | "resume" | "acceptance";
  readonly overrideId?: string;
  readonly commandId?: string;
  readonly actor?: string;
  readonly capability?: unknown;
  readonly ownerCapability?: unknown;
}

export interface GateResult {
  readonly gate: "identity" | "provenance" | "privacy" | "execution-safety" | "external-authorization" | "readiness";
  readonly passed: boolean;
  readonly reason: string;
}

export interface CommitmentGateEvaluation {
  readonly allowed: boolean;
  readonly status: "passed" | "blocked";
  readonly packetId: string;
  readonly candidateVersionIds: readonly string[];
  readonly gates: readonly GateResult[];
  readonly reason: string;
  readonly commitmentId?: string;
}

export interface ReviewDisagreementRequest {
  readonly findingId: string;
  readonly packetId: string;
  readonly commandId: string;
  readonly action?: "revise" | "return-to-owner";
  readonly rationale?: string;
  readonly blockerPersists?: boolean;
  readonly actor?: string;
}

export interface ReviewDisagreementResult {
  readonly status: "revised" | "owner-decision-required" | "duplicate";
  readonly findingId: string;
  readonly packetId: string;
  readonly replacementPacketId?: string;
  readonly revisionCount: number;
  readonly reviewerPosition: string;
  readonly methodologyPosition: string;
  readonly reason: string;
}