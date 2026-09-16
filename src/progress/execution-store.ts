import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import type { ReportedExecutionRecord, ReportedExecutionRequest } from "./progress-types.js";
import {
  assertBranch,
  assertReferenceIds,
  assertProgressAccess,
  assertProgressSchema,
  hashPayload,
  isoNow,
  newId,
  requiredText,
  resolveAttribution,
  resolveOrigin
} from "./progress-utils.js";

function executionFromRow(row: Record<string, unknown>): ReportedExecutionRecord {
  return {
    id: String(row.id),
    protocolVersionId: String(row.protocol_version_id),
    summary: String(row.summary),
    evidenceVersionIds: JSON.parse(String(row.evidence_version_ids ?? "[]")),
    reproduced: false,
    attribution: String(row.attribution) as ReportedExecutionRecord["attribution"],
    origin: String(row.origin) as ReportedExecutionRecord["origin"],
    artifactVersionId: String(row.artifact_version_id),
    commandId: String(row.command_id),
    branchId: String(row.branch_id),
    createdAt: String(row.created_at)
  };
}

function executionById(handle: ProjectHandle, id: string): ReportedExecutionRecord {
  const row = handle.db.prepare("SELECT * FROM reported_execution_evidence WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `reported execution ${id} was not found`);
  }
  return executionFromRow(row);
}

function protocolBranch(handle: ProjectHandle, protocolVersionId: string): string {
  const row = handle.db.prepare("SELECT branch_id FROM protocol_versions WHERE id = ?").get(protocolVersionId) as { branch_id?: unknown } | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `protocol version ${protocolVersionId} was not found`);
  }
  return assertBranch(handle, String(row.branch_id));
}

export function recordReportedExecution(
  handle: ProjectHandle,
  capability: unknown,
  request: ReportedExecutionRequest
): ReportedExecutionRecord {
  assertWritable(handle);
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:record");
  assertIdentifier(request.protocolVersionId, "protocolVersionId");
  const summary = requiredText(request.summary, "summary");
  const evidenceVersionIds = assertReferenceIds(handle, request.evidenceVersionIds, "evidenceVersionId");
  const protocolBranchId = protocolBranch(handle, request.protocolVersionId);
  const branchId = assertBranch(handle, request.branchId ?? protocolBranchId);
  if (branchId !== protocolBranchId) {
    throw new ProjectStoreError("forbidden", "reported execution must use the protocol version branch");
  }
  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd");
  assertIdentifier(commandId, "commandId");
  const payloadHash = hashPayload({
    protocolVersionId: request.protocolVersionId,
    summary,
    evidenceVersionIds,
    reproduced: false,
    attribution,
    origin,
    branchId
  });
  const existing = handle.db.prepare("SELECT kind, payload_hash, entity_id FROM progress_operations WHERE command_id = ?").get(commandId) as
    | { kind?: unknown; payload_hash?: unknown; entity_id?: unknown }
    | undefined;
  if (existing) {
    if (existing.kind !== "reported-execution" || existing.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", "command payload does not match prior invocation");
    }
    return executionById(handle, String(existing.entity_id));
  }
  const id = newId("execution");
  const createdAt = isoNow();
  const artifact = registerArtifactVersion(handle, {
    logicalId: `reported-execution-${id}`,
    version: "1.0",
    content: JSON.stringify({ protocolVersionId: request.protocolVersionId, summary, evidenceVersionIds, reproduced: false }),
    origin: "reported-execution",
    access: "metadata-only"
  });
  try {
    transaction(handle.db, () => {
      handle.db.prepare(`
        INSERT INTO reported_execution_evidence (
          id, protocol_version_id, summary, evidence_version_ids, reproduced, attribution, origin,
          artifact_version_id, command_id, branch_id, created_at
        ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        request.protocolVersionId,
        summary,
        JSON.stringify(evidenceVersionIds),
        attribution,
        origin,
        artifact.id,
        commandId,
        branchId,
        createdAt
      );
      handle.db.prepare(`
        INSERT INTO progress_operations (command_id, kind, payload_hash, status, entity_id, created_at, updated_at)
        VALUES (?, 'reported-execution', ?, 'complete', ?, ?, ?)
      `).run(commandId, payloadHash, id, createdAt, createdAt);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifact.id);
    throw error;
  }
  return executionById(handle, id);
}

export function inspectReportedExecution(
  handle: ProjectHandle,
  capability: unknown,
  protocolVersionId?: string
): readonly ReportedExecutionRecord[] {
  handle.assertCurrent();
  assertProgressSchema(handle);
  assertProgressAccess(handle, capability, "progress:inspect");
  const rows = protocolVersionId === undefined
    ? handle.db.prepare("SELECT * FROM reported_execution_evidence ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM reported_execution_evidence WHERE protocol_version_id = ? ORDER BY created_at, rowid").all(protocolVersionId);
  return (rows as Array<Record<string, unknown>>).map(executionFromRow);
}
