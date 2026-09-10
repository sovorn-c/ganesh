import type { DatabaseSync } from "node:sqlite";

export const PROJECT_SCHEMA_VERSION = 1;

export type ProjectStatus = "ready" | "read-only" | "migration-required" | "unknown-future" | "blocked";
export type ContentStatus = "available" | "missing" | "corrupt" | "unavailable";
export type ArtifactAccess = "full-text" | "metadata-only" | "abstract-only" | "unavailable";

export interface ProjectInput {
  readonly rootPath: string;
  readonly ownerId: string;
  readonly projectId?: string;
}

export interface ProjectRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly rootPath: string;
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
}

export interface ProjectHandle {
  readonly db: DatabaseSync;
  readonly project: ProjectRecord;
  readonly status: ProjectStatus;
  readonly writable: boolean;
  readonly readonlyReason?: string;
  close(): void;
}

export interface DependencyInput {
  readonly versionId: string;
  readonly relation?: string;
}

export interface DependencyReference {
  readonly artifactVersionId: string;
  readonly dependencyVersionId: string;
  readonly relation: string;
}

export interface ArtifactVersionInput {
  readonly logicalId: string;
  readonly version: string;
  readonly versionId?: string;
  readonly content?: string | Uint8Array;
  readonly expectedHash?: string;
  readonly origin?: string;
  readonly access?: ArtifactAccess;
  readonly dependencies?: readonly DependencyInput[];
  readonly relativePath?: string;
  readonly availability?: "available" | "unavailable";
  readonly failAt?: "before-finalize" | "after-finalize-before-register" | "after-commit" | "after-register";
}

export interface ArtifactVersionRecord {
  readonly id: string;
  readonly logicalId: string;
  readonly version: string;
  readonly contentHash: string | null;
  readonly storagePath: string | null;
  readonly byteLength: number | null;
  readonly origin: string;
  readonly access: ArtifactAccess;
  readonly createdAt: string;
}

export interface ArtifactInspection extends ArtifactVersionRecord {
  readonly contentStatus: ContentStatus;
  readonly detail: string;
  readonly dependencies: readonly DependencyReference[];
}

export interface BranchInput {
  readonly name: string;
  readonly branchId?: string;
  readonly parentBranchId?: string;
}

export interface BranchRecord {
  readonly id: string;
  readonly name: string;
  readonly parentSnapshotId: string | null;
  readonly currentSnapshotId: string;
  readonly revision: number;
}

export interface BranchReference {
  readonly logicalId: string;
  readonly artifactVersionId: string;
}

export interface BranchMutationRequest {
  readonly branchId: string;
  readonly logicalId: string;
  readonly artifactVersionId: string;
  readonly expectedVersion: number;
  readonly commandId: string;
  readonly actor?: string;
}

export type BranchMutationStatus = "accepted" | "duplicate" | "stale" | "rejected" | "blocked";

export interface BranchMutationResult {
  readonly status: BranchMutationStatus;
  readonly branchId: string;
  readonly revision: number;
  readonly snapshotId?: string;
  readonly reason?: string;
}

export interface PromotionRequest {
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly expectedVersion: number;
  readonly commandId: string;
  readonly logicalIds?: readonly string[];
  readonly actor?: string;
}

export interface ImpactRecord {
  readonly id: string;
  readonly branchId: string;
  readonly sourceVersionId: string;
  readonly dependentVersionId: string;
  readonly kind: string;
  readonly notice: string;
  readonly createdAt: string;
}

export interface PromotionResult {
  readonly status: BranchMutationStatus;
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly revision: number;
  readonly snapshotId?: string;
  readonly changed: readonly BranchReference[];
  readonly impactedDependents: readonly string[];
  readonly reason?: string;
}

export interface HistoryRecord {
  readonly id: string;
  readonly branchId: string | null;
  readonly commandId: string;
  readonly operation: string;
  readonly expectedVersion: number;
  readonly resultingVersion: number;
  readonly sourceSnapshotId: string | null;
  readonly destinationSnapshotId: string | null;
  readonly payloadHash: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface SharedSourceCorrectionInput {
  readonly sourceVersionId: string;
  readonly notice: string;
  readonly commandId: string;
  readonly actor?: string;
}

export interface SchemaStatus {
  readonly status: "supported" | "migration-required" | "unknown-future";
  readonly version: number;
  readonly supportedVersion: number;
  readonly allowedOperations: readonly string[];
  readonly remediation: string;
}

export interface SnapshotInspection {
  readonly snapshotId: string;
  readonly branchId: string;
  readonly revision: number;
  readonly parentSnapshotId: string | null;
  readonly references: readonly BranchReference[];
}

export interface RecoveryResult {
  readonly status: ProjectStatus;
  readonly removedTemporaryFiles: readonly string[];
  readonly artifactStatuses: readonly ArtifactInspection[];
  readonly checkpointId: string | null;
  readonly detail: string;
}

export class ProjectStoreError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ProjectStoreError";
    this.code = code;
  }
}
