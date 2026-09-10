// story: e04s02
// scenario: SC-e04s02-P0-01, SC-e04s02-P0-02, SC-e04s02-P1-03

import { ProjectStoreError, type ProjectHandle } from "./project-types.js";
import { arrayFromJson, id, json, now, rowString } from "./e04-utils.js";
import type {
  CommitmentEvent,
  CommitmentHistoryFilter,
  CommitmentRecord,
  CommitmentStatus
} from "./commitment-types.js";

export interface CommitmentInsert {
  readonly decisionId: string;
  readonly packetId: string;
  readonly packetVersion: number;
  readonly branchId: string;
  readonly branchRevision: number;
  readonly selectedCandidateVersionIds: readonly string[];
  readonly dependencyVersionIds: readonly string[];
  readonly actor: string;
  readonly reason: string;
  readonly commandId: string;
}

function commitmentFromRow(row: Record<string, unknown>): CommitmentRecord {
  return {
    id: rowString(row, "id"),
    decisionId: rowString(row, "decision_id"),
    packetId: rowString(row, "packet_id"),
    packetVersion: Number(row.packet_version),
    branchId: rowString(row, "branch_id"),
    branchRevision: Number(row.branch_revision),
    selectedCandidateVersionIds: arrayFromJson(row.selected_candidate_version_ids, "selected candidates"),
    dependencyVersionIds: arrayFromJson(row.dependency_version_ids, "dependencies"),
    status: rowString(row, "status") as CommitmentRecord["status"],
    createdAt: rowString(row, "created_at"),
    updatedAt: rowString(row, "updated_at")
  };
}

export function insertCommitment(handle: ProjectHandle, input: CommitmentInsert): CommitmentRecord {
  const commitmentId = id("commitment");
  const createdAt = now();
  handle.db.prepare(
    `INSERT INTO commitments
      (id, decision_id, packet_id, packet_version, branch_id, branch_revision,
       selected_candidate_version_ids, dependency_version_ids, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)`
  ).run(
    commitmentId,
    input.decisionId,
    input.packetId,
    input.packetVersion,
    input.branchId,
    input.branchRevision,
    json(input.selectedCandidateVersionIds),
    json(input.dependencyVersionIds),
    createdAt,
    createdAt
  );
  insertCommitmentEvent(handle, {
    commitmentId,
    packetId: input.packetId,
    eventType: "approved",
    status: "active",
    reason: input.reason,
    commandId: `commitment-${input.commandId}`,
    actor: input.actor
  });
  return getCommitment(handle, commitmentId) as CommitmentRecord;
}

export function getCommitment(handle: ProjectHandle, commitmentId: string): CommitmentRecord | null {
  const row = handle.db.prepare("SELECT * FROM commitments WHERE id = ?").get(commitmentId) as Record<string, unknown> | undefined;
  return row === undefined ? null : commitmentFromRow(row);
}

export function listCommitments(handle: ProjectHandle, packetId?: string): readonly CommitmentRecord[] {
  const rows = packetId === undefined
    ? handle.db.prepare("SELECT * FROM commitments ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM commitments WHERE packet_id = ? ORDER BY created_at, rowid").all(packetId);
  return (rows as Array<Record<string, unknown>>).map(commitmentFromRow);
}

function insertCommitmentEvent(
  handle: ProjectHandle,
  input: Omit<CommitmentEvent, "id" | "createdAt">
): void {
  handle.db.prepare(
    `INSERT INTO commitment_events
      (id, commitment_id, packet_id, event_type, status, reason, command_id, actor, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id("commitment-event"), input.commitmentId, input.packetId, input.eventType, input.status, input.reason, input.commandId, input.actor, now());
}

function eventFromRow(row: Record<string, unknown>): CommitmentEvent {
  return {
    id: rowString(row, "id"),
    commitmentId: rowString(row, "commitment_id"),
    packetId: rowString(row, "packet_id"),
    eventType: rowString(row, "event_type") as CommitmentEvent["eventType"],
    status: rowString(row, "status") as CommitmentStatus,
    reason: rowString(row, "reason"),
    commandId: rowString(row, "command_id"),
    actor: rowString(row, "actor"),
    createdAt: rowString(row, "created_at")
  };
}

export type CommitmentHistoryItem = CommitmentEvent | {
  readonly kind: "decision" | "packet-event";
  readonly id: string;
  readonly packetId: string;
  readonly eventType: string;
  readonly reason: string;
  readonly commandId: string;
  readonly actor: string;
  readonly createdAt: string;
};

export function listCommitmentHistory(handle: ProjectHandle, filter: CommitmentHistoryFilter = {}): readonly CommitmentHistoryItem[] {
  const eventPredicates: string[] = [];
  const eventParams: string[] = [];
  if (filter.commitmentId !== undefined) {
    eventPredicates.push("commitment_events.commitment_id = ?");
    eventParams.push(filter.commitmentId);
  }
  if (filter.packetId !== undefined) {
    eventPredicates.push("commitment_events.packet_id = ?");
    eventParams.push(filter.packetId);
  }
  if (filter.branchId !== undefined) {
    eventPredicates.push("commitments.branch_id = ?");
    eventParams.push(filter.branchId);
  }
  const eventWhere = eventPredicates.length === 0 ? "" : ` WHERE ${eventPredicates.join(" AND ")}`;
  const commitmentEvents = (handle.db.prepare(
    `SELECT commitment_events.* FROM commitment_events JOIN commitments ON commitments.id = commitment_events.commitment_id${eventWhere} ORDER BY commitment_events.created_at, commitment_events.rowid`
  ).all(...eventParams) as Array<Record<string, unknown>>).map(eventFromRow);

  const decisionPredicates: string[] = [];
  const decisionParams: string[] = [];
  const packetPredicates: string[] = [];
  const packetParams: string[] = [];
  if (filter.packetId !== undefined) {
    decisionPredicates.push("decision_records.packet_id = ?");
    decisionParams.push(filter.packetId);
    packetPredicates.push("decision_events.packet_id = ?");
    packetParams.push(filter.packetId);
  } else if (filter.commitmentId !== undefined) {
    decisionPredicates.push("decision_records.packet_id = (SELECT packet_id FROM commitments WHERE id = ?)");
    decisionParams.push(filter.commitmentId);
    packetPredicates.push("decision_events.packet_id = (SELECT packet_id FROM commitments WHERE id = ?)");
    packetParams.push(filter.commitmentId);
  }
  if (filter.branchId !== undefined) {
    decisionPredicates.push("decision_records.branch_id = ?");
    decisionParams.push(filter.branchId);
    packetPredicates.push("decision_packets.branch_id = ?");
    packetParams.push(filter.branchId);
  }
  const decisionWhere = decisionPredicates.length === 0 ? "" : ` WHERE ${decisionPredicates.join(" AND ")}`;
  const packetWhere = packetPredicates.length === 0 ? "" : ` WHERE ${packetPredicates.join(" AND ")}`;
  const decisions = handle.db.prepare(
    `SELECT id, packet_id, disposition, rationale, command_id, actor, created_at FROM decision_records${decisionWhere} ORDER BY decision_records.created_at, decision_records.rowid`
  ).all(...decisionParams) as Array<Record<string, unknown>>;
  const events = handle.db.prepare(
    `SELECT decision_events.id, decision_events.packet_id, decision_events.event_type, decision_events.reason, decision_events.command_id, decision_events.actor, decision_events.created_at FROM decision_events JOIN decision_packets ON decision_packets.id = decision_events.packet_id${packetWhere} ORDER BY decision_events.created_at, decision_events.rowid`
  ).all(...packetParams) as Array<Record<string, unknown>>;
  const packetItems: CommitmentHistoryItem[] = [
    ...decisions.map((row) => ({
      kind: "decision" as const, id: rowString(row, "id"), packetId: rowString(row, "packet_id"),
      eventType: rowString(row, "disposition"), reason: rowString(row, "rationale"),
      commandId: rowString(row, "command_id"), actor: rowString(row, "actor"), createdAt: rowString(row, "created_at")
    })),
    ...events.map((row) => ({
      kind: "packet-event" as const, id: rowString(row, "id"), packetId: rowString(row, "packet_id"),
      eventType: rowString(row, "event_type"), reason: rowString(row, "reason"),
      commandId: rowString(row, "command_id"), actor: rowString(row, "actor"), createdAt: rowString(row, "created_at")
    }))
  ];
  return [...commitmentEvents, ...packetItems].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}

export function setCommitmentStatus(
  handle: ProjectHandle,
  commitmentId: string,
  status: CommitmentStatus,
  eventType: CommitmentEvent["eventType"],
  reason: string,
  commandId: string,
  actor: string
): CommitmentRecord {
  const commitment = getCommitment(handle, commitmentId);
  if (commitment === null) {
    throw new ProjectStoreError("commitment-not-found", `commitment ${commitmentId} was not found`);
  }
  const existing = handle.db.prepare("SELECT id FROM commitment_events WHERE command_id = ?").get(commandId);
  if (existing !== undefined) {
    return commitment;
  }
  const updatedAt = now();
  handle.db.prepare("UPDATE commitments SET status = ?, updated_at = ? WHERE id = ?").run(status, updatedAt, commitmentId);
  insertCommitmentEvent(handle, { commitmentId, packetId: commitment.packetId, eventType, status, reason, commandId, actor });
  return getCommitment(handle, commitmentId) as CommitmentRecord;
}
