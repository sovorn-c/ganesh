import { registerArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import {
  assertWritable,
  type ProjectHandle,
} from "../project/project-store.js";
import { ProjectStoreError } from "../project/project-types.js";
import { getReviewProtocol } from "./literature-store.js";
import type {
  EligibilityAmendment,
  EligibilityAmendmentRequest,
  ScreeningCounts,
  ScreeningDecision,
  ScreeningDecisionRequest,
  UncertaintyQueueEntry,
} from "./literature-types.js";
import {
  allowed,
  assertLiteratureSchema,
  beginOperation,
  completeOperation,
  json,
  operation,
  parse,
  payloadHash,
  recordId,
  requireCapability,
  requireCommand,
  requireText,
  stableObject,
  text,
} from "./literature-utils.js";

function decisionRow(row: Record<string, unknown>): ScreeningDecision {
  const superseded =
    typeof row.superseded_by_decision_id === "string"
      ? row.superseded_by_decision_id
      : undefined;
  return {
    id: text(row, "id"),
    corpusRecordId: text(row, "corpus_record_id"),
    protocolVersionId: text(row, "protocol_version_id"),
    criterionId: text(row, "criterion_id"),
    decision: text(row, "decision") as ScreeningDecision["decision"],
    reason: text(row, "reason"),
    ...(superseded ? { supersededByDecisionId: superseded } : {}),
    createdAt: text(row, "created_at"),
  };
}
function queueRow(row: Record<string, unknown>): UncertaintyQueueEntry {
  const resolved =
    typeof row.resolved_by_decision_id === "string"
      ? row.resolved_by_decision_id
      : undefined;
  return {
    id: text(row, "id"),
    decisionId: text(row, "decision_id"),
    corpusRecordId: text(row, "corpus_record_id"),
    status: text(row, "status") as UncertaintyQueueEntry["status"],
    ...(resolved ? { resolvedByDecisionId: resolved } : {}),
    createdAt: text(row, "created_at"),
  };
}
function row(
  handle: ProjectHandle,
  table: string,
  id: string,
): Record<string, unknown> {
  const found = handle.db
    .prepare(`SELECT * FROM ${table} WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!found) {
    throw new ProjectStoreError(
      "literature-not-found",
      `${table} record was not found`,
    );
  }
  return found;
}
function ensureDecisionRequest(request: ScreeningDecisionRequest): void {
  requireText(request.corpusRecordId, "corpusRecordId");
  requireText(request.protocolVersionId, "protocolVersionId");
  requireText(request.criterionId, "criterionId");
  requireText(request.reason, "reason");
  if (!["include", "exclude", "uncertain"].includes(request.decision)) {
    throw new ProjectStoreError(
      "invalid-screening",
      "screening decision must be include, exclude or uncertain",
    );
  }
  if (
    request.saturated === true ||
    request.stopRule !== undefined ||
    (request.paperCount !== undefined && request.stopRule !== undefined)
  ) {
    throw new ProjectStoreError(
      "unjustified-threshold",
      "universal saturation and paper-count stop rules are not permitted",
    );
  }
}

export function recordScreeningDecision(
  handle: ProjectHandle,
  capability: unknown,
  request: ScreeningDecisionRequest,
): ScreeningDecision {
  assertWritable(handle);
  assertLiteratureSchema(handle);
  requireCapability(
    handle,
    capability,
    ["literature:screen"],
    "screening requires literature:screen capability",
  );
  ensureDecisionRequest(request);
  const commandId = requireCommand(request.commandId);
  getReviewProtocol(handle, capability, request.protocolVersionId);
  row(handle, "corpus_records", request.corpusRecordId);
  const payload = {
    corpusRecordId: request.corpusRecordId,
    protocolVersionId: request.protocolVersionId,
    criterionId: request.criterionId,
    decision: request.decision,
    reason: request.reason,
  };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {
    return decisionRow(row(handle, "screening_decisions", existing.resultId!));
  }
  const id = recordId("screening");
  const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO screening_decisions (id, corpus_record_id, protocol_version_id, criterion_id, decision, reason, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        request.corpusRecordId,
        request.protocolVersionId,
        request.criterionId,
        request.decision,
        request.reason,
        commandId,
        createdAt,
      );
    const previous = handle.db
      .prepare(
        "SELECT id FROM screening_decisions WHERE corpus_record_id = ? AND protocol_version_id <> ? AND superseded_by_decision_id IS NULL ORDER BY created_at DESC LIMIT 1",
      )
      .get(request.corpusRecordId, request.protocolVersionId) as
      | { id?: string }
      | undefined;
    if (previous?.id) {
      handle.db
        .prepare(
          "UPDATE screening_decisions SET superseded_by_decision_id = ? WHERE id = ?",
        )
        .run(id, previous.id);
    }
    if (request.decision === "uncertain") {
      handle.db
        .prepare(
          "INSERT INTO uncertainty_queue (id, decision_id, corpus_record_id, status, created_at) VALUES (?, ?, ?, 'open', ?)",
        )
        .run(newId("uncertainty"), id, request.corpusRecordId, createdAt);
    }
  });
  completeOperation(handle, commandId, id, "screening-decision");
  return decisionRow(row(handle, "screening_decisions", id));
}
export function getScreeningDecision(
  handle: ProjectHandle,
  capability: unknown,
  id: string,
): ScreeningDecision {
  assertLiteratureSchema(handle);
  requireCapability(
    handle,
    capability,
    ["literature:inspect"],
    "screening inspection requires literature:inspect capability",
  );
  return decisionRow(row(handle, "screening_decisions", id));
}
export function listScreeningDecisions(
  handle: ProjectHandle,
  capability: unknown,
  protocolVersionId?: string,
): readonly ScreeningDecision[] {
  assertLiteratureSchema(handle);
  requireCapability(
    handle,
    capability,
    ["literature:inspect"],
    "screening inspection requires literature:inspect capability",
  );
  const rows = (
    protocolVersionId === undefined
      ? handle.db
          .prepare("SELECT * FROM screening_decisions ORDER BY created_at, id")
          .all()
      : handle.db
          .prepare(
            "SELECT * FROM screening_decisions WHERE protocol_version_id = ? ORDER BY created_at, id",
          )
          .all(protocolVersionId)
  ) as Array<Record<string, unknown>>;
  return rows.map(decisionRow);
}

export function amendEligibility(
  handle: ProjectHandle,
  capability: unknown,
  request: EligibilityAmendmentRequest,
): EligibilityAmendment {
  assertWritable(handle);
  assertLiteratureSchema(handle);
  requireCapability(
    handle,
    capability,
    ["literature:screen"],
    "eligibility amendment requires literature:screen capability",
  );
  const commandId = requireCommand(request.commandId);
  const from = getReviewProtocol(
    handle,
    capability,
    request.fromProtocolVersionId,
  );
  const rationale = requireText(request.rationale, "rationale");
  const eligibility = stableObject(request.eligibility);
  if (Object.keys(eligibility).length === 0) {
    throw new ProjectStoreError("invalid-argument", "eligibility is required");
  }
  const payload = {
    fromProtocolVersionId: request.fromProtocolVersionId,
    eligibility,
    scope: request.scope ?? {},
    rationale,
    versionLabel: request.versionLabel ?? `${from.versionLabel}-amended`,
  };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {
    const amendment = row(handle, "eligibility_amendments", existing.resultId!);
    return {
      id: text(amendment, "id"),
      fromProtocolVersionId: text(amendment, "from_protocol_version_id"),
      toProtocolVersionId: text(amendment, "to_protocol_version_id"),
      rationale: text(amendment, "rationale"),
      createdAt: text(amendment, "created_at"),
    };
  }
  const toId = recordId("protocol");
  const origin =
    isOwnerCapability(capability) &&
    capability.ownerId === handle.project.ownerId
      ? "owner-recorded"
      : "specialist-proposed";
  const artifact = registerArtifactVersion(handle, {
    logicalId: `review-protocol-${toId}`,
    version: payload.versionLabel,
    content: json({
      eligibility,
      scope: request.scope ?? {},
      amendedFrom: from.id,
    }),
    origin: "literature-eligibility-amendment",
    access: "metadata-only",
  });
  const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO review_protocols (id, version_label, artifact_version_id, eligibility, scope, origin, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        toId,
        payload.versionLabel,
        artifact.id,
        json(eligibility),
        json(request.scope ?? {}),
        origin,
        `${commandId}:protocol`,
        createdAt,
      );
    const amendmentId = recordId("amendment");
    handle.db
      .prepare(
        "INSERT INTO eligibility_amendments (id, from_protocol_version_id, to_protocol_version_id, rationale, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(amendmentId, from.id, toId, rationale, commandId, createdAt);
    completeOperation(handle, commandId, amendmentId, "eligibility-amendment");
  });
  const amendment = row(
    handle,
    "eligibility_amendments",
    resultIdForLocal(handle, commandId),
  );
  return {
    id: text(amendment, "id"),
    fromProtocolVersionId: text(amendment, "from_protocol_version_id"),
    toProtocolVersionId: text(amendment, "to_protocol_version_id"),
    rationale: text(amendment, "rationale"),
    createdAt: text(amendment, "created_at"),
  };
}
function resultIdForLocal(handle: ProjectHandle, commandId: string): string {
  const found = operation(handle, commandId);
  if (!found?.resultId) {
    throw new ProjectStoreError(
      "literature-operation-incomplete",
      "amendment was not completed",
    );
  }
  return found.resultId;
}

export function listUncertaintyQueue(
  handle: ProjectHandle,
  capability: unknown,
  status?: "open" | "resolved",
): readonly UncertaintyQueueEntry[] {
  assertLiteratureSchema(handle);
  requireCapability(
    handle,
    capability,
    ["literature:inspect"],
    "uncertainty inspection requires literature:inspect capability",
  );
  const rows = (
    status === undefined
      ? handle.db
          .prepare("SELECT * FROM uncertainty_queue ORDER BY created_at, id")
          .all()
      : handle.db
          .prepare(
            "SELECT * FROM uncertainty_queue WHERE status = ? ORDER BY created_at, id",
          )
          .all(status)
  ) as Array<Record<string, unknown>>;
  return rows.map(queueRow);
}
export function resolveUncertainty(
  handle: ProjectHandle,
  capability: unknown,
  request: ScreeningDecisionRequest,
): ScreeningDecision {
  if (request.decision === "uncertain") {
    throw new ProjectStoreError(
      "invalid-screening",
      "resolution must be include or exclude",
    );
  }
  const decision = recordScreeningDecision(handle, capability, request);
  const entry = handle.db
    .prepare(
      "SELECT id FROM uncertainty_queue WHERE corpus_record_id = ? AND status = 'open' ORDER BY created_at LIMIT 1",
    )
    .get(request.corpusRecordId) as { id?: string } | undefined;
  if (entry?.id) {
    handle.db
      .prepare(
        "UPDATE uncertainty_queue SET status = 'resolved', resolved_by_decision_id = ? WHERE id = ?",
      )
      .run(decision.id, entry.id);
  }
  return decision;
}
export function inspectScreeningCounts(
  handle: ProjectHandle,
  capability: unknown,
  protocolVersionId?: string,
): ScreeningCounts {
  const decisions = listScreeningDecisions(
    handle,
    capability,
    protocolVersionId,
  );
  return {
    included: decisions.filter((item) => item.decision === "include").length,
    excluded: decisions.filter((item) => item.decision === "exclude").length,
    uncertain: decisions.filter((item) => item.decision === "uncertain").length,
  };
}
