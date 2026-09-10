// story: e04s01
// scenario: SC-e04s01-P0-01, SC-e04s01-P0-02, SC-e04s01-P1-03

import { getBranch, snapshotReferences } from "./branch-store.js";
import { assertWritable } from "./project-store.js";
import { ProjectStoreError, type ProjectHandle } from "./project-types.js";
import { transaction } from "./schema.js";
import { assertIdentifier, newId } from "./storage-utils.js";
import {
  arrayFromJson,
  commandHash,
  id,
  json,
  now,
  requireOwner,
  setEqual,
  text,
  uniqueIds,
  valueFromJson
} from "./e04-utils.js";
import { insertCommitment } from "./commitment-store.js";
import type {
  DecisionAction,
  DecisionCandidate,
  DecisionDisposition,
  DecisionPacket,
  DecisionPacketInput,
  DecisionRecord,
  OwnerDecisionRequest,
  OwnerDecisionResult,
  ReviseDecisionPacketInput
} from "./decision-types.js";

function candidateInputs(input: DecisionPacketInput): DecisionCandidate[] {
  if (input.candidates !== undefined) {
    return input.candidates.map((candidate) => ({
      versionId: candidate.versionId,
      ...(candidate.label === undefined ? {} : { label: candidate.label }),
      ...(candidate.rationale === undefined ? {} : { rationale: candidate.rationale })
    }));
  }
  return uniqueIds(input.candidateVersionIds, "candidate versionId").map((versionId) => ({ versionId }));
}

function packetFromRow(row: Record<string, unknown>): DecisionPacket {
  const candidateVersionIds = arrayFromJson(row.candidate_version_ids, "packet candidates");
  const candidateDetails = valueFromJson<DecisionCandidate[]>(row.candidate_details, "packet candidate details");
  return {
    id: text(row.id, "packet id"),
    packetVersion: Number(row.packet_version),
    question: text(row.question, "packet question"),
    branchId: text(row.branch_id, "packet branch id"),
    snapshotId: text(row.snapshot_id, "packet snapshot id"),
    branchRevision: Number(row.branch_revision),
    candidates: candidateDetails,
    candidateVersionIds,
    dependencyVersionIds: arrayFromJson(row.dependency_version_ids, "packet dependencies"),
    reviewReferences: arrayFromJson(row.review_references, "packet review references"),
    permittedActions: arrayFromJson(row.permitted_actions, "packet permitted actions") as DecisionPacket["permittedActions"],
    status: text(row.status, "packet status") as DecisionPacket["status"],
    parentPacketId: typeof row.parent_packet_id === "string" ? row.parent_packet_id : null,
    createdAt: text(row.created_at, "packet creation time")
  };
}

function packetRow(handle: ProjectHandle, packetId: string): Record<string, unknown> | undefined {
  return handle.db.prepare("SELECT * FROM decision_packets WHERE id = ?").get(packetId) as Record<string, unknown> | undefined;
}

function requirePacket(handle: ProjectHandle, packetId: string): DecisionPacket {
  const packet = getDecisionPacket(handle, packetId);
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${packetId} was not found`);
  }
  return packet;
}

function verifySnapshot(handle: ProjectHandle, branchId: string, snapshotId: string, branchRevision: number): void {
  const row = handle.db.prepare("SELECT branch_id, revision FROM snapshots WHERE id = ?").get(snapshotId) as Record<string, unknown> | undefined;
  if (row === undefined || row.branch_id !== branchId || Number(row.revision) !== branchRevision) {
    throw new ProjectStoreError("invalid-packet", "packet snapshot does not belong to the requested branch revision");
  }
}

function insertPacket(handle: ProjectHandle, input: DecisionPacketInput, parent?: DecisionPacket, withinTransaction = false): DecisionPacket {
  assertWritable(handle);
  if (input.question.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "decision question must not be empty");
  }
  const branch = getBranch(handle, input.branchId ?? parent?.branchId ?? "main");
  const branchRevision = input.branchRevision ?? branch.revision;
  if (!Number.isInteger(branchRevision) || branchRevision < 0) {
    throw new ProjectStoreError("invalid-version", "branchRevision must be a non-negative integer");
  }
  const snapshotId = input.snapshotId ?? branch.currentSnapshotId;
  verifySnapshot(handle, branch.id, snapshotId, branchRevision);
  const candidates = candidateInputs(input);
  if (candidates.length === 0) {
    throw new ProjectStoreError("invalid-packet", "a decision packet must contain at least one candidate");
  }
  const candidateIds = uniqueIds(candidates.map((candidate) => candidate.versionId), "candidate versionId");
  if (candidateIds.length !== candidates.length) {
    throw new ProjectStoreError("invalid-packet", "candidate version IDs must be unique");
  }
  const dependencies = uniqueIds(input.dependencyVersionIds ?? input.dependencies, "dependency versionId");
  const allVersions = [...new Set([...candidateIds, ...dependencies])];
  for (const versionId of allVersions) {
    assertIdentifier(versionId, "versionId");
  }
  const candidateRows = handle.db.prepare(`SELECT id FROM artifact_versions WHERE id IN (${candidateIds.map(() => "?").join(",")})`).all(...candidateIds) as Array<Record<string, unknown>>;
  if (candidateRows.length !== candidateIds.length) {
    throw new ProjectStoreError("artifact-not-found", "a packet references an artifact version that does not exist");
  }
  const dependencyRows = dependencies.length === 0 ? [] : handle.db.prepare(`SELECT id FROM artifact_versions WHERE id IN (${dependencies.map(() => "?").join(",")})`).all(...dependencies) as Array<Record<string, unknown>>;
  if (dependencyRows.length !== dependencies.length) {
    throw new ProjectStoreError("artifact-not-found", "a packet references a dependency version that does not exist");
  }
  const packetId = input.id ?? input.packetId ?? newId("packet");
  assertIdentifier(packetId, "packetId");
  const packetVersion = input.packetVersion ?? (parent === undefined ? 1 : parent.packetVersion + 1);
  const permittedActions = [...new Set(input.permittedActions ?? ["approved", "rejected", "deferred"])] as DecisionDisposition[];
  if (permittedActions.length === 0) {
    throw new ProjectStoreError("invalid-packet", "a packet must permit at least one owner disposition");
  }
  const createdAt = now();
  const details = candidates.map((candidate) => ({
    versionId: candidate.versionId,
    ...(candidate.label === undefined ? {} : { label: candidate.label }),
    ...(candidate.rationale === undefined ? {} : { rationale: candidate.rationale })
  }));
  const persist = (): void => {
    handle.db.prepare(
      `INSERT INTO decision_packets
       (id, packet_version, question, branch_id, snapshot_id, branch_revision,
        candidate_version_ids, candidate_details, dependency_version_ids, review_references,
        permitted_actions, status, parent_packet_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'published', ?, ?)`
    ).run(
      packetId,
      packetVersion,
      input.question,
      branch.id,
      snapshotId,
      branchRevision,
      json(candidateIds),
      json(details),
      json(dependencies),
      json(input.reviewReferences ?? []),
      json(permittedActions),
      parent?.id ?? input.parentPacketId ?? null,
      createdAt
    );
  };
  if (withinTransaction) {
    persist();
  } else {
    transaction(handle.db, persist);
  }
  return requirePacket(handle, packetId);
}

export function createDecisionPacket(handle: ProjectHandle, input: DecisionPacketInput): DecisionPacket {
  if (input.parentPacketId !== undefined || (input.packetVersion !== undefined && input.packetVersion !== 1)) {
    throw new ProjectStoreError("invalid-packet", "use reviseDecisionPacket to create a packet revision");
  }
  return insertPacket(handle, input);
}

export function reviseDecisionPacketInTransaction(handle: ProjectHandle, input: ReviseDecisionPacketInput): DecisionPacket {
  assertWritable(handle);
  if (input.rationale.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "revision rationale must not be empty");
  }
  const prior = requirePacket(handle, input.priorPacketId);
  if (input.branchId !== undefined && input.branchId !== prior.branchId) {
    throw new ProjectStoreError("invalid-packet", "a decision packet revision must remain on the prior packet branch");
  }
  if (input.parentPacketId !== undefined && input.parentPacketId !== prior.id) {
    throw new ProjectStoreError("invalid-packet", "a decision packet revision must link to its prior packet");
  }
  const existing = handle.db.prepare(
    "SELECT * FROM decision_packets WHERE parent_packet_id = ? AND packet_version = ? ORDER BY created_at LIMIT 1"
  ).get(prior.id, prior.packetVersion + 1) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    return packetFromRow(existing);
  }
  return insertPacket(handle, { ...input, parentPacketId: prior.id, packetVersion: prior.packetVersion + 1 }, prior, true);
}

export function reviseDecisionPacket(handle: ProjectHandle, input: ReviseDecisionPacketInput): DecisionPacket {
  return transaction(handle.db, () => reviseDecisionPacketInTransaction(handle, input));
}

export function getDecisionPacket(handle: ProjectHandle, packetId: string): DecisionPacket | null {
  assertIdentifier(packetId, "packetId");
  const row = packetRow(handle, packetId);
  return row === undefined ? null : packetFromRow(row);
}

export function listDecisionPackets(handle: ProjectHandle, branchId?: string): readonly DecisionPacket[] {
  if (branchId !== undefined) {
    assertIdentifier(branchId, "branchId");
  }
  const rows = branchId === undefined
    ? handle.db.prepare("SELECT * FROM decision_packets ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM decision_packets WHERE branch_id = ? ORDER BY created_at, rowid").all(branchId);
  return (rows as Array<Record<string, unknown>>).map(packetFromRow);
}

function normalizeDisposition(action: DecisionAction | undefined): DecisionDisposition {
  if (action === "approve") {
    return "approved";
  }
  if (action === "reject") {
    return "rejected";
  }
  if (action === "defer") {
    return "deferred";
  }
  if (action === "approved" || action === "rejected" || action === "deferred") {
    return action;
  }
  throw new ProjectStoreError("invalid-argument", "an owner decision must specify approve, reject, or defer");
}

function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: text(row.id, "decision id"), packetId: text(row.packet_id, "decision packet id"), packetVersion: Number(row.packet_version),
    disposition: text(row.disposition, "decision disposition") as DecisionDisposition,
    selectedCandidateVersionIds: arrayFromJson(row.selected_candidate_version_ids, "selected candidates"),
    dependencyVersionIds: arrayFromJson(row.dependency_version_ids, "decision dependencies"),
    rationale: text(row.rationale, "decision rationale"), commandId: text(row.command_id, "decision command id"),
    actor: text(row.actor, "decision actor"), branchId: text(row.branch_id, "decision branch id"), branchRevision: Number(row.branch_revision),
    commitmentId: typeof row.commitment_id === "string" ? row.commitment_id : null, createdAt: text(row.created_at, "decision creation time")
  };
}

function decisionResult(status: OwnerDecisionResult["status"], packet: DecisionPacket, branchRevision: number, reason: string, decision?: DecisionRecord): OwnerDecisionResult {
  return {
    status, packetId: packet.id, packetVersion: packet.packetVersion, branchId: packet.branchId,
    branchRevision, reason,
    ...(decision === undefined ? {} : { decisionId: decision.id, commitmentId: decision.commitmentId ?? undefined, decision })
  };
}

export function recordOwnerDecision(handle: ProjectHandle, request: OwnerDecisionRequest): OwnerDecisionResult {
  assertWritable(handle);
  assertIdentifier(request.packetId, "packetId");
  assertIdentifier(request.commandId, "commandId");
  const capability = request.capability ?? request.ownerCapability;
  const owner = requireOwner(handle, capability, request.actor);
  const packet = requirePacket(handle, request.packetId);
  if (request.branchId !== undefined && request.branchId !== packet.branchId) {
    return decisionResult("rejected", packet, packet.branchRevision, "decision branch does not match the packet branch");
  }
  const disposition = normalizeDisposition(request.disposition ?? request.action);
  const selected = uniqueIds(request.selectedCandidateVersionIds ?? request.selectedVersionIds ?? request.candidateVersionIds, "selected candidate versionId");
  const dependencies = uniqueIds(request.dependencyVersionIds ?? packet.dependencyVersionIds, "dependency versionId");
  if (!packet.permittedActions.includes(disposition)) {
    return decisionResult("rejected", packet, packet.branchRevision, `packet does not permit the ${disposition} disposition`);
  }
  if (disposition === "approved" && selected.length === 0) {
    return decisionResult("rejected", packet, packet.branchRevision, "approval must identify an exact candidate version");
  }
  if (!selected.every((versionId) => packet.candidateVersionIds.includes(versionId)) || !setEqual(dependencies, packet.dependencyVersionIds)) {
    return decisionResult("rejected", packet, packet.branchRevision, "decision does not match the packet's exact candidates or dependencies");
  }
  if (request.packetVersion !== undefined && request.packetVersion !== packet.packetVersion) {
    return decisionResult("stale", packet, packet.branchRevision, "packet version is stale");
  }
  const branch = getBranch(handle, packet.branchId);
  const expectedRevision = request.expectedBranchRevision ?? request.branchRevision ?? request.expectedVersion;
  const hash = commandHash({ packetId: packet.id, packetVersion: packet.packetVersion, disposition, selected, dependencies, rationale: request.rationale ?? "" });
  return transaction(handle.db, () => {
    const existing = handle.db.prepare("SELECT * FROM decision_records WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      if (rowHash(existing) !== hash) {
        return decisionResult("rejected", packet, branch.revision, "command ID was already used with a different owner decision");
      }
      return decisionResult("duplicate", packet, branch.revision, "owner decision command was already applied", decisionFromRow(existing));
    }
    if (packet.status === "archived" || packet.status === "superseded") {
      return decisionResult("rejected", packet, branch.revision, `packet is ${packet.status} and cannot receive a decision`);
    }
    if (expectedRevision !== undefined && expectedRevision !== branch.revision) {
      return decisionResult("stale", packet, branch.revision, "expected branch revision is stale");
    }
    if (branch.revision !== packet.branchRevision) {
      return decisionResult("stale", packet, branch.revision, "packet branch snapshot is stale");
    }
    const decisionId = id("decision");
    const createdAt = now();
    handle.db.prepare(
      `INSERT INTO decision_records
       (id, packet_id, packet_version, disposition, selected_candidate_version_ids,
        dependency_version_ids, rationale, command_id, actor, branch_id, branch_revision,
        commitment_id, payload_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`
    ).run(decisionId, packet.id, packet.packetVersion, disposition, json(selected), json(dependencies), request.rationale ?? "", request.commandId, owner.ownerId, branch.id, branch.revision, hash, createdAt);
    let commitmentId: string | undefined;
    if (disposition === "approved") {
      const commitment = insertCommitment(handle, {
        decisionId, packetId: packet.id, packetVersion: packet.packetVersion,
        branchId: branch.id, branchRevision: branch.revision, selectedCandidateVersionIds: selected,
        dependencyVersionIds: dependencies, actor: owner.ownerId, reason: request.rationale ?? "owner approved exact candidate", commandId: request.commandId
      });
      commitmentId = commitment.id;
      handle.db.prepare("UPDATE decision_records SET commitment_id = ? WHERE id = ?").run(commitment.id, decisionId);
    }
    const saved = handle.db.prepare("SELECT * FROM decision_records WHERE id = ?").get(decisionId) as Record<string, unknown>;
    const decision = decisionFromRow(saved);
    return decisionResult(disposition, packet, branch.revision, disposition === "approved" ? "owner approval created a durable commitment" : `owner recorded ${disposition} disposition`, decision);
  });
}

function rowHash(row: Record<string, unknown>): string {
  return text(row.payload_hash, "decision payload hash");
}
