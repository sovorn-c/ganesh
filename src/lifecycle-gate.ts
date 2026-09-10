// story: e03s04
import { ProjectStoreError, type ProjectHandle } from "./project-types.js";
import { assertWritable } from "./project-store.js";
import { transaction } from "./schema.js";
import { isoNow, newId } from "./storage-utils.js";
import { getClassification, evaluatePolicy, listPermissions } from "./policy-store.js";
import { effectiveRestriction } from "./disclosure-gateway.js";
import { isOwnerCapability, isWorkerCapability, executeLocalCommand } from "./capability-broker.js";
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
  const op = typeof operation === "string" ? getLifecycleOperation(handle, operation) : operation;
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
  if (phase === "acceptance" || options?.requireCanonicalWrite) {
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
      // Owner capability is always authorized for canonical write
    } else if (isWorkerCapability(cap)) {
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
  const op = typeof operation === "string" ? getLifecycleOperation(handle, operation) : operation;
  if (!op) {
    throw new ProjectStoreError("not-found", "lifecycle operation not found");
  }

  const checkpoint = checkLifecyclePolicy(handle, op, "acceptance", options);

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

  // Checkpoint passed: accept candidate
  const acceptedAt = isoNow();
  transaction(handle.db, () => {
    handle.db
      .prepare("UPDATE lifecycle_operations SET status = 'accepted', updated_at = ? WHERE id = ?")
      .run(acceptedAt, op.id);
  });

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
  const op = typeof operation === "string" ? getLifecycleOperation(handle, operation) : operation;
  if (!op) {
    throw new ProjectStoreError("not-found", "lifecycle operation not found");
  }

  const checkpoint = checkLifecyclePolicy(handle, op, "resume", options);

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
