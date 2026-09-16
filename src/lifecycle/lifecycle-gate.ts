// story: e03s04
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import { getClassification, evaluatePolicy, listPermissions } from "../policy/policy-store.js";
import { effectiveRestriction } from "../policy/disclosure-gateway.js";
import { isOwnerCapability, isWorkerCapability, executeLocalCommand } from "../authority/capability-broker.js";
import { assessActivityAuthorization } from "../ethics/authorization-assessment.js";
import { assessProtocolCurrency } from "../progress/change-store.js";
import { RESEARCH_ACTIVITIES, type ActivityAuthorizationContext, type ResearchActivity } from "../ethics/ethics-types.js";
import type {
  AcceptanceResult,
  CandidateOutput,
  LifecycleCheckOptions,
  LifecycleOperation,
  LifecycleOperationInput,
  LifecyclePhase,
  LifecycleStatus,
  PolicyCheckpoint,
  QuarantinedOutput,
  ResumeResult,
  RevocationFence
} from "./lifecycle-types.js";

type SnapshotAuthorizationContext = {
  population?: ActivityAuthorizationContext["population"];
  dataClasses?: ActivityAuthorizationContext["dataClasses"];
  dataUse?: ActivityAuthorizationContext["dataUse"];
  destination?: ActivityAuthorizationContext["destination"];
  purpose?: ActivityAuthorizationContext["purpose"];
  conditions?: ActivityAuthorizationContext["conditions"];
};

type SnapshotContextResult = {
  readonly context: SnapshotAuthorizationContext;
  readonly invalidReason?: string;
};

function snapshotObject(snapshot: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
    // E03 accepts a raw artifact version ID as an input snapshot.
    return undefined;
  }
}

function snapshotProtocolVersionId(snapshot: string): string | "invalid" | undefined {
  const parsed = snapshotObject(snapshot);
  if (parsed === undefined || parsed.protocolVersionId === undefined) { return undefined; }
  return typeof parsed.protocolVersionId === "string" && parsed.protocolVersionId.trim() !== "" ? parsed.protocolVersionId : "invalid";
}

function snapshotActivity(snapshot: string): ResearchActivity | "invalid" | undefined {
  const parsed = snapshotObject(snapshot);
  const value = parsed?.activity;
  if (value === undefined) {
    return undefined;
  }
  return typeof value === "string" && RESEARCH_ACTIVITIES.includes(value as ResearchActivity)
    ? value as ResearchActivity
    : "invalid";
}

function snapshotAuthorizationContext(snapshot: string): SnapshotContextResult {
  const parsed = snapshotObject(snapshot);
  if (parsed === undefined) {
    return { context: {} };
  }
  const context: SnapshotAuthorizationContext = {};
  for (const key of ["population", "dataUse", "destination", "purpose"] as const) {
    if (parsed[key] !== undefined) {
      if (typeof parsed[key] !== "string" || parsed[key].trim() === "") {
        return { context: {}, invalidReason: `operation snapshot ${key} is malformed` };
      }
      context[key] = parsed[key];
    }
  }
  if (parsed.dataClasses !== undefined) {
    if (!Array.isArray(parsed.dataClasses) || parsed.dataClasses.length === 0 || !parsed.dataClasses.every((item) => typeof item === "string" && item.trim() !== "")) {
      return { context: {}, invalidReason: "operation snapshot dataClasses is malformed" };
    }
    context.dataClasses = parsed.dataClasses as string[];
  }
  if (parsed.conditions !== undefined) {
    if (parsed.conditions === null) {
      return { context: {}, invalidReason: "operation snapshot conditions are malformed" };
    }
    context.conditions = parsed.conditions;
  }
  return { context };
}

function sameSnapshotValue(left: unknown, right: unknown): boolean {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((value, index) => sameSnapshotValue(value, right[index]));
  }
  if (typeof left === "object" && left !== null && typeof right === "object" && right !== null) {
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const keys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return keys.length === rightKeys.length && keys.every((key, index) => key === rightKeys[index] && sameSnapshotValue(leftRecord[key], rightRecord[key]));
  }
  return left === right;
}

function parseInputVersions(snapshot: string): string[] {
  if (!snapshot || typeof snapshot !== "string") {
    return [];
  }
  try {
    const parsed = JSON.parse(snapshot);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => (typeof item === "string" ? item : String(item)));
    }
    if (parsed && typeof parsed === "object") {
      if (Array.isArray(parsed.versionIds)) {
        return parsed.versionIds.map((item: unknown) => String(item));
      }
      if (typeof parsed.inputVersionId === "string") {
        return [parsed.inputVersionId];
      }
      if (typeof parsed.inputVersion === "string") {
        return [parsed.inputVersion];
      }
    }
  } catch {
    // If not valid JSON, treat as a single string ID
    if (snapshot.trim().length > 0) {
      return [snapshot.trim()];
    }
  }
  return [];
}

export function createLifecycleOperation(
  handle: ProjectHandle,
  input: LifecycleOperationInput
): LifecycleOperation {
  assertWritable(handle);
  if (!input || !input.operationType) {
    throw new ProjectStoreError("invalid-argument", "operationType is required");
  }

  const id = input.id ?? newId("op");
  const branchId = input.branchId ?? null;
  const status: LifecycleStatus = input.status ?? "queued";
  const createdAt = isoNow();
  const updatedAt = createdAt;

  let inputSnapshot: string;
  if (typeof input.inputSnapshot === "string") {
    inputSnapshot = input.inputSnapshot;
  } else if (input.inputSnapshot && typeof input.inputSnapshot === "object") {
    inputSnapshot = JSON.stringify(input.inputSnapshot);
  } else {
    throw new ProjectStoreError("invalid-argument", "inputSnapshot is required");
  }

  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO lifecycle_operations (id, operation_type, branch_id, input_snapshot, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(id, input.operationType, branchId, inputSnapshot, status, createdAt, updatedAt);
  });

  return {
    id,
    operationType: input.operationType,
    branchId,
    inputSnapshot,
    status,
    createdAt,
    updatedAt
  };
}

export function getLifecycleOperation(
  handle: ProjectHandle,
  operationId: string
): LifecycleOperation | null {
  const row = handle.db
    .prepare("SELECT * FROM lifecycle_operations WHERE id = ?")
    .get(operationId) as Record<string, unknown> | undefined;

  if (!row) {
    return null;
  }

  return {
    id: String(row.id),
    operationType: String(row.operation_type),
    branchId: row.branch_id ? String(row.branch_id) : null,
    inputSnapshot: String(row.input_snapshot),
    status: String(row.status) as LifecycleStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function updateLifecycleOperationStatus(
  handle: ProjectHandle,
  operationId: string,
  status: LifecycleStatus
): void {
  assertWritable(handle);
  const updatedAt = isoNow();
  transaction(handle.db, () => {
    const res = handle.db
      .prepare("UPDATE lifecycle_operations SET status = ?, updated_at = ? WHERE id = ?")
      .run(status, updatedAt, operationId);
    if (res.changes === 0) {
      throw new ProjectStoreError("not-found", `lifecycle operation not found: ${operationId}`);
    }
  });
}

export function fenceRevokedOperation(
  handle: ProjectHandle,
  operation: string | LifecycleOperation,
  reason: string,
  actor = "system"
): RevocationFence {
  assertWritable(handle);
  const operationId = typeof operation === "string" ? operation : operation.id;
  const op = getLifecycleOperation(handle, operationId);
  if (!op) {
    throw new ProjectStoreError("not-found", `lifecycle operation not found: ${operationId}`);
  }

  const id = newId("fence");
  const createdAt = isoNow();

  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO revocation_fences (id, operation_id, reason, actor, created_at) VALUES (?, ?, ?, ?, ?)"
      )
      .run(id, operationId, reason, actor, createdAt);

    handle.db
      .prepare("UPDATE lifecycle_operations SET status = 'fenced', updated_at = ? WHERE id = ?")
      .run(createdAt, operationId);
  });

  return {
    id,
    operationId,
    reason,
    actor,
    createdAt
  };
}

export function isOperationFenced(handle: ProjectHandle, operationId: string): boolean {
  const row = handle.db
    .prepare("SELECT 1 FROM revocation_fences WHERE operation_id = ? LIMIT 1")
    .get(operationId);
  return Boolean(row);
}

function persistCheckpoint(
  handle: ProjectHandle,
  checkpoint: PolicyCheckpoint
): PolicyCheckpoint {
  assertWritable(handle);
  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO policy_checkpoints (id, operation_id, phase, policy_decision_id, status, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(
        checkpoint.id,
        checkpoint.operationId,
        checkpoint.phase,
        checkpoint.policyDecisionId ?? null,
        checkpoint.status,
        checkpoint.reason,
        checkpoint.createdAt
      );
  });
  return checkpoint;
}

export function checkLifecyclePolicy(
  handle: ProjectHandle,
  operation: string | LifecycleOperation,
  phase: LifecyclePhase,
  options?: LifecycleCheckOptions
): PolicyCheckpoint {
  const operationId = typeof operation === "string" ? operation : operation.id;
  const op = getLifecycleOperation(handle, operationId);
  if (!op) {
    throw new ProjectStoreError("not-found", "lifecycle operation not found");
  }

  const createdAt = isoNow();

  // 1. Revocation fence check
  if (isOperationFenced(handle, op.id)) {
    const fence = handle.db
      .prepare("SELECT reason FROM revocation_fences WHERE operation_id = ? ORDER BY created_at DESC LIMIT 1")
      .get(op.id) as { reason?: string } | undefined;
    const reason = fence?.reason ? `operation is fenced: ${fence.reason}` : "operation is fenced";
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason,
      createdAt
    });
  }

  // 2. Cancellation check
  if (op.status === "cancelled") {
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: "operation is cancelled",
      createdAt
    });
  }

  // 2b. External authorization is bound to the operation snapshot. A caller
  // cannot relabel a data-collection operation as literature-only at check time.
  const recordedActivity = snapshotActivity(op.inputSnapshot);
  const snapshotContextResult = snapshotAuthorizationContext(op.inputSnapshot);
  const snapshotContext = snapshotContextResult.context;
  if (recordedActivity !== undefined && snapshotContextResult.invalidReason !== undefined) {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: snapshotContextResult.invalidReason,
      createdAt
    });
  }
  if (recordedActivity === "invalid") {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: "operation snapshot contains an invalid research activity",
      createdAt
    });
  }
  if (options?.activity !== undefined && recordedActivity === undefined) {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: "named research activity must be bound to the persisted operation snapshot",
      createdAt
    });
  }
  if (recordedActivity !== undefined && options?.activity !== undefined && recordedActivity !== options.activity) {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: `requested activity ${options.activity} does not match operation snapshot activity ${recordedActivity}`,
      createdAt
    });
  }
  for (const key of ["population", "dataClasses", "dataUse", "destination", "purpose", "conditions"] as const) {
    const recorded = snapshotContext[key];
    const requested = options?.[key];
    if (recordedActivity !== undefined && recorded !== undefined && requested !== undefined && !sameSnapshotValue(recorded, requested)) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "blocked",
        reason: `requested ${key} does not match operation snapshot ${key}`,
        createdAt
      });
    }
  }
  const activity = recordedActivity;
  const protocolVersionId = snapshotProtocolVersionId(op.inputSnapshot);
  if (protocolVersionId === "invalid") {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"), operationId: op.id, phase, status: "blocked",
      reason: "operation snapshot protocolVersionId is malformed", createdAt
    });
  }
  if (protocolVersionId !== undefined) {
    let currency: ReturnType<typeof assessProtocolCurrency>;
    try {
      currency = assessProtocolCurrency(handle, options?.capability, {
        protocolVersionId,
        branchId: op.branchId ?? undefined,
        population: snapshotContext.population,
        dataUse: snapshotContext.dataUse,
        activity
      });
    } catch (error) {
      if (!(error instanceof ProjectStoreError) || error.code !== "not-found") { throw error; }
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"), operationId: op.id, phase, status: "blocked",
        reason: "operation snapshot protocolVersionId was not found", createdAt
      });
    }
    if (currency.status === "superseded" || (currency.materialChange && !currency.contextMatches)) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "blocked",
        reason: `protocol currency blocked: ${currency.reason}`,
        createdAt
      });
    }
  }
  if (activity !== undefined) {
    const assessment = assessActivityAuthorization(handle, {
      activity,
      population: snapshotContext.population,
      dataClasses: snapshotContext.dataClasses,
      dataUse: snapshotContext.dataUse,
      destination: snapshotContext.destination,
      purpose: snapshotContext.purpose,
      conditions: snapshotContext.conditions
    });
    if (!assessment.permitted) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      let fenceReason = assessment.reason;
      if (phase === "external") {
        fenceReason += " (cannot-recall)";
      }
      if (assessment.status === "withdrawn" || assessment.status === "expired") {
        fenceRevokedOperation(handle, op.id, fenceReason, options?.actor ?? "system");
      }
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "blocked",
        reason: fenceReason,
        createdAt
      });
    }
    for (const key of ["population", "dataClasses", "dataUse", "destination", "purpose", "conditions"] as const) {
      if (options?.[key] !== undefined && snapshotContext[key] === undefined) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "blocked",
          reason: `requested ${key} is not present in the operation snapshot`,
          createdAt
        });
      }
    }
  }

  // 3. Input currency & classification & policy
  const versionIds = parseInputVersions(op.inputSnapshot);
  if (versionIds.length === 0 && phase === "dispatch") {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return persistCheckpoint(handle, {
      id: newId("chk"),
      operationId: op.id,
      phase,
      status: "blocked",
      reason: "no input versions found in input snapshot",
      createdAt
    });
  }

  for (const v of versionIds) {
    // Check version exists
    const art = handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(v);
    if (!art) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "denied",
        reason: `input version not found: ${v}`,
        createdAt
      });
    }

    // Check classification
    const classification = getClassification(handle, v);
    if (!classification) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "blocked",
        reason: `unclassified input version: ${v}`,
        createdAt
      });
    }

    // If destination & purpose are provided, evaluate policy explicitly
    if (options?.destination && options?.purpose) {
      const decision = evaluatePolicy(handle, {
        inputVersions: [v],
        destination: options.destination,
        purpose: options.purpose,
        actor: options.actor ?? "system",
        branchId: op.branchId ?? undefined
      });

      if (decision.result === "deny") {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        const isWithdrawn = decision.reason.includes("withdrawn");
        if (isWithdrawn) {
          fenceRevokedOperation(handle, op.id, decision.reason, options?.actor ?? "system");
        }
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          policyDecisionId: decision.id,
          status: isWithdrawn ? "blocked" : "denied",
          reason: decision.reason,
          createdAt
        });
      }
    } else {
      // Check effective restrictions (active vs withdrawn vs expired)
      const restrictions = effectiveRestriction(handle, [v], op.branchId ?? undefined);
      const perms = listPermissions(handle, v);
      const hasActive = perms.some((p) => p.status === "active");

      if (restrictions.isWithdrawn && !hasActive) {
        // Durable fence on withdrawal
        fenceRevokedOperation(handle, op.id, `permission withdrawn for input: ${v}`, options?.actor ?? "system");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "blocked",
          reason: `permission withdrawn for input: ${v}`,
          createdAt
        });
      }

      if (restrictions.isExpired && !hasActive) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "blocked",
          reason: `permission expired for input: ${v}`,
          createdAt
        });
      }

      if (phase === "external" && restrictions.isLocalOnly) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "denied",
          reason: `external effect prohibited on local-only input: ${v}`,
          createdAt
        });
      }
    }
  }

  // 4. Capability & canonical write check for acceptance
  if (options?.allowCandidateSubmission === true) {
    const cap = options.capability;
    const candidateAuthorized = isOwnerCapability(cap)
      ? cap.ownerId === handle.project.ownerId
      : isWorkerCapability(cap) && cap.projectId === handle.project.id && cap.canPerform("work:submit-candidate");
    if (!candidateAuthorized) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "denied",
        reason: "missing scoped capability for candidate submission",
        createdAt
      });
    }
  }
  if ((phase === "acceptance" && options?.allowCandidateSubmission !== true) || options?.requireCanonicalWrite) {
    const cap = options?.capability;
    if (!cap) {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "denied",
        reason: "missing required capability for canonical write",
        createdAt
      });
    }

    if (isOwnerCapability(cap)) {
      if (cap.ownerId !== handle.project.ownerId) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "denied",
          reason: "owner capability does not belong to this project",
          createdAt
        });
      }
    } else if (isWorkerCapability(cap)) {
      if (cap.projectId !== handle.project.id) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "denied",
          reason: "worker capability does not belong to this project",
          createdAt
        });
      }
      if (!cap.allowedOperations.includes("canonical-project-write")) {
        updateLifecycleOperationStatus(handle, op.id, "blocked");
        return persistCheckpoint(handle, {
          id: newId("chk"),
          operationId: op.id,
          phase,
          status: "denied",
          reason: "worker capability lacks canonical-project-write authority",
          createdAt
        });
      }
    } else {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "denied",
        reason: "invalid or forged capability for canonical write",
        createdAt
      });
    }
  }

  // 5. Execution mode & command guard check
  if (options?.command) {
    const mode = options.executionMode ?? "approve";
    const guard = options.bashGuard ?? {
      deniedCommands: ["rm -rf", "sudo"]
    };
    const execResult = executeLocalCommand(mode, guard, options.command);

    if (execResult.status === "denied") {
      updateLifecycleOperationStatus(handle, op.id, "blocked");
      return persistCheckpoint(handle, {
        id: newId("chk"),
        operationId: op.id,
        phase,
        status: "denied",
        reason: `command execution denied: ${execResult.reason}`,
        createdAt
      });
    }
  }

  // 6. Passed!
  return persistCheckpoint(handle, {
    id: newId("chk"),
    operationId: op.id,
    phase,
    status: "passed",
    reason: `passed policy and capability verification for phase ${phase}`,
    createdAt
  });
}

export function acceptCandidate(
  handle: ProjectHandle,
  operation: string | LifecycleOperation,
  candidate: CandidateOutput,
  options?: LifecycleCheckOptions
): AcceptanceResult {
  assertWritable(handle);
  const operationId = typeof operation === "string" ? operation : operation.id;
  const op = getLifecycleOperation(handle, operationId);
  if (!op) {
    throw new ProjectStoreError("not-found", "lifecycle operation not found");
  }
  if (["accepted", "completed", "rejected"].includes(op.status)) {
    return {
      status: "blocked",
      operationId: op.id,
      candidateId: candidate.candidateId,
      reason: `operation is already ${op.status}`
    };
  }

  const checkpoint = checkLifecyclePolicy(handle, op.id, "acceptance", options);

  if (checkpoint.status !== "passed") {
    // Quarantine output!
    const quarId = newId("quar");
    const createdAt = isoNow();
    const disposition = "quarantined";
    const details = JSON.stringify(candidate);

    transaction(handle.db, () => {
      handle.db
        .prepare(
          "INSERT INTO quarantined_outputs (id, operation_id, candidate_id, reason, disposition, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .run(quarId, op.id, candidate.candidateId, checkpoint.reason, disposition, details, createdAt);

      // Do not overwrite "fenced" or "cancelled"
      const currentOp = getLifecycleOperation(handle, op.id);
      if (currentOp && currentOp.status !== "fenced" && currentOp.status !== "cancelled") {
        handle.db
          .prepare("UPDATE lifecycle_operations SET status = 'quarantined', updated_at = ? WHERE id = ?")
          .run(createdAt, op.id);
      }
    });

    return {
      status: "quarantined",
      operationId: op.id,
      candidateId: candidate.candidateId,
      reason: checkpoint.reason,
      checkpoint
    };
  }

  // Checkpoint passed: accept candidate. The conditional update closes the
  // race where two callers pass the checkpoint before either writes status.
  const acceptedAt = isoNow();
  let accepted = false;
  transaction(handle.db, () => {
    const result = handle.db
      .prepare("UPDATE lifecycle_operations SET status = 'accepted', updated_at = ? WHERE id = ? AND status NOT IN ('accepted', 'completed', 'rejected', 'cancelled', 'fenced')")
      .run(acceptedAt, op.id);
    accepted = result.changes === 1;
  });
  if (!accepted) {
    const current = getLifecycleOperation(handle, op.id);
    return {
      status: "blocked",
      operationId: op.id,
      candidateId: candidate.candidateId,
      reason: `operation is already ${current?.status ?? "unavailable"}`,
      checkpoint
    };
  }

  return {
    status: "accepted",
    operationId: op.id,
    candidateId: candidate.candidateId,
    reason: "candidate output accepted into canonical record",
    checkpoint
  };
}

export function resumeOperation(
  handle: ProjectHandle,
  operation: string | LifecycleOperation,
  options?: LifecycleCheckOptions
): ResumeResult {
  assertWritable(handle);
  const operationId = typeof operation === "string" ? operation : operation.id;
  const op = getLifecycleOperation(handle, operationId);
  if (!op) {
    throw new ProjectStoreError("not-found", "lifecycle operation not found");
  }

  const checkpoint = checkLifecyclePolicy(handle, op.id, "resume", options);

  if (checkpoint.status !== "passed") {
    updateLifecycleOperationStatus(handle, op.id, "blocked");
    return {
      status: "blocked",
      operationId: op.id,
      checkpoint,
      reason: checkpoint.reason
    };
  }

  updateLifecycleOperationStatus(handle, op.id, "running");
  return {
    status: "resumed",
    operationId: op.id,
    checkpoint
  };
}

export function listCheckpoints(
  handle: ProjectHandle,
  operationId?: string
): readonly PolicyCheckpoint[] {
  const sql = operationId
    ? "SELECT * FROM policy_checkpoints WHERE operation_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM policy_checkpoints ORDER BY created_at ASC";

  const rows = (operationId ? handle.db.prepare(sql).all(operationId) : handle.db.prepare(sql).all()) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    operationId: String(r.operation_id),
    phase: String(r.phase) as LifecyclePhase,
    policyDecisionId: r.policy_decision_id ? String(r.policy_decision_id) : undefined,
    status: String(r.status) as "passed" | "blocked" | "denied",
    reason: String(r.reason),
    createdAt: String(r.created_at)
  }));
}

export function listFences(
  handle: ProjectHandle,
  operationId?: string
): readonly RevocationFence[] {
  const sql = operationId
    ? "SELECT * FROM revocation_fences WHERE operation_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM revocation_fences ORDER BY created_at ASC";

  const rows = (operationId ? handle.db.prepare(sql).all(operationId) : handle.db.prepare(sql).all()) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    operationId: String(r.operation_id),
    reason: String(r.reason),
    actor: String(r.actor),
    createdAt: String(r.created_at)
  }));
}

export function listQuarantinedOutputs(
  handle: ProjectHandle,
  operationId?: string
): readonly QuarantinedOutput[] {
  const sql = operationId
    ? "SELECT * FROM quarantined_outputs WHERE operation_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM quarantined_outputs ORDER BY created_at ASC";

  const rows = (operationId ? handle.db.prepare(sql).all(operationId) : handle.db.prepare(sql).all()) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    operationId: String(r.operation_id),
    candidateId: String(r.candidate_id),
    reason: String(r.reason),
    disposition: String(r.disposition) as "quarantined" | "discarded",
    details: String(r.details),
    createdAt: String(r.created_at)
  }));
}

export function listLifecycleOperations(
  handle: ProjectHandle,
  branchId?: string
): readonly LifecycleOperation[] {
  const sql = branchId
    ? "SELECT * FROM lifecycle_operations WHERE branch_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM lifecycle_operations ORDER BY created_at ASC";

  const rows = (branchId ? handle.db.prepare(sql).all(branchId) : handle.db.prepare(sql).all()) as Array<
    Record<string, unknown>
  >;

  return rows.map((r) => ({
    id: String(r.id),
    operationType: String(r.operation_type),
    branchId: r.branch_id ? String(r.branch_id) : null,
    inputSnapshot: String(r.input_snapshot),
    status: String(r.status) as LifecycleStatus,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at)
  }));
}
