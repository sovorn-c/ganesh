// story: e04s04
// scenario: SC-e04s04-P0-01, SC-e04s04-P0-02, SC-e04s04-P1-03

import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { evaluatePolicy } from "../policy/policy-store.js";
import { checkLifecyclePolicy } from "../lifecycle/lifecycle-gate.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { getBranch, snapshotReferences } from "../branches/branch-store.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { transaction } from "../persistence/schema.js";
import { assertIdentifier } from "../persistence/storage-utils.js";
import { arrayFromJson, commandHash, id, json, now, requireOwner, setEqual, text, uniqueIds, valueFromJson } from "./decision-helpers.js";
import { createDecisionPacket, getDecisionPacket, reviseDecisionPacketInTransaction } from "./decision-store.js";
import type {
  CommitmentGateEvaluation,
  CommitmentGateRequest,
  ExternalAuthorizationStatus,
  GateResult,
  ReasonedOverride,
  ReasonedOverrideRequest,
  ReviewDisagreementRequest,
  ReviewDisagreementResult,
  ScholarlyFinding,
  ScholarlyFindingInput
} from "./override-types.js";

function findingFromRow(row: Record<string, unknown>): ScholarlyFinding {
  return {
    id: text(row.id, "finding id"), affectedVersionIds: arrayFromJson(row.affected_version_ids, "finding affected versions"),
    sourceBasis: text(row.source_basis, "finding source basis"), rationale: text(row.rationale, "finding rationale"),
    severity: text(row.severity, "finding severity"), reviewerId: text(row.reviewer_id, "finding reviewer"),
    methodologyPosition: typeof row.methodology_position === "string" ? row.methodology_position : null,
    status: text(row.status, "finding status") as ScholarlyFinding["status"], createdAt: text(row.created_at, "finding creation time")
  };
}

export function recordScholarlyFinding(handle: ProjectHandle, input: ScholarlyFindingInput): ScholarlyFinding {
  assertWritable(handle);
  const affected = uniqueIds(input.affectedVersionIds, "affected versionId");
  if (affected.length === 0 || input.sourceBasis.trim() === "" || input.rationale.trim() === "") {
    throw new ProjectStoreError("invalid-finding", "a finding requires affected versions, source basis, and rationale");
  }
  for (const versionId of affected) {
    if (handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(versionId) === undefined) {
      throw new ProjectStoreError("artifact-not-found", `artifact version ${versionId} was not found`);
    }
  }
  const findingId = input.id ?? input.findingId ?? id("finding");
  assertIdentifier(findingId, "findingId");
  const createdAt = now();
  transaction(handle.db, () => {
    handle.db.prepare(
      `INSERT INTO scholarly_findings
       (id, affected_version_ids, source_basis, rationale, severity, reviewer_id, methodology_position, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?)`
    ).run(findingId, json(affected), input.sourceBasis, input.rationale, input.severity ?? "medium", input.reviewerId ?? input.actor ?? "reviewer", input.methodologyPosition ?? null, createdAt);
  });
  return getScholarlyFinding(handle, findingId) as ScholarlyFinding;
}

export function getScholarlyFinding(handle: ProjectHandle, findingId: string): ScholarlyFinding | null {
  assertIdentifier(findingId, "findingId");
  const row = handle.db.prepare("SELECT * FROM scholarly_findings WHERE id = ?").get(findingId) as Record<string, unknown> | undefined;
  return row === undefined ? null : findingFromRow(row);
}

export function listScholarlyFindings(handle: ProjectHandle): readonly ScholarlyFinding[] {
  return (handle.db.prepare("SELECT * FROM scholarly_findings ORDER BY created_at, rowid").all() as Array<Record<string, unknown>>).map(findingFromRow);
}

function overrideFromRow(row: Record<string, unknown>): ReasonedOverride {
  return {
    id: text(row.id, "override id"), findingId: text(row.finding_id, "override finding id"), packetId: text(row.packet_id, "override packet id"),
    selectedCandidateVersionIds: arrayFromJson(row.selected_candidate_version_ids, "override candidates"), ownerRationale: text(row.owner_rationale, "override rationale"),
    dissent: text(row.dissent, "override dissent"), uncertainty: text(row.uncertainty, "override uncertainty"), actor: text(row.actor, "override actor"),
    status: text(row.status, "override status") as ReasonedOverride["status"], createdAt: text(row.created_at, "override creation time")
  };
}

export function recordReasonedOverride(handle: ProjectHandle, request: ReasonedOverrideRequest): ReasonedOverride {
  assertWritable(handle);
  assertIdentifier(request.findingId, "findingId");
  assertIdentifier(request.packetId, "packetId");
  assertIdentifier(request.commandId, "commandId");
  const owner = requireOwner(handle, request.capability ?? request.ownerCapability, request.actor);
  const finding = getScholarlyFinding(handle, request.findingId);
  const packet = getDecisionPacket(handle, request.packetId);
  if (finding === null) {
    throw new ProjectStoreError("finding-not-found", `finding ${request.findingId} was not found`);
  }
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${request.packetId} was not found`);
  }
  if (request.rationale.trim() === "") {
    throw new ProjectStoreError("invalid-override", "override rationale must not be empty");
  }
  const selected = uniqueIds(request.selectedCandidateVersionIds ?? (request.candidateVersionId === undefined ? packet.candidateVersionIds : [request.candidateVersionId]), "candidate versionId");
  if (selected.length === 0 || !selected.every((versionId) => packet.candidateVersionIds.includes(versionId)) || !selected.some((versionId) => finding.affectedVersionIds.includes(versionId))) {
    throw new ProjectStoreError("invalid-override", "override must identify an exact packet candidate affected by the finding");
  }
  const hash = commandHash({ findingId: finding.id, packetId: packet.id, selected, rationale: request.rationale, uncertainty: request.uncertainty ?? "", dissent: request.dissent ?? "" });
  return transaction(handle.db, () => {
    const existing = handle.db.prepare("SELECT * FROM reasoned_overrides WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
    if (existing !== undefined) {
      if (text(existing.payload_hash, "override payload hash") !== hash) {
        throw new ProjectStoreError("duplicate-command", "override command ID was reused with a different payload");
      }
      return overrideFromRow(existing);
    }
    const priorOverride = handle.db.prepare("SELECT id FROM reasoned_overrides WHERE finding_id = ? AND packet_id = ? LIMIT 1").get(finding.id, packet.id);
    if (priorOverride !== undefined) {
      throw new ProjectStoreError("invalid-override", "only one reasoned override is permitted for a finding and packet");
    }
    const overrideId = id("override");
    handle.db.prepare(
      `INSERT INTO reasoned_overrides
       (id, finding_id, packet_id, selected_candidate_version_ids, owner_rationale, dissent, uncertainty, actor, status, command_id, payload_hash, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'recorded', ?, ?, ?)`
    ).run(overrideId, finding.id, packet.id, json(selected), request.rationale, request.dissent ?? finding.methodologyPosition ?? "", request.uncertainty ?? "", owner.ownerId, request.commandId, hash, now());
    handle.db.prepare("UPDATE scholarly_findings SET status = 'retained' WHERE id = ?").run(finding.id);
    return overrideFromRow(handle.db.prepare("SELECT * FROM reasoned_overrides WHERE id = ?").get(overrideId) as Record<string, unknown>);
  });
}

export function listReasonedOverrides(handle: ProjectHandle, packetId?: string): readonly ReasonedOverride[] {
  const rows = packetId === undefined
    ? handle.db.prepare("SELECT * FROM reasoned_overrides ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT * FROM reasoned_overrides WHERE packet_id = ? ORDER BY created_at, rowid").all(packetId);
  return (rows as Array<Record<string, unknown>>).map(overrideFromRow);
}

function ownerGate(handle: ProjectHandle, capability: unknown, actor?: string): GateResult {
  const passed = isOwnerCapability(capability) && capability.ownerId === handle.project.ownerId && (actor === undefined || actor === capability.ownerId);
  return { gate: "identity", passed, reason: passed ? "trusted project owner identity verified" : "only the trusted project owner can pass this gate" };
}

function authorizationEvidence(value: CommitmentGateRequest["externalAuthorization"], destination: string | undefined): { readonly status: ExternalAuthorizationStatus; readonly basis: string } {
  if (destination === undefined) {
    return { status: "not-required", basis: "local action" };
  }
  if (value === undefined) {
    return { status: "unknown", basis: "" };
  }
  return typeof value === "string" ? { status: value, basis: "" } : { status: value.status, basis: value.basis ?? "" };
}

function gateResult(gate: GateResult["gate"], passed: boolean, reason: string): GateResult {
  return { gate, passed, reason };
}

export function evaluateCommitmentGates(handle: ProjectHandle, request: CommitmentGateRequest): CommitmentGateEvaluation {
  assertIdentifier(request.packetId, "packetId");
  const packet = getDecisionPacket(handle, request.packetId);
  const selected = uniqueIds(request.selectedCandidateVersionIds ?? request.candidateVersionIds ?? packet?.candidateVersionIds, "candidate versionId");
  const identity = ownerGate(handle, request.capability ?? request.ownerCapability, request.actor);
  const gates: GateResult[] = [identity];
  let branchId = request.branchId ?? packet?.branchId;
  let provenancePassed = packet !== null && selected.length > 0 && selected.every((versionId) => packet.candidateVersionIds.includes(versionId));
  if (packet !== null && branchId === packet.branchId) {
    const branch = getBranch(handle, packet.branchId);
    provenancePassed = provenancePassed && branch.revision === packet.branchRevision;
    const references = snapshotReferences(handle, branch.currentSnapshotId);
    for (const versionId of selected) {
      const row = handle.db.prepare("SELECT logical_id FROM artifact_versions WHERE id = ?").get(versionId) as { logical_id?: unknown } | undefined;
      provenancePassed = provenancePassed && row !== undefined && references.some((reference) => reference.logicalId === row.logical_id && reference.artifactVersionId === versionId);
    }
  } else {
    provenancePassed = false;
  }
  if (packet !== null) {
    for (const versionId of [...new Set([...selected, ...packet.dependencyVersionIds])]) {
      if (handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(versionId) === undefined) {
        provenancePassed = false;
      }
    }
  }
  gates.push(gateResult("provenance", provenancePassed, provenancePassed ? "candidate and dependency IDs match the immutable packet snapshot" : "candidate or packet snapshot does not match the exact reviewed provenance"));

  let privacyPassed = true;
  let privacyReason = "local commitment does not disclose material";
  if (request.destination !== undefined || request.purpose !== undefined) {
    if (packet === null || request.destination === undefined || request.purpose === undefined) {
      privacyPassed = false;
      privacyReason = "destination and purpose are required for a disclosure gate";
    } else {
      const policy = evaluatePolicy(handle, {
        inputVersions: [...new Set([...selected, ...packet.dependencyVersionIds])], destination: request.destination, purpose: request.purpose,
        branchId: branchId ?? packet.branchId, actor: request.actor
      });
      privacyPassed = policy.result === "allow";
      privacyReason = policy.result === "allow" ? "current policy permits the exact material and purpose" : policy.reason;
    }
  }
  gates.push(gateResult("privacy", privacyPassed, privacyReason));
  let safetyPassed = identity.passed && selected.length > 0;
  let safetyReason = safetyPassed ? "owner-only bounded commitment path is selected" : "untrusted or empty execution path is not permitted";
  if (safetyPassed && request.operationId !== undefined) {
    try {
      const checkpoint = checkLifecyclePolicy(handle, request.operationId, request.lifecyclePhase ?? "acceptance", {
        capability: request.capability ?? request.ownerCapability, destination: request.destination, purpose: request.purpose,
        actor: request.actor, expectedVersionIds: selected
      });
      safetyPassed = checkpoint.status === "passed";
      safetyReason = checkpoint.reason;
    } catch (error: unknown) {
      safetyPassed = false;
      safetyReason = error instanceof Error ? error.message : "lifecycle safety check failed";
    }
  }
  gates.push(gateResult("execution-safety", safetyPassed, safetyReason));
  const authorization = authorizationEvidence(request.externalAuthorization, request.destination);
  const authPassed = authorization.status === "documented-approved" ||
    (authorization.status === "not-required" && authorization.basis.trim() !== "");
  gates.push(gateResult("external-authorization", authPassed, authPassed ? "external authorization is documented or not required" : `external authorization status is ${authorization.status}${authorization.basis === "" ? " without a basis" : ""}`));
  const readinessPassed = packet !== null && packet.status !== "archived" && packet.status !== "superseded" && provenancePassed;
  gates.push(gateResult("readiness", readinessPassed, readinessPassed ? "packet is current and eligible for a bounded decision" : "packet is not current and ready for commitment"));

  const allowed = gates.every((gate) => gate.passed);
  const result: CommitmentGateEvaluation = {
    allowed, status: allowed ? "passed" : "blocked", packetId: request.packetId, candidateVersionIds: selected, gates,
    reason: allowed ? "all non-waivable commitment gates passed" : gates.filter((gate) => !gate.passed).map((gate) => `${gate.gate}: ${gate.reason}`).join("; ")
  };
  if (handle.writable && handle.status === "ready") {
    transaction(handle.db, () => {
      for (const gate of gates) {
        handle.db.prepare(
          "INSERT INTO commitment_gate_results (id, packet_id, override_id, gate, passed, reason, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(id("gate"), request.packetId, request.overrideId ?? null, gate.gate, gate.passed ? 1 : 0, gate.reason, request.commandId ?? null, now());
      }
    });
  }
  return result;
}

export function listCommitmentGateResults(handle: ProjectHandle, packetId?: string): readonly GateResult[] {
  const rows = packetId === undefined
    ? handle.db.prepare("SELECT gate, passed, reason FROM commitment_gate_results ORDER BY created_at, rowid").all()
    : handle.db.prepare("SELECT gate, passed, reason FROM commitment_gate_results WHERE packet_id = ? ORDER BY created_at, rowid").all(packetId);
  return (rows as Array<Record<string, unknown>>).map((row) => ({
    gate: text(row.gate, "gate") as GateResult["gate"], passed: Number(row.passed) === 1, reason: text(row.reason, "gate reason")
  }));
}

export function resolveReviewDisagreement(handle: ProjectHandle, request: ReviewDisagreementRequest): ReviewDisagreementResult {
  assertWritable(handle);
  assertIdentifier(request.findingId, "findingId");
  assertIdentifier(request.packetId, "packetId");
  assertIdentifier(request.commandId, "commandId");
  const finding = getScholarlyFinding(handle, request.findingId);
  const packet = getDecisionPacket(handle, request.packetId);
  if (finding === null) {
    throw new ProjectStoreError("finding-not-found", `finding ${request.findingId} was not found`);
  }
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${request.packetId} was not found`);
  }
  const reviewerPosition = finding.rationale;
  const methodologyPosition = finding.methodologyPosition ?? "methodology position was not separately recorded";
  return transaction(handle.db, () => {
    const priorRevisions = handle.db.prepare("SELECT COUNT(*) AS count FROM review_revisions WHERE finding_id = ?").get(finding.id) as { count?: unknown };
    const revisionCount = Number(priorRevisions.count ?? 0);
    const existingCommand = handle.db.prepare("SELECT id FROM review_revisions WHERE command_id = ?").get(request.commandId);
    if (existingCommand !== undefined) {
      return { status: "duplicate", findingId: finding.id, packetId: packet.id, revisionCount, reviewerPosition, methodologyPosition, reason: "disagreement command was already applied" };
    }
    if (revisionCount >= 1 || request.blockerPersists === true || request.action === "return-to-owner") {
      return { status: "owner-decision-required", findingId: finding.id, packetId: packet.id, revisionCount, reviewerPosition, methodologyPosition, reason: "one bounded revision was exhausted or the blocker persists; owner decision is required" };
    }
    const replacement = reviseDecisionPacketInTransaction(handle, {
      priorPacketId: packet.id, question: `${packet.question} (review revision)`, branchId: packet.branchId,
      candidateVersionIds: packet.candidateVersionIds, dependencyVersionIds: packet.dependencyVersionIds,
      reviewReferences: [...packet.reviewReferences, `finding:${finding.id}`], permittedActions: packet.permittedActions,
      rationale: request.rationale ?? "review disagreement revision"
    });
    handle.db.prepare(
      `INSERT INTO review_revisions
       (id, finding_id, prior_packet_id, replacement_packet_id, reviewer_position, methodology_position, rationale, command_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id("review-revision"), finding.id, packet.id, replacement.id, reviewerPosition, methodologyPosition, request.rationale ?? "review disagreement revision", request.commandId, now());
    return {
      status: "revised", findingId: finding.id, packetId: packet.id, replacementPacketId: replacement.id, revisionCount: revisionCount + 1,
      reviewerPosition, methodologyPosition, reason: "one bounded review revision was created; further disagreement returns to the owner"
    };
  });
}