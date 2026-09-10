// story: e04s03

import type { BranchReference, ImpactRecord } from "../project/project-types.js";

export interface BranchComparison {
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly differences: readonly BranchDifference[];
}

export interface BranchDifference {
  readonly logicalId: string;
  readonly sourceArtifactVersionId: string | null;
  readonly destinationArtifactVersionId: string | null;
}

export interface AlternativeAdoptionRequest {
  readonly packetId: string;
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly expectedVersion?: number;
  readonly expectedDestinationRevision?: number;
  readonly selectedVersionIds?: readonly string[];
  readonly selectedCandidateVersionIds?: readonly string[];
  readonly logicalIds?: readonly string[];
  readonly commandId: string;
  readonly actor?: string;
  readonly capability?: unknown;
  readonly ownerCapability?: unknown;
}

export interface AlternativeAdoptionResult {
  readonly status: "accepted" | "stale" | "duplicate" | "rejected" | "blocked";
  readonly packetId: string;
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly revision: number;
  readonly snapshotId?: string;
  readonly changed: readonly BranchReference[];
  readonly impactedDependents: readonly string[];
  readonly commitmentId?: string;
  readonly reason?: string;
}

export interface AlternativeImpact extends ImpactRecord {
  readonly reviewStatus: "required" | "recorded";
}