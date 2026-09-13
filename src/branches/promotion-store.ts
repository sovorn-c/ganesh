// story: e02s02
import {
  type BranchReference,
  type ProjectHandle,
  type PromotionRequest,
  type PromotionResult,
  ProjectStoreError
} from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { getBranch, copyBranchSnapshot, snapshotReferences } from "./branch-store.js";
import { addImpact, dependentVersions } from "./dependency-store.js";
import { existingMutationResult, historyByCommand, insertHistory, payloadHash } from "../persistence/history-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier, newId } from "../persistence/storage-utils.js";

export function promoteBranch(handle: ProjectHandle, request: PromotionRequest): PromotionResult {
  assertIdentifier(request.sourceBranchId, "sourceBranchId");
  assertIdentifier(request.destinationBranchId, "destinationBranchId");
  assertIdentifier(request.commandId, "commandId");
  if (request.sourceBranchId === request.destinationBranchId) {
    throw new ProjectStoreError("invalid-promotion", "source and destination branches must differ");
  }
  if (!Number.isInteger(request.expectedVersion) || request.expectedVersion < 0) {
    throw new ProjectStoreError("invalid-version", "expectedVersion must be a non-negative integer");
  }
  if (!handle.writable || handle.status !== "ready") {
    return {
      status: "blocked",
      sourceBranchId: request.sourceBranchId,
      destinationBranchId: request.destinationBranchId,
      revision: request.expectedVersion,
      changed: [],
      impactedDependents: [],
      reason: handle.readonlyReason ?? "project is read-only"
    };
  }
  handle.assertCurrent();
  const selected = request.logicalIds === undefined ? undefined : [...new Set(request.logicalIds)].sort();
  for (const logicalId of selected ?? []) {
    assertIdentifier(logicalId, "logicalId");
  }
  const hash = payloadHash({
    sourceBranchId: request.sourceBranchId,
    destinationBranchId: request.destinationBranchId,
    expectedVersion: request.expectedVersion,
    logicalIds: selected ?? null
  });
  return transaction(handle.db, () => {
    const existing = historyByCommand(handle, request.commandId);
    if (existing !== undefined) {
      const duplicate = existingMutationResult(existing, hash, request.destinationBranchId);
      return {
        status: duplicate.status,
        sourceBranchId: request.sourceBranchId,
        destinationBranchId: request.destinationBranchId,
        revision: duplicate.revision,
        snapshotId: duplicate.snapshotId,
        changed: [],
        impactedDependents: [],
        reason: duplicate.reason
      };
    }
    const source = getBranch(handle, request.sourceBranchId);
    const destination = getBranch(handle, request.destinationBranchId);
    if (destination.revision !== request.expectedVersion) {
      return {
        status: "stale",
        sourceBranchId: source.id,
        destinationBranchId: destination.id,
        revision: destination.revision,
        changed: [],
        impactedDependents: [],
        reason: "expected destination branch version is stale"
      };
    }
    const sourceMap = new Map(snapshotReferences(handle, source.currentSnapshotId).map((item) => [item.logicalId, item.artifactVersionId]));
    const destinationMap = new Map(snapshotReferences(handle, destination.currentSnapshotId).map((item) => [item.logicalId, item.artifactVersionId]));
    const logicalIds = selected ?? [...sourceMap.keys()].sort();
    const changed: BranchReference[] = [];
    for (const logicalId of logicalIds) {
      const artifactVersionId = sourceMap.get(logicalId);
      if (artifactVersionId === undefined) {
        throw new ProjectStoreError("promotion-invalid", `source branch has no reference for ${logicalId}`);
      }
      if (destinationMap.get(logicalId) !== artifactVersionId) {
        changed.push({ logicalId, artifactVersionId });
      }
    }
    if (changed.length === 0) {
      insertHistory(handle, {
        branchId: destination.id,
        commandId: request.commandId,
        operation: "branch-promoted",
        expectedVersion: destination.revision,
        resultingVersion: destination.revision,
        sourceSnapshotId: source.currentSnapshotId,
        destinationSnapshotId: destination.currentSnapshotId,
        payloadHash: hash,
        actor: request.actor ?? "researcher"
      });
      return {
        status: "accepted",
        sourceBranchId: source.id,
        destinationBranchId: destination.id,
        revision: destination.revision,
        snapshotId: destination.currentSnapshotId,
        changed,
        impactedDependents: []
      };
    }
    const nextRevision = destination.revision + 1;
    const nextSnapshot = newId("snapshot");
    copyBranchSnapshot(handle, destination.currentSnapshotId, nextSnapshot, destination.id, nextRevision, "branch-promoted");
    for (const reference of changed) {
      handle.db.prepare(
        "INSERT INTO branch_references (snapshot_id, logical_id, artifact_version_id) VALUES (?, ?, ?) ON CONFLICT(snapshot_id, logical_id) DO UPDATE SET artifact_version_id = excluded.artifact_version_id"
      ).run(nextSnapshot, reference.logicalId, reference.artifactVersionId);
    }
    const destinationReferences = snapshotReferences(handle, nextSnapshot);
    const impacted = new Set<string>();
    for (const reference of changed) {
      const candidates = dependentVersions(handle, reference.artifactVersionId);
      const previousVersionId = destinationMap.get(reference.logicalId);
      if (previousVersionId !== undefined) {
        for (const dependent of dependentVersions(handle, previousVersionId)) {
          candidates.add(dependent);
        }
      }
      for (const dependent of candidates) {
        if (destinationReferences.some((item) => item.artifactVersionId === dependent)) {
          impacted.add(dependent);
          addImpact(handle, destination.id, reference.artifactVersionId, dependent, "promotion-impact", "promoted version may affect this dependent", request.commandId);
        }
      }
    }
    handle.db.prepare("UPDATE branches SET current_snapshot_id = ?, revision = ? WHERE id = ?").run(nextSnapshot, nextRevision, destination.id);
    insertHistory(handle, {
      branchId: destination.id,
      commandId: request.commandId,
      operation: "branch-promoted",
      expectedVersion: destination.revision,
      resultingVersion: nextRevision,
      sourceSnapshotId: source.currentSnapshotId,
      destinationSnapshotId: nextSnapshot,
      payloadHash: hash,
      actor: request.actor ?? "researcher"
    });
    return {
      status: "accepted",
      sourceBranchId: source.id,
      destinationBranchId: destination.id,
      revision: nextRevision,
      snapshotId: nextSnapshot,
      changed,
      impactedDependents: [...impacted].sort()
    };
  });
}
