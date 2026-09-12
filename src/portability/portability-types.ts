// story: e15s01
import type { ArtifactInspection } from "../project/project-types.js";

// --- Export/Packet types ---

export type PortabilityOperationStatus = "pending" | "complete" | "failed";
export type PacketKind = "project" | "backup";

export interface ExportRequest {
  readonly commandId: string;
  readonly destinationPath: string;
  readonly destination: string;
  readonly purpose: string;
  readonly payloadHash: string;
}

export interface PacketManifest {
  readonly kind: PacketKind;
  readonly schemaVersion: number;
  readonly projectId: string;
  readonly createdAt: string;
  readonly destination: string;
  readonly purpose: string;
  readonly files: readonly PacketFileEntry[];
  readonly omissions: readonly OmissionNotice[];
  readonly commitmentIds: readonly string[];
  readonly evidenceLocatorIds: readonly string[];
}

export interface PacketFileEntry {
  readonly relativePath: string;
  readonly sha256: string;
}

export interface OmissionNotice {
  readonly artifactVersionId: string;
  readonly reason: string;
}

export interface ProjectPacket {
  readonly manifest: PacketManifest;
  readonly packetPath: string;
  readonly operationId: string;
}

export interface ProjectPacketInspection {
  readonly manifest: PacketManifest;
  readonly hashResults: readonly PacketHashResult[];
  readonly valid: boolean;
}

export interface PacketHashResult {
  readonly relativePath: string;
  readonly expected: string;
  readonly actual: string | null;
  readonly match: boolean;
}

export interface PortabilityOperation {
  readonly id: string;
  readonly commandId: string;
  readonly kind: string;
  readonly payloadHash: string;
  readonly status: PortabilityOperationStatus;
  readonly packetPath: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
}

// --- Backup/Restore types ---

export interface BackupRequest {
  readonly commandId: string;
  readonly payloadHash: string;
}

export interface BackupSnapshot {
  readonly backupId: string;
  readonly backupPath: string;
  readonly manifest: PacketManifest;
  readonly operationId: string;
}

export interface RestoreRequest {
  readonly commandId: string;
  readonly sourcePath: string;
  readonly destinationPath: string;
  readonly mode: "materialize" | "drill" | "replace";
  readonly payloadHash: string;
}

export interface RestoreResult {
  readonly mode: "materialize" | "drill" | "replace";
  readonly valid: boolean;
  readonly hashResults: readonly PacketHashResult[];
  readonly operationId: string;
  readonly detail: string;
  readonly reinstatedGrants: readonly string[];
  readonly preservedWithdrawals: readonly string[];
}

export interface MigrateWithBackupResult {
  readonly backupId: string;
  readonly fromVersion: number;
  readonly toVersion: number;
}

// --- Deletion types ---

export interface DeletionRequest {
  readonly artifactVersionId: string;
  readonly reason: string;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly includeAppBackups?: boolean;
}

export interface DeletionResult {
  readonly deletionEventId: string;
  readonly unlinkedPaths: readonly string[];
  readonly tombstoneId: string;
  readonly notRecalledDisclosures: readonly NotRecalledDisclosure[];
  readonly detail: string;
}

export interface NotRecalledDisclosure {
  readonly disclosureId: string;
  readonly destination: string;
  readonly purpose: string;
  readonly status: "recall-not-promised";
}

export interface EvidenceTombstone {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly contentHash: string | null;
  readonly reason: string;
  readonly actor: string;
  readonly deletedAt: string;
}

export interface DeletionEvent {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly unlinkedPaths: string;
  readonly tombstoneId: string;
  readonly notRecalledDisclosures: string;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly createdAt: string;
}

// --- Lock types ---

export interface ProjectLock {
  readonly projectRoot: string;
  readonly pid: number;
  release(): void;
}
