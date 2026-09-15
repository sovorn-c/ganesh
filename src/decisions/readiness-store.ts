// story: e04s02

import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { getBranch, snapshotReferences } from "../branches/branch-store.js";
import { evaluatePolicy } from "../policy/policy-store.js";
import { assessActivityAuthorization } from "../ethics/authorization-assessment.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { transaction } from "../persistence/schema.js";
import { arrayFromJson, id, json, now, rowString } from "./decision-helpers.js";
import { getCommitment, listCommitments } from "./commitment-store.js";
import type { CommitmentRecord, ReadinessAssessment, ReadinessRequest } from "./commitment-types.js";

function packetStatus(handle: ProjectHandle, packetId: string): string {
  const row = handle.db.prepare("SELECT status FROM decision_packets WHERE id = ?").get(packetId) as Record<string, unknown> | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${packetId} was not found`);
  }
  return rowString(row, "status");
}

export function assessReadiness(handle: ProjectHandle, request: ReadinessRequest): ReadinessAssessment {
  assertWritable(handle);
  let commitment: CommitmentRecord | null = request.commitmentId === undefined ? null : getCommitment(handle, request.commitmentId);
  if (commitment === null && request.packetId !== undefined) {
    commitment = listCommitments(handle, request.packetId).find((item) => item.status === "active") ?? null;
  }
  if (commitment === null) {
    throw new ProjectStoreError("commitment-not-found", "a commitmentId or an active packet commitment is required");
  }
  const packetStatusValue = packetStatus(handle, commitment.packetId);
  const requestedBranchId = request.branchId ?? commitment.branchId;
  if (requestedBranchId !== commitment.branchId) {
    throw new ProjectStoreError("invalid-argument", "readiness must be assessed against the commitment branch");
  }
  const branch = getBranch(handle, requestedBranchId);
  const action = request.action ?? "commitment-review";
  const allVersions = [...new Set([...commitment.selectedCandidateVersionIds, ...commitment.dependencyVersionIds])];
  const causes: string[] = [];
  const affectedVersionIds = new Set<string>();
  let authorizationBlocked = false;
  if (branch.revision !== commitment.branchRevision) {
    causes.push("current branch revision differs from the approved commitment");
  }
  const references = new Map(snapshotReferences(handle, branch.currentSnapshotId).map((item) => [item.logicalId, item.artifactVersionId]));
  for (const versionId of commitment.selectedCandidateVersionIds) {
    const row = handle.db.prepare("SELECT logical_id FROM artifact_versions WHERE id = ?").get(versionId) as { logical_id?: unknown } | undefined;
    if (row === undefined) {
      causes.push(`approved candidate ${versionId} is unavailable`);
      affectedVersionIds.add(versionId);
      continue;
    }
    if (references.get(String(row.logical_id)) !== versionId) {
      causes.push(`approved candidate ${versionId} is not the current branch reference`);
      affectedVersionIds.add(versionId);
    }
  }
  for (const versionId of allVersions) {
    try {
      const inspection = inspectArtifactVersion(handle, versionId);
      if (inspection.contentStatus !== "available") {
        causes.push(`${versionId} content is ${inspection.contentStatus}`);
        affectedVersionIds.add(versionId);
      }
    } catch (error: unknown) {
      if (error instanceof ProjectStoreError && error.code === "artifact-not-found") {
        causes.push(`${versionId} content is unavailable`);
        affectedVersionIds.add(versionId);
      } else {
        throw error;
      }
    }
  }
  const impactRows = handle.db.prepare(
    `SELECT source_version_id, dependent_version_id FROM impact_records
     WHERE branch_id = ? AND dependent_version_id IN (${allVersions.map(() => "?").join(",")})`
  ).all(branch.id, ...allVersions) as Array<Record<string, unknown>>;
  for (const impact of impactRows) {
    causes.push(`recorded dependency impact affects ${rowString(impact, "dependent_version_id")}`);
    affectedVersionIds.add(rowString(impact, "dependent_version_id"));
    affectedVersionIds.add(rowString(impact, "source_version_id"));
  }
  if (request.destination !== undefined || request.purpose !== undefined) {
    if (request.destination === undefined || request.purpose === undefined) {
      causes.push("policy context incomplete");
      for (const versionId of allVersions) {
        affectedVersionIds.add(versionId);
      }
    } else {
      const policy = evaluatePolicy(handle, { inputVersions: allVersions, destination: request.destination, purpose: request.purpose, branchId: branch.id, actor: request.actor });
      if (policy.result !== "allow") {
        causes.push(`current policy denied readiness: ${policy.reason}`);
        for (const versionId of allVersions) {
          affectedVersionIds.add(versionId);
        }
      }
    }
  }
  if (request.activity !== undefined) {
    const authorization = assessActivityAuthorization(handle, {
      activity: request.activity,
      population: request.population,
      dataClasses: request.dataClasses,
      dataUse: request.dataUse,
      destination: request.destination,
      purpose: request.purpose,
      conditions: request.conditions,
      requireExplicitScope: true
    });
    if (!authorization.permitted) {
      authorizationBlocked = authorization.status !== "needs-review";
      causes.push(`current external authorization denied readiness: ${authorization.reason}`);
      for (const versionId of allVersions) {
        affectedVersionIds.add(versionId);
      }
    }
  }
  if (packetStatusValue === "archived" || packetStatusValue === "superseded") {
    causes.push(`packet is ${packetStatusValue}`);
  }
  const status = authorizationBlocked || causes.some((cause) => /content is unavailable|content is missing|content is corrupt|policy context incomplete|policy denied|packet is/.test(cause)) ? "blocked" : causes.length > 0 ? "needs-review" : "ready";
  const reason = status === "ready" ? "approved commitment is ready under the current project state" : causes.join("; ");
  const nextAction = status === "ready" ? "proceed" : status === "needs-review" ? "review impacted versions and issue a new decision if needed" : /external authorization/.test(reason) ? "obtain or revalidate external authorization" : /policy denied/.test(reason) ? "revalidate current policy" : /content is/.test(reason) ? "restore or replace unavailable evidence" : "resolve the blocking condition before use";
  const createdAt = now();
  const assessmentId = id("readiness");
  const commandId = request.commandId ?? `readiness-${assessmentId}`;
  const existing = handle.db.prepare("SELECT id FROM readiness_assessments WHERE command_id = ?").get(commandId) as { id?: unknown } | undefined;
  if (existing !== undefined) {
    return readinessFromRow(handle.db.prepare("SELECT * FROM readiness_assessments WHERE id = ?").get(String(existing.id)) as Record<string, unknown>);
  }
  transaction(handle.db, () => {
    handle.db.prepare(
      `INSERT INTO readiness_assessments
       (id, commitment_id, packet_id, branch_id, action, status, reason, causes, affected_version_ids, next_action, command_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(assessmentId, commitment.id, commitment.packetId, branch.id, action, status, reason, json(causes), json([...affectedVersionIds].sort()), nextAction, commandId, createdAt);
  });
  return readinessFromRow(handle.db.prepare("SELECT * FROM readiness_assessments WHERE id = ?").get(assessmentId) as Record<string, unknown>);
}

function readinessFromRow(row: Record<string, unknown>): ReadinessAssessment {
  return {
    id: rowString(row, "id"), commitmentId: rowString(row, "commitment_id"), packetId: rowString(row, "packet_id"), branchId: rowString(row, "branch_id"), action: rowString(row, "action"),
    status: rowString(row, "status") as ReadinessAssessment["status"], reason: rowString(row, "reason"), causes: arrayFromJson(row.causes, "readiness causes"), affectedVersionIds: arrayFromJson(row.affected_version_ids, "readiness affected versions"),
    nextAction: rowString(row, "next_action"), createdAt: rowString(row, "created_at")
  };
}

export function listReadiness(handle: ProjectHandle, filter: { readonly commitmentId?: string; readonly packetId?: string } = {}): readonly ReadinessAssessment[] {
  const where = filter.commitmentId !== undefined ? " WHERE commitment_id = ?" : filter.packetId !== undefined ? " WHERE packet_id = ?" : "";
  const value = filter.commitmentId ?? filter.packetId;
  const rows = (value === undefined ? handle.db.prepare("SELECT * FROM readiness_assessments ORDER BY created_at, rowid").all() : handle.db.prepare(`SELECT * FROM readiness_assessments${where} ORDER BY created_at, rowid`).all(value)) as Array<Record<string, unknown>>;
  return rows.map(readinessFromRow);
}
