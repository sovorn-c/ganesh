// story: e04s03
// scenario: SC-e04s03-P0-01, SC-e04s03-P0-02, SC-e04s03-P0-03, SC-e04s03-P1-04

import { addImpact, dependentVersions, listImpacts } from "../branches/dependency-store.js";
import { getBranch, copyBranchSnapshot, snapshotReferences } from "../branches/branch-store.js";
import { getDecisionPacket } from "./decision-store.js";
import { listDecisionHistory } from "./decision-history-store.js";
import { listCommitments, insertCommitment } from "./commitment-store.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type BranchReference, type ImpactRecord, type ProjectHandle } from "../project/project-types.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier, newId } from "../persistence/storage-utils.js";
import { id, json, now, requireOwner, setEqual, text, uniqueIds } from "./decision-helpers.js";
import { payloadHash, historyByCommand, insertHistory } from "../persistence/history-store.js";
import type { AlternativeAdoptionRequest, AlternativeAdoptionResult, AlternativeImpact, BranchComparison, BranchDifference } from "./alternative-types.js";

function mapReferences(handle: ProjectHandle, branchId: string): Map<string, string> {
  const branch = getBranch(handle, branchId);
  return new Map(snapshotReferences(handle, branch.currentSnapshotId).map((reference) => [reference.logicalId, reference.artifactVersionId]));
}

export function compareBranchReferences(handle: ProjectHandle, sourceBranchId: string, destinationBranchId: string): BranchComparison {
  assertIdentifier(sourceBranchId, "sourceBranchId");
  assertIdentifier(destinationBranchId, "destinationBranchId");
  const source = mapReferences(handle, sourceBranchId);
  const destination = mapReferences(handle, destinationBranchId);
  const logicalIds = [...new Set([...source.keys(), ...destination.keys()])].sort();
  const differences: BranchDifference[] = [];
  for (const logicalId of logicalIds) {
    const sourceVersion = source.get(logicalId) ?? null;
    const destinationVersion = destination.get(logicalId) ?? null;
    if (sourceVersion !== destinationVersion) {
      differences.push({ logicalId, sourceArtifactVersionId: sourceVersion, destinationArtifactVersionId: destinationVersion });
    }
  }
  return { sourceBranchId, destinationBranchId, differences };
}

function selectedLogicalIds(handle: ProjectHandle, selected: readonly string[], requested: readonly string[] | undefined): string[] {
  if (requested !== undefined) {
    const ids = uniqueIds(requested, "logicalId");
    for (const logicalId of ids) {
      const row = handle.db.prepare("SELECT 1 FROM artifact_versions WHERE logical_id = ? AND id IN (" + selected.map(() => "?").join(",") + ")").get(logicalId, ...selected);
      if (row === undefined) {
        throw new ProjectStoreError("invalid-adoption", `logical ID ${logicalId} is not one of the selected packet candidates`);
      }
    }
    return ids;
  }
  const result: string[] = [];
  for (const versionId of selected) {
    const row = handle.db.prepare("SELECT logical_id FROM artifact_versions WHERE id = ?").get(versionId) as { logical_id?: unknown } | undefined;
    if (row === undefined) {
      throw new ProjectStoreError("artifact-not-found", `artifact version ${versionId} was not found`);
    }
    result.push(String(row.logical_id));
  }
  return [...new Set(result)].sort();
}

function existingAdoption(handle: ProjectHandle, commandId: string): Record<string, unknown> | undefined {
  return handle.db.prepare("SELECT * FROM alternative_adoptions WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
}

function resultFromExisting(row: Record<string, unknown>): AlternativeAdoptionResult {
  const changed = JSON.parse(text(row.changed_references, "adoption changed references")) as BranchReference[];
  const impactedDependents = JSON.parse(text(row.impacted_dependents, "adoption impacts")) as string[];
  return {
    status: "duplicate", packetId: text(row.packet_id, "adoption packet id"), sourceBranchId: text(row.source_branch_id, "source branch id"),
    destinationBranchId: text(row.destination_branch_id, "destination branch id"), revision: Number(row.destination_revision ?? 0),
    snapshotId: typeof row.destination_snapshot_id === "string" ? row.destination_snapshot_id : undefined, changed, impactedDependents,
    reason: "alternative adoption command was already applied"
  };
}

export function adoptBranchAlternative(handle: ProjectHandle, request: AlternativeAdoptionRequest): AlternativeAdoptionResult {
  assertWritable(handle);
  assertIdentifier(request.packetId, "packetId");
  assertIdentifier(request.sourceBranchId, "sourceBranchId");
  assertIdentifier(request.destinationBranchId, "destinationBranchId");
  assertIdentifier(request.commandId, "commandId");
  if (request.sourceBranchId === request.destinationBranchId) {
    throw new ProjectStoreError("invalid-adoption", "source and destination branches must differ");
  }
  const owner = requireOwner(handle, request.capability ?? request.ownerCapability, request.actor);
  const packet = getDecisionPacket(handle, request.packetId);
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${request.packetId} was not found`);
  }
  if (packet.branchId !== request.sourceBranchId) {
    return {
      status: "rejected", packetId: packet.id, sourceBranchId: request.sourceBranchId, destinationBranchId: request.destinationBranchId,
      revision: getBranch(handle, request.destinationBranchId).revision, changed: [], impactedDependents: [], reason: "packet is bound to a different source branch"
    };
  }
  if (packet.status === "archived" || packet.status === "superseded") {
    return {
      status: "rejected", packetId: packet.id, sourceBranchId: request.sourceBranchId, destinationBranchId: request.destinationBranchId,
      revision: getBranch(handle, request.destinationBranchId).revision, changed: [], impactedDependents: [], reason: `packet is ${packet.status}`
    };
  }
  const selected = uniqueIds(request.selectedCandidateVersionIds ?? request.selectedVersionIds ?? packet.candidateVersionIds, "selected candidate versionId");
  if (selected.length === 0 || !selected.every((versionId) => packet.candidateVersionIds.includes(versionId))) {
    return {
      status: "rejected", packetId: packet.id, sourceBranchId: request.sourceBranchId, destinationBranchId: request.destinationBranchId,
      revision: getBranch(handle, request.destinationBranchId).revision, changed: [], impactedDependents: [], reason: "adoption candidate is not an exact packet candidate"
    };
  }
  const source = getBranch(handle, request.sourceBranchId);
  const destination = getBranch(handle, request.destinationBranchId);
  const expectedRevision = request.expectedDestinationRevision ?? request.expectedVersion;
  const hash = payloadHash({ packetId: packet.id, sourceBranchId: source.id, destinationBranchId: destination.id, selected, logicalIds: request.logicalIds ?? null, expectedRevision: expectedRevision ?? null });
  return transaction(handle.db, () => {
    const duplicate = existingAdoption(handle, request.commandId);
    if (duplicate !== undefined) {
      if (text(duplicate.payload_hash, "adoption payload hash") !== hash) {
        return {
          status: "rejected", packetId: packet.id, sourceBranchId: source.id, destinationBranchId: destination.id,
          revision: destination.revision, changed: [], impactedDependents: [], reason: "command ID was reused with a different adoption"
        };
      }
      return resultFromExisting(duplicate);
    }
    if (expectedRevision !== undefined && destination.revision !== expectedRevision) {
      return {
        status: "stale", packetId: packet.id, sourceBranchId: source.id, destinationBranchId: destination.id,
        revision: destination.revision, changed: [], impactedDependents: [], reason: "expected destination branch revision is stale"
      };
    }
    if (source.revision !== packet.branchRevision) {
      return {
        status: "stale", packetId: packet.id, sourceBranchId: source.id, destinationBranchId: destination.id,
        revision: destination.revision, changed: [], impactedDependents: [], reason: "packet source branch revision is stale"
      };
    }
    const sourceMap = new Map(snapshotReferences(handle, source.currentSnapshotId).map((item) => [item.logicalId, item.artifactVersionId]));
    const destinationMap = new Map(snapshotReferences(handle, destination.currentSnapshotId).map((item) => [item.logicalId, item.artifactVersionId]));
    const logicalIds = selectedLogicalIds(handle, selected, request.logicalIds);
    const changed: BranchReference[] = [];
    for (const logicalId of logicalIds) {
      const artifactVersionId = sourceMap.get(logicalId);
      if (artifactVersionId === undefined || !selected.includes(artifactVersionId)) {
        throw new ProjectStoreError("invalid-adoption", `source branch does not expose selected candidate for ${logicalId}`);
      }
      if (destinationMap.get(logicalId) !== artifactVersionId) {
        changed.push({ logicalId, artifactVersionId });
      }
    }
    const nextRevision = changed.length === 0 ? destination.revision : destination.revision + 1;
    const nextSnapshot = changed.length === 0 ? destination.currentSnapshotId : newId("snapshot");
    if (changed.length > 0) {
      copyBranchSnapshot(handle, destination.currentSnapshotId, nextSnapshot, destination.id, nextRevision, "reviewed-alternative-adopted");
      for (const reference of changed) {
        handle.db.prepare(
          "INSERT INTO branch_references (snapshot_id, logical_id, artifact_version_id) VALUES (?, ?, ?) ON CONFLICT(snapshot_id, logical_id) DO UPDATE SET artifact_version_id = excluded.artifact_version_id"
        ).run(nextSnapshot, reference.logicalId, reference.artifactVersionId);
      }
    }
    const destinationReferences = snapshotReferences(handle, nextSnapshot);
    const impacted = new Set<string>();
    for (const reference of changed) {
      const candidates = dependentVersions(handle, reference.artifactVersionId);
      const previous = destinationMap.get(reference.logicalId);
      if (previous !== undefined) {
        for (const dependent of dependentVersions(handle, previous)) {
          candidates.add(dependent);
        }
      }
      for (const dependent of candidates) {
        if (destinationReferences.some((item) => item.artifactVersionId === dependent)) {
          impacted.add(dependent);
          addImpact(handle, destination.id, reference.artifactVersionId, dependent, "alternative-adoption-impact", "reviewed alternative may affect this dependent", request.commandId);
        }
      }
    }
    handle.db.prepare(
      `INSERT INTO alternative_adoptions
       (id, packet_id, source_branch_id, destination_branch_id, source_snapshot_id, destination_snapshot_id,
        changed_references, impacted_dependents, command_id, payload_hash, destination_revision, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id("adoption"), packet.id, source.id, destination.id, source.currentSnapshotId, nextSnapshot, json(changed), json([...impacted].sort()), request.commandId, hash, nextRevision, now());
    handle.db.prepare("UPDATE branches SET current_snapshot_id = ?, revision = ? WHERE id = ?").run(nextSnapshot, nextRevision, destination.id);
    insertHistory(handle, {
      branchId: destination.id, commandId: request.commandId, operation: "reviewed-alternative-adopted",
      expectedVersion: destination.revision, resultingVersion: nextRevision, sourceSnapshotId: source.currentSnapshotId,
      destinationSnapshotId: nextSnapshot, payloadHash: hash, actor: owner.ownerId
    });
    let commitmentId: string | undefined;
    const approved = listDecisionHistory(handle, { packetId: packet.id }).find((decision) => decision.disposition === "approved" && setEqual(decision.selectedCandidateVersionIds, selected));
    if (approved !== undefined) {
      commitmentId = listCommitments(handle, packet.id).find((commitment) => commitment.decisionId === approved.id)?.id;
    }
    if (commitmentId === undefined) {
      const decisionId = id("decision");
      handle.db.prepare(
        `INSERT INTO decision_records
         (id, packet_id, packet_version, disposition, selected_candidate_version_ids, dependency_version_ids,
          rationale, command_id, actor, branch_id, branch_revision, commitment_id, payload_hash, created_at)
         VALUES (?, ?, ?, 'approved', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(decisionId, packet.id, packet.packetVersion, json(selected), json(packet.dependencyVersionIds), "owner adopted reviewed alternative", `adoption-decision-${request.commandId}`, owner.ownerId, destination.id, nextRevision, hash, now());
      const commitment = insertCommitment(handle, {
        decisionId, packetId: packet.id, packetVersion: packet.packetVersion, branchId: destination.id, branchRevision: nextRevision,
        selectedCandidateVersionIds: selected, dependencyVersionIds: packet.dependencyVersionIds, actor: owner.ownerId,
        reason: "reviewed alternative adopted by owner", commandId: `adoption-${request.commandId}`
      });
      commitmentId = commitment.id;
      handle.db.prepare("UPDATE decision_records SET commitment_id = ? WHERE id = ?").run(commitment.id, decisionId);
    }
    return {
      status: "accepted", packetId: packet.id, sourceBranchId: source.id, destinationBranchId: destination.id,
      revision: nextRevision, snapshotId: nextSnapshot, changed, impactedDependents: [...impacted].sort(), commitmentId
    };
  });
}

export function listAlternativeImpact(handle: ProjectHandle, branchId?: string): readonly AlternativeImpact[] {
  return listImpacts(handle, branchId).map((impact: ImpactRecord) => ({
    ...impact, reviewStatus: impact.kind === "alternative-adoption-impact" ? "required" : "recorded"
  }));
}