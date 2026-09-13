// story: e02s02
import {
  type BranchInput,
  type BranchMutationRequest,
  type BranchMutationResult,
  type BranchRecord,
  type BranchReference,
  type ProjectHandle,
  type SnapshotInspection,
  ProjectStoreError
} from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { historyByCommand, existingMutationResult, insertHistory, payloadHash } from "../persistence/history-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier, isoNow, newId, numberValue, stringValue } from "../persistence/storage-utils.js";

interface BranchRow {
  id: unknown;
  name: unknown;
  parent_snapshot_id: unknown;
  current_snapshot_id: unknown;
  revision: unknown;
}

function branchRow(handle: ProjectHandle, branchId: string): BranchRow {
  const row = handle.db.prepare(
    "SELECT id, name, parent_snapshot_id, current_snapshot_id, revision FROM branches WHERE id = ?"
  ).get(branchId) as BranchRow | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("branch-not-found", `branch ${branchId} was not found`);
  }
  return row;
}

function branchFromRow(row: BranchRow): BranchRecord {
  if (typeof row.current_snapshot_id !== "string") {
    throw new ProjectStoreError("invalid-branch", "branch has no current snapshot");
  }
  return {
    id: stringValue(row.id, "branch id"),
    name: stringValue(row.name, "branch name"),
    parentSnapshotId: typeof row.parent_snapshot_id === "string" ? row.parent_snapshot_id : null,
    currentSnapshotId: row.current_snapshot_id,
    revision: numberValue(row.revision, "branch revision")
  };
}

export function snapshotReferences(handle: ProjectHandle, snapshotId: string): readonly BranchReference[] {
  const rows = handle.db.prepare(
    "SELECT logical_id, artifact_version_id FROM branch_references WHERE snapshot_id = ? ORDER BY logical_id"
  ).all(snapshotId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    logicalId: stringValue(row.logical_id, "reference logical id"),
    artifactVersionId: stringValue(row.artifact_version_id, "reference version id")
  }));
}

export function getBranch(handle: ProjectHandle, branchId: string): BranchRecord {
  assertIdentifier(branchId, "branchId");
  return branchFromRow(branchRow(handle, branchId));
}

export function listBranchReferences(handle: ProjectHandle, branchId: string): readonly BranchReference[] {
  return snapshotReferences(handle, getBranch(handle, branchId).currentSnapshotId);
}

export function createBranch(handle: ProjectHandle, input: BranchInput): BranchRecord {
  assertWritable(handle);
  assertIdentifier(input.name, "branch name");
  const branchId = input.branchId === undefined ? newId("branch") : assertIdentifier(input.branchId, "branchId");
  const parentBranchId = input.parentBranchId ?? "main";
  assertIdentifier(parentBranchId, "parentBranchId");
  const parent = getBranch(handle, parentBranchId);
  const snapshotId = newId("snapshot");
  const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare(
      "INSERT INTO branches (id, name, parent_snapshot_id, current_snapshot_id, revision) VALUES (?, ?, ?, ?, ?)"
    ).run(branchId, input.name, parent.currentSnapshotId, snapshotId, 0);
    handle.db.prepare(
      "INSERT INTO snapshots (id, branch_id, parent_snapshot_id, revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(snapshotId, branchId, parent.currentSnapshotId, 0, "branch-created", createdAt);
    handle.db.prepare(
      "INSERT INTO branch_references (snapshot_id, logical_id, artifact_version_id) SELECT ?, logical_id, artifact_version_id FROM branch_references WHERE snapshot_id = ?"
    ).run(snapshotId, parent.currentSnapshotId);
    insertHistory(handle, {
      branchId,
      commandId: `branch-create-${branchId}`,
      operation: "branch-created",
      expectedVersion: 0,
      resultingVersion: 0,
      sourceSnapshotId: parent.currentSnapshotId,
      destinationSnapshotId: snapshotId,
      payloadHash: payloadHash({ branchId, name: input.name, parentBranchId }),
      actor: "system"
    });
  });
  return getBranch(handle, branchId);
}

export function copyBranchSnapshot(
  handle: ProjectHandle,
  oldSnapshotId: string,
  newSnapshotId: string,
  branchId: string,
  revision: number,
  reason: string
): void {
  handle.db.prepare(
    "INSERT INTO snapshots (id, branch_id, parent_snapshot_id, revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(newSnapshotId, branchId, oldSnapshotId, revision, reason, isoNow());
  handle.db.prepare(
    "INSERT INTO branch_references (snapshot_id, logical_id, artifact_version_id) SELECT ?, logical_id, artifact_version_id FROM branch_references WHERE snapshot_id = ?"
  ).run(newSnapshotId, oldSnapshotId);
}

function artifactBelongsToLogicalId(handle: ProjectHandle, versionId: string, logicalId: string): boolean {
  const row = handle.db.prepare("SELECT logical_id FROM artifact_versions WHERE id = ?").get(versionId) as
    | { logical_id?: unknown }
    | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("artifact-not-found", `artifact version ${versionId} was not found`);
  }
  return row.logical_id === logicalId;
}

export function updateBranchReference(handle: ProjectHandle, request: BranchMutationRequest): BranchMutationResult {
  assertIdentifier(request.branchId, "branchId");
  assertIdentifier(request.logicalId, "logicalId");
  assertIdentifier(request.artifactVersionId, "artifactVersionId");
  assertIdentifier(request.commandId, "commandId");
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0) {
    throw new ProjectStoreError("invalid-version", "expectedVersion must be a non-negative integer");
  }
  if (!handle.writable || handle.status !== "ready") {
    return { status: "blocked", branchId: request.branchId, revision: request.expectedVersion, reason: handle.readonlyReason ?? "project is read-only" };
  }
  handle.assertCurrent();
  if (!artifactBelongsToLogicalId(handle, request.artifactVersionId, request.logicalId)) {
    return { status: "rejected", branchId: request.branchId, revision: request.expectedVersion, reason: "artifact version belongs to another logical object" };
  }
  const hash = payloadHash({
    branchId: request.branchId,
    logicalId: request.logicalId,
    artifactVersionId: request.artifactVersionId,
    expectedVersion: request.expectedVersion
  });
  return transaction(handle.db, () => {
    const existing = historyByCommand(handle, request.commandId);
    if (existing !== undefined) {
      return existingMutationResult(existing, hash, request.branchId);
    }
    const branch = getBranch(handle, request.branchId);
    if (branch.revision !== request.expectedVersion) {
      return { status: "stale", branchId: branch.id, revision: branch.revision, snapshotId: branch.currentSnapshotId, reason: "expected branch version is stale" };
    }
    const nextRevision = branch.revision + 1;
    const nextSnapshot = newId("snapshot");
    copyBranchSnapshot(handle, branch.currentSnapshotId, nextSnapshot, branch.id, nextRevision, "reference-updated");
    handle.db.prepare(
      "INSERT INTO branch_references (snapshot_id, logical_id, artifact_version_id) VALUES (?, ?, ?) ON CONFLICT(snapshot_id, logical_id) DO UPDATE SET artifact_version_id = excluded.artifact_version_id"
    ).run(nextSnapshot, request.logicalId, request.artifactVersionId);
    handle.db.prepare("UPDATE branches SET current_snapshot_id = ?, revision = ? WHERE id = ?").run(nextSnapshot, nextRevision, branch.id);
    insertHistory(handle, {
      branchId: branch.id,
      commandId: request.commandId,
      operation: "reference-updated",
      expectedVersion: branch.revision,
      resultingVersion: nextRevision,
      sourceSnapshotId: branch.currentSnapshotId,
      destinationSnapshotId: nextSnapshot,
      payloadHash: hash,
      actor: request.actor ?? "researcher"
    });
    return { status: "accepted", branchId: branch.id, revision: nextRevision, snapshotId: nextSnapshot };
  });
}

export function inspectSnapshot(handle: ProjectHandle, snapshotId: string): SnapshotInspection {
  assertIdentifier(snapshotId, "snapshotId");
  const row = handle.db.prepare(
    "SELECT id, branch_id, parent_snapshot_id, revision FROM snapshots WHERE id = ?"
  ).get(snapshotId) as Record<string, unknown> | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("snapshot-not-found", `snapshot ${snapshotId} was not found`);
  }
  return {
    snapshotId: stringValue(row.id, "snapshot id"),
    branchId: stringValue(row.branch_id, "snapshot branch id"),
    revision: numberValue(row.revision, "snapshot revision"),
    parentSnapshotId: typeof row.parent_snapshot_id === "string" ? row.parent_snapshot_id : null,
    references: snapshotReferences(handle, snapshotId)
  };
}
