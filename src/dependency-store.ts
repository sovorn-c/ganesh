import {
  type ImpactRecord,
  type ProjectHandle,
  type SharedSourceCorrectionInput,
  ProjectStoreError
} from "./project-types.js";
import { assertWritable } from "./project-store.js";
import { historyByCommand, insertHistory, payloadHash } from "./history-store.js";
import { transaction } from "./schema.js";
import { assertIdentifier, isoNow, newId, stringValue } from "./storage-utils.js";

export function dependentVersions(handle: ProjectHandle, sourceVersionId: string): Set<string> {
  const reverse = new Map<string, string[]>();
  const rows = handle.db.prepare("SELECT artifact_version_id, dependency_version_id FROM dependencies").all() as Array<Record<string, unknown>>;
  for (const row of rows) {
    const dependent = stringValue(row.artifact_version_id, "dependent version id");
    const dependency = stringValue(row.dependency_version_id, "dependency version id");
    reverse.set(dependency, [...(reverse.get(dependency) ?? []), dependent]);
  }
  const result = new Set<string>();
  const pending = [sourceVersionId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) {
      continue;
    }
    for (const dependent of reverse.get(current) ?? []) {
      if (!result.has(dependent)) {
        result.add(dependent);
        pending.push(dependent);
      }
    }
  }
  return result;
}

export function addImpact(
  handle: ProjectHandle,
  branchId: string,
  sourceVersionId: string,
  dependentVersionId: string,
  kind: string,
  notice: string,
  commandId: string
): void {
  handle.db.prepare(
    "INSERT OR IGNORE INTO impact_records (id, branch_id, source_version_id, dependent_version_id, kind, notice, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(newId("impact"), branchId, sourceVersionId, dependentVersionId, kind, notice, commandId, isoNow());
}

function impactFromRow(row: Record<string, unknown>): ImpactRecord {
  return {
    id: stringValue(row.id, "impact id"),
    branchId: stringValue(row.branch_id, "impact branch id"),
    sourceVersionId: stringValue(row.source_version_id, "impact source version id"),
    dependentVersionId: stringValue(row.dependent_version_id, "impact dependent version id"),
    kind: stringValue(row.kind, "impact kind"),
    notice: stringValue(row.notice, "impact notice"),
    createdAt: stringValue(row.created_at, "impact creation time")
  };
}

export function listImpacts(handle: ProjectHandle, branchId?: string): readonly ImpactRecord[] {
  if (branchId !== undefined) {
    assertIdentifier(branchId, "branchId");
  }
  const rows = branchId === undefined
    ? handle.db.prepare("SELECT id, branch_id, source_version_id, dependent_version_id, kind, notice, created_at FROM impact_records ORDER BY rowid").all()
    : handle.db.prepare("SELECT id, branch_id, source_version_id, dependent_version_id, kind, notice, created_at FROM impact_records WHERE branch_id = ? ORDER BY rowid").all(branchId);
  return (rows as Array<Record<string, unknown>>).map(impactFromRow);
}

function impactsForCommand(handle: ProjectHandle, commandId: string): readonly ImpactRecord[] {
  const rows = handle.db.prepare(
    "SELECT id, branch_id, source_version_id, dependent_version_id, kind, notice, created_at FROM impact_records WHERE command_id = ? ORDER BY rowid"
  ).all(commandId) as Array<Record<string, unknown>>;
  return rows.map(impactFromRow);
}

function currentReferences(handle: ProjectHandle, snapshotId: string): readonly string[] {
  const rows = handle.db.prepare("SELECT artifact_version_id FROM branch_references WHERE snapshot_id = ?").all(snapshotId) as Array<Record<string, unknown>>;
  return rows.map((row) => stringValue(row.artifact_version_id, "branch reference version id"));
}

export function recordSharedSourceCorrection(handle: ProjectHandle, input: SharedSourceCorrectionInput): readonly ImpactRecord[] {
  assertWritable(handle);
  assertIdentifier(input.sourceVersionId, "sourceVersionId");
  assertIdentifier(input.commandId, "commandId");
  if (input.notice.trim() === "") {
    throw new ProjectStoreError("invalid-notice", "correction notice must not be empty");
  }
  const sourceExists = handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(input.sourceVersionId);
  if (sourceExists === undefined) {
    throw new ProjectStoreError("artifact-not-found", `artifact version ${input.sourceVersionId} was not found`);
  }
  const hash = payloadHash({ sourceVersionId: input.sourceVersionId, notice: input.notice });
  return transaction(handle.db, () => {
    const existing = historyByCommand(handle, input.commandId);
    if (existing !== undefined) {
      if (stringValue(existing.payload_hash, "history payload hash") !== hash) {
        throw new ProjectStoreError("duplicate-command", "command ID was reused with a different payload");
      }
      return impactsForCommand(handle, input.commandId);
    }
    const affected = dependentVersions(handle, input.sourceVersionId);
    affected.add(input.sourceVersionId);
    const branches = handle.db.prepare("SELECT id, current_snapshot_id FROM branches ORDER BY id").all() as Array<Record<string, unknown>>;
    for (const branch of branches) {
      const branchId = stringValue(branch.id, "branch id");
      const snapshotId = stringValue(branch.current_snapshot_id, "branch snapshot id");
      for (const versionId of currentReferences(handle, snapshotId)) {
        if (affected.has(versionId)) {
          addImpact(handle, branchId, input.sourceVersionId, versionId, "shared-source-correction", input.notice, input.commandId);
        }
      }
    }
    insertHistory(handle, {
      branchId: null,
      commandId: input.commandId,
      operation: "shared-source-correction",
      expectedVersion: 0,
      resultingVersion: 0,
      sourceSnapshotId: null,
      destinationSnapshotId: null,
      payloadHash: hash,
      actor: input.actor ?? "researcher"
    });
    return impactsForCommand(handle, input.commandId);
  });
}
