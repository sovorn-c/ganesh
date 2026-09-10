// story: e04s02

import type { ProjectHandle } from "./project-types.js";
import { arrayFromJson, rowString } from "./e04-utils.js";
import type { DecisionHistoryFilter, DecisionRecord } from "./decision-types.js";

function decisionFromRow(row: Record<string, unknown>): DecisionRecord {
  return {
    id: rowString(row, "id"),
    packetId: rowString(row, "packet_id"),
    packetVersion: Number(row.packet_version),
    disposition: rowString(row, "disposition") as DecisionRecord["disposition"],
    selectedCandidateVersionIds: arrayFromJson(row.selected_candidate_version_ids, "selected candidates"),
    dependencyVersionIds: arrayFromJson(row.dependency_version_ids, "decision dependencies"),
    rationale: rowString(row, "rationale"),
    actor: rowString(row, "actor"),
    branchId: rowString(row, "branch_id"),
    branchRevision: Number(row.branch_revision),
    commandId: rowString(row, "command_id"),
    commitmentId: typeof row.commitment_id === "string" ? row.commitment_id : null,
    createdAt: rowString(row, "created_at")
  };
}

export function listDecisionHistory(handle: ProjectHandle, filter: DecisionHistoryFilter = {}): readonly DecisionRecord[] {
  const predicates: string[] = [];
  const values: string[] = [];
  if (filter.packetId !== undefined) { predicates.push("packet_id = ?"); values.push(filter.packetId); }
  if (filter.branchId !== undefined) { predicates.push("branch_id = ?"); values.push(filter.branchId); }
  if (filter.commitmentId !== undefined) { predicates.push("commitment_id = ?"); values.push(filter.commitmentId); }
  const where = predicates.length === 0 ? "" : ` WHERE ${predicates.join(" AND ")}`;
  const rows = handle.db.prepare(`SELECT * FROM decision_records${where} ORDER BY created_at, rowid`).all(...values) as Array<Record<string, unknown>>;
  return rows.map(decisionFromRow);
}
