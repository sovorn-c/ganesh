import {
  type BranchMutationResult,
  type HistoryRecord,
  type ProjectHandle
} from "./project-types.js";
import { isoNow, newId, numberValue, sha256, stringValue } from "./storage-utils.js";

export type HistoryRow = Record<string, unknown>;

export function payloadHash(payload: unknown): string {
  return sha256(new TextEncoder().encode(JSON.stringify(payload)));
}

export function historyByCommand(handle: ProjectHandle, commandId: string): HistoryRow | undefined {
  return handle.db.prepare(
    "SELECT id, branch_id, command_id, operation, expected_revision, resulting_revision, source_snapshot_id, destination_snapshot_id, payload_hash, actor, created_at FROM history WHERE command_id = ?"
  ).get(commandId) as HistoryRow | undefined;
}

export function historyFromRow(row: HistoryRow): HistoryRecord {
  return {
    id: stringValue(row.id, "history id"),
    branchId: typeof row.branch_id === "string" ? row.branch_id : null,
    commandId: stringValue(row.command_id, "history command id"),
    operation: stringValue(row.operation, "history operation"),
    expectedVersion: numberValue(row.expected_revision, "history expected revision"),
    resultingVersion: numberValue(row.resulting_revision, "history resulting revision"),
    sourceSnapshotId: typeof row.source_snapshot_id === "string" ? row.source_snapshot_id : null,
    destinationSnapshotId: typeof row.destination_snapshot_id === "string" ? row.destination_snapshot_id : null,
    payloadHash: stringValue(row.payload_hash, "history payload hash"),
    actor: stringValue(row.actor, "history actor"),
    createdAt: stringValue(row.created_at, "history creation time")
  };
}

export function insertHistory(
  handle: ProjectHandle,
  values: {
    readonly branchId: string | null;
    readonly commandId: string;
    readonly operation: string;
    readonly expectedVersion: number;
    readonly resultingVersion: number;
    readonly sourceSnapshotId: string | null;
    readonly destinationSnapshotId: string | null;
    readonly payloadHash: string;
    readonly actor: string;
  }
): void {
  handle.db.prepare(
    "INSERT INTO history (id, branch_id, command_id, operation, expected_revision, resulting_revision, source_snapshot_id, destination_snapshot_id, payload_hash, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(
    newId("history"),
    values.branchId,
    values.commandId,
    values.operation,
    values.expectedVersion,
    values.resultingVersion,
    values.sourceSnapshotId,
    values.destinationSnapshotId,
    values.payloadHash,
    values.actor,
    isoNow()
  );
}

export function existingMutationResult(existing: HistoryRow, expectedPayloadHash: string, branchId: string): BranchMutationResult {
  const existingHash = stringValue(existing.payload_hash, "history payload hash");
  const revision = numberValue(existing.resulting_revision, "history resulting revision");
  return {
    status: existingHash === expectedPayloadHash ? "duplicate" : "rejected",
    branchId,
    revision,
    snapshotId: typeof existing.destination_snapshot_id === "string" ? existing.destination_snapshot_id : undefined,
    reason: existingHash === expectedPayloadHash ? "command already applied" : "command ID was reused with a different payload"
  };
}

export function listHistory(handle: ProjectHandle, branchId?: string): readonly HistoryRecord[] {
  const rows = branchId === undefined
    ? handle.db.prepare("SELECT id, branch_id, command_id, operation, expected_revision, resulting_revision, source_snapshot_id, destination_snapshot_id, payload_hash, actor, created_at FROM history ORDER BY rowid").all()
    : handle.db.prepare("SELECT id, branch_id, command_id, operation, expected_revision, resulting_revision, source_snapshot_id, destination_snapshot_id, payload_hash, actor, created_at FROM history WHERE branch_id = ? ORDER BY rowid").all(branchId);
  return (rows as HistoryRow[]).map(historyFromRow);
}
