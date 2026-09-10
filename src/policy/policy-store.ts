// story: e03s01
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import type {
  ClassificationInput,
  ClassificationRecord,
  DataUseGrantInput,
  DataUsePermissionRecord,
  PermissionStatus,
  PolicyDecision,
  PolicyEvaluationRequest,
  PolicyHistoryItem,
  PolicyRestriction,
  PolicyStatusHistoryRecord,
  ValidityConditions
} from "./policy-types.js";

export function classifyInput(
  handle: ProjectHandle,
  inputVersionId: string,
  classification: ClassificationInput
): ClassificationRecord {
  assertWritable(handle);
  if (!inputVersionId || typeof inputVersionId !== "string") {
    throw new ProjectStoreError("invalid-argument", "inputVersionId must be a non-empty string");
  }
  if (!classification || !classification.sensitivity || !classification.basis) {
    throw new ProjectStoreError("invalid-argument", "classification must specify sensitivity and basis");
  }

  // Verify artifact version exists
  const existing = handle.db
    .prepare("SELECT id FROM artifact_versions WHERE id = ?")
    .get(inputVersionId) as { id?: string } | undefined;
  if (!existing) {
    throw new ProjectStoreError("not-found", `artifact version not found: ${inputVersionId}`);
  }

  const id = newId("class");
  const actor = classification.actor ?? handle.project.ownerId;
  const createdAt = isoNow();

  transaction(handle.db, () => {
    handle.db
      .prepare(
        "INSERT INTO classifications (id, input_version_id, sensitivity, basis, actor, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(id, inputVersionId, classification.sensitivity, classification.basis, actor, createdAt);
  });

  return {
    id,
    inputVersionId,
    sensitivity: classification.sensitivity,
    basis: classification.basis,
    actor,
    createdAt
  };
}

export function getClassification(
  handle: ProjectHandle,
  inputVersionId: string
): ClassificationRecord | null {
  const row = handle.db
    .prepare(
      "SELECT id, input_version_id, sensitivity, basis, actor, created_at FROM classifications WHERE input_version_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(inputVersionId) as
    | {
        id: string;
        input_version_id: string;
        sensitivity: string;
        basis: string;
        actor: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }
  return {
    id: row.id,
    inputVersionId: row.input_version_id,
    sensitivity: row.sensitivity,
    basis: row.basis,
    actor: row.actor,
    createdAt: row.created_at
  };
}

export function listClassifications(
  handle: ProjectHandle,
  inputVersionId?: string
): readonly ClassificationRecord[] {
  const sql = inputVersionId
    ? "SELECT id, input_version_id, sensitivity, basis, actor, created_at FROM classifications WHERE input_version_id = ? ORDER BY created_at ASC"
    : "SELECT id, input_version_id, sensitivity, basis, actor, created_at FROM classifications ORDER BY created_at ASC";

  const rows = (inputVersionId ? handle.db.prepare(sql).all(inputVersionId) : handle.db.prepare(sql).all()) as Array<{
    id: string;
    input_version_id: string;
    sensitivity: string;
    basis: string;
    actor: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    inputVersionId: r.input_version_id,
    sensitivity: r.sensitivity,
    basis: r.basis,
    actor: r.actor,
    createdAt: r.created_at
  }));
}

export function grantDataUse(
  handle: ProjectHandle,
  request: DataUseGrantInput
): DataUsePermissionRecord {
  assertWritable(handle);
  if (!request.inputVersion || typeof request.inputVersion !== "string") {
    throw new ProjectStoreError("invalid-argument", "inputVersion must be a non-empty string");
  }
  if (!request.destination || !request.purpose || !request.authority) {
    throw new ProjectStoreError("invalid-argument", "destination, purpose, and authority are required");
  }

  const existing = handle.db
    .prepare("SELECT id FROM artifact_versions WHERE id = ?")
    .get(request.inputVersion) as { id?: string } | undefined;
  if (!existing) {
    throw new ProjectStoreError("not-found", `artifact version not found: ${request.inputVersion}`);
  }

  const id = newId("perm");
  const createdAt = isoNow();
  const allowedTransformations = JSON.stringify(request.allowedTransformations ?? []);
  const validity = JSON.stringify(request.validity ?? {});
  const actor = request.actor ?? request.authority;

  transaction(handle.db, () => {
    handle.db
      .prepare(
        `INSERT INTO policy_permissions (
          id, input_version_id, destination, purpose, authority, allowed_transformations, validity_conditions, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        request.inputVersion,
        request.destination,
        request.purpose,
        request.authority,
        allowedTransformations,
        validity,
        "active",
        createdAt,
        createdAt
      );

    const historyId = newId("permhist");
    handle.db
      .prepare(
        "INSERT INTO policy_status_history (id, permission_id, previous_status, new_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(historyId, id, "", "active", "initial grant", actor, createdAt);
  });

  return {
    id,
    inputVersionId: request.inputVersion,
    destination: request.destination,
    purpose: request.purpose,
    authority: request.authority,
    allowedTransformations: request.allowedTransformations ?? [],
    validity: request.validity ?? {},
    status: "active",
    createdAt,
    updatedAt: createdAt
  };
}

export function withdrawDataUse(
  handle: ProjectHandle,
  permissionId: string,
  reason: string,
  actor?: string
): DataUsePermissionRecord {
  assertWritable(handle);
  const row = handle.db
    .prepare("SELECT * FROM policy_permissions WHERE id = ?")
    .get(permissionId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `permission not found: ${permissionId}`);
  }

  const prevStatus = String(row.status) as PermissionStatus;
  const now = isoNow();
  const act = actor ?? handle.project.ownerId;

  if (prevStatus === "withdrawn") {
    return mapPermissionRow(row);
  }

  transaction(handle.db, () => {
    handle.db
      .prepare("UPDATE policy_permissions SET status = 'withdrawn', updated_at = ? WHERE id = ?")
      .run(now, permissionId);

    const histId = newId("permhist");
    handle.db
      .prepare(
        "INSERT INTO policy_status_history (id, permission_id, previous_status, new_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(histId, permissionId, prevStatus, "withdrawn", reason, act, now);
  });

  const updated = handle.db
    .prepare("SELECT * FROM policy_permissions WHERE id = ?")
    .get(permissionId) as Record<string, unknown>;
  return mapPermissionRow(updated);
}

export function expireDataUse(
  handle: ProjectHandle,
  permissionId: string,
  reason: string,
  actor?: string
): DataUsePermissionRecord {
  assertWritable(handle);
  const row = handle.db
    .prepare("SELECT * FROM policy_permissions WHERE id = ?")
    .get(permissionId) as Record<string, unknown> | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `permission not found: ${permissionId}`);
  }

  const prevStatus = String(row.status) as PermissionStatus;
  const now = isoNow();
  const act = actor ?? handle.project.ownerId;

  transaction(handle.db, () => {
    handle.db
      .prepare("UPDATE policy_permissions SET status = 'expired', updated_at = ? WHERE id = ?")
      .run(now, permissionId);

    const histId = newId("permhist");
    handle.db
      .prepare(
        "INSERT INTO policy_status_history (id, permission_id, previous_status, new_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
      )
      .run(histId, permissionId, prevStatus, "expired", reason, act, now);
  });

  const updated = handle.db
    .prepare("SELECT * FROM policy_permissions WHERE id = ?")
    .get(permissionId) as Record<string, unknown>;
  return mapPermissionRow(updated);
}

export function getPermission(
  handle: ProjectHandle,
  permissionId: string
): DataUsePermissionRecord | null {
  const row = handle.db
    .prepare("SELECT * FROM policy_permissions WHERE id = ?")
    .get(permissionId) as Record<string, unknown> | undefined;
  if (!row) {
    return null;
  }
  return mapPermissionRow(row);
}

export function listPermissions(
  handle: ProjectHandle,
  inputVersionId?: string
): readonly DataUsePermissionRecord[] {
  const sql = inputVersionId
    ? "SELECT * FROM policy_permissions WHERE input_version_id = ? ORDER BY created_at ASC"
    : "SELECT * FROM policy_permissions ORDER BY created_at ASC";

  const rows = (inputVersionId ? handle.db.prepare(sql).all(inputVersionId) : handle.db.prepare(sql).all()) as Array<
    Record<string, unknown>
  >;

  return rows.map(mapPermissionRow);
}

export function listPermissionStatusHistory(
  handle: ProjectHandle,
  permissionId?: string
): readonly PolicyStatusHistoryRecord[] {
  const sql = permissionId
    ? "SELECT id, permission_id, previous_status, new_status, reason, actor, created_at FROM policy_status_history WHERE permission_id = ? ORDER BY created_at ASC"
    : "SELECT id, permission_id, previous_status, new_status, reason, actor, created_at FROM policy_status_history ORDER BY created_at ASC";

  const rows = (permissionId ? handle.db.prepare(sql).all(permissionId) : handle.db.prepare(sql).all()) as Array<{
    id: string;
    permission_id: string;
    previous_status: string;
    new_status: string;
    reason: string;
    actor: string;
    created_at: string;
  }>;

  return rows.map((r) => ({
    id: r.id,
    permissionId: r.permission_id,
    previousStatus: r.previous_status as PermissionStatus | "",
    newStatus: r.new_status as PermissionStatus,
    reason: r.reason,
    actor: r.actor,
    createdAt: r.created_at
  }));
}

export function evaluatePolicy(
  handle: ProjectHandle,
  request: PolicyEvaluationRequest
): PolicyDecision {
  const correlationId = request.correlationId ?? newId("corr");
  const createdAt = isoNow();
  const actor = request.actor ?? "system";
  const destination = request.destination;
  const purpose = request.purpose;
  const transformation = request.transformation ?? null;
  const isLocal = destination === "local";

  // 1. Validate inputs
  if (!request.inputVersions || request.inputVersions.length === 0) {
    const decision: PolicyDecision = {
      id: newId("dec"),
      correlationId,
      result: "deny",
      reason: "denied: no input versions specified",
      inputVersions: [],
      policyVersions: [],
      destination,
      purpose,
      transformation: transformation ?? undefined,
      actor,
      createdAt
    };
    persistDecision(handle, decision, request.branchId);
    return decision;
  }

  // 2. Check each input version exists in artifact_versions
  for (const v of request.inputVersions) {
    const row = handle.db.prepare("SELECT id FROM artifact_versions WHERE id = ?").get(v);
    if (!row) {
      const decision: PolicyDecision = {
        id: newId("dec"),
        correlationId,
        result: "deny",
        reason: `denied: input version not found: ${v}`,
        inputVersions: request.inputVersions,
        policyVersions: [],
        destination,
        purpose,
        transformation: transformation ?? undefined,
        actor,
        createdAt
      };
      persistDecision(handle, decision, request.branchId);
      return decision;
    }
  }

  // 3. Check classifications
  const unclassified: string[] = [];
  const classifications: Record<string, ClassificationRecord> = {};
  for (const v of request.inputVersions) {
    const c = getClassification(handle, v);
    if (!c) {
      unclassified.push(v);
    } else {
      classifications[v] = c;
    }
  }

  if (unclassified.length > 0) {
    if (!isLocal) {
      // SC-e03s01-P0-01: unclassified material is local-only
      const decision: PolicyDecision = {
        id: newId("dec"),
        correlationId,
        result: "deny",
        reason: `denied: unclassified material is local-only: ${unclassified.join(", ")} lacks classification`,
        inputVersions: request.inputVersions,
        policyVersions: [],
        destination,
        purpose,
        transformation: transformation ?? undefined,
        actor,
        createdAt
      };
      persistDecision(handle, decision, request.branchId);
      return decision;
    }
    // If local destination, unclassified material remains local-only, allow local operation
    const decision: PolicyDecision = {
      id: newId("dec"),
      correlationId,
      result: "allow",
      reason: "allowed: local-only access for unclassified material",
      inputVersions: request.inputVersions,
      policyVersions: [],
      destination,
      purpose,
      transformation: transformation ?? undefined,
      actor,
      createdAt
    };
    persistDecision(handle, decision, request.branchId);
    return decision;
  }

  // If local destination and all classified, check if restricted from local
  if (isLocal) {
    const decision: PolicyDecision = {
      id: newId("dec"),
      correlationId,
      result: "allow",
      reason: "allowed: local destination permitted",
      inputVersions: request.inputVersions,
      policyVersions: [],
      destination,
      purpose,
      transformation: transformation ?? undefined,
      actor,
      createdAt
    };
    persistDecision(handle, decision, request.branchId);
    return decision;
  }

  // 4. External destination: every input version requires an active, matching, unexpired permission
  const matchingPolicyIds: string[] = [];
  const nowTime = new Date().getTime();

  for (const v of request.inputVersions) {
    const permissions = listPermissions(handle, v);

    // Look for matching permission
    let matched = false;
    let denialReason = `denied: no matching permission found for input ${v} to destination '${destination}' and purpose '${purpose}'`;

    for (const p of permissions) {
      if (p.destination !== destination && p.destination !== "*") {
        continue;
      }
      if (p.purpose !== purpose && p.purpose !== "*") {
        continue;
      }

      if (p.status === "withdrawn") {
        denialReason = `denied: permission ${p.id} for input ${v} was withdrawn`;
        continue;
      }

      if (p.status === "expired") {
        denialReason = `denied: permission ${p.id} for input ${v} has expired`;
        continue;
      }

      // Check validity conditions (expiresAt)
      if (p.validity?.expiresAt) {
        const exp = new Date(p.validity.expiresAt).getTime();
        if (!Number.isNaN(exp) && exp < nowTime) {
          denialReason = `denied: permission ${p.id} for input ${v} expired at ${p.validity.expiresAt}`;
          continue;
        }
      }

      // Check transformation if specified
      if (request.transformation && p.allowedTransformations.length > 0) {
        if (!p.allowedTransformations.includes(request.transformation)) {
          denialReason = `denied: transformation '${request.transformation}' not permitted by permission ${p.id}`;
          continue;
        }
      }

      // Found active matching permission!
      matched = true;
      matchingPolicyIds.push(p.id);
      break;
    }

    if (!matched) {
      const decision: PolicyDecision = {
        id: newId("dec"),
        correlationId,
        result: "deny",
        reason: denialReason,
        inputVersions: request.inputVersions,
        policyVersions: matchingPolicyIds,
        destination,
        purpose,
        transformation: transformation ?? undefined,
        actor,
        createdAt
      };
      persistDecision(handle, decision, request.branchId);
      return decision;
    }
  }

  // All inputs have active matching permissions!
  const decision: PolicyDecision = {
    id: newId("dec"),
    correlationId,
    result: "allow",
    reason: "allowed: all input versions authorized by active policy permissions",
    inputVersions: request.inputVersions,
    policyVersions: matchingPolicyIds,
    destination,
    purpose,
    transformation: transformation ?? undefined,
    actor,
    createdAt
  };
  persistDecision(handle, decision, request.branchId);
  return decision;
}

function persistDecision(handle: ProjectHandle, decision: PolicyDecision, branchId?: string): void {
  if (handle.writable) {
    try {
      transaction(handle.db, () => {
        handle.db
          .prepare(
            `INSERT INTO policy_decisions (
              id, correlation_id, operation, destination, purpose, result, reason, input_version_ids, policy_version_ids, transformation, branch_id, actor, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            decision.id,
            decision.correlationId,
            "policy-evaluation",
            decision.destination,
            decision.purpose,
            decision.result,
            decision.reason,
            JSON.stringify(decision.inputVersions),
            JSON.stringify(decision.policyVersions),
            decision.transformation ?? null,
            branchId ?? null,
            decision.actor,
            decision.createdAt
          );
      });
    } catch {
      // In read-only or fallback mode, don't crash on persistence
    }
  }
}

export function listPolicyHistory(
  handle: ProjectHandle,
  inputVersionId?: string
): readonly PolicyHistoryItem[] {
  const items: PolicyHistoryItem[] = [];

  // Classifications
  const classRows = handle.db
    .prepare(
      inputVersionId
        ? "SELECT id, input_version_id, sensitivity, basis, actor, created_at FROM classifications WHERE input_version_id = ? ORDER BY created_at ASC"
        : "SELECT id, input_version_id, sensitivity, basis, actor, created_at FROM classifications ORDER BY created_at ASC"
    )
    .all(...(inputVersionId ? [inputVersionId] : [])) as Array<{
    id: string;
    input_version_id: string;
    sensitivity: string;
    basis: string;
    actor: string;
    created_at: string;
  }>;

  for (const c of classRows) {
    items.push({
      kind: "classification",
      id: c.id,
      inputVersionId: c.input_version_id,
      details: `sensitivity=${c.sensitivity}, basis=${c.basis}`,
      status: "classified",
      actor: c.actor,
      createdAt: c.created_at
    });
  }

  // Permissions
  const permRows = handle.db
    .prepare(
      inputVersionId
        ? "SELECT id, input_version_id, destination, purpose, authority, status, created_at FROM policy_permissions WHERE input_version_id = ? ORDER BY created_at ASC"
        : "SELECT id, input_version_id, destination, purpose, authority, status, created_at FROM policy_permissions ORDER BY created_at ASC"
    )
    .all(...(inputVersionId ? [inputVersionId] : [])) as Array<{
    id: string;
    input_version_id: string;
    destination: string;
    purpose: string;
    authority: string;
    status: string;
    created_at: string;
  }>;

  for (const p of permRows) {
    items.push({
      kind: "grant",
      id: p.id,
      inputVersionId: p.input_version_id,
      details: `destination=${p.destination}, purpose=${p.purpose}, authority=${p.authority}`,
      status: p.status,
      actor: p.authority,
      createdAt: p.created_at
    });
  }

  // Status changes
  const histRows = handle.db
    .prepare(
      "SELECT h.id, h.permission_id, h.previous_status, h.new_status, h.reason, h.actor, h.created_at, p.input_version_id FROM policy_status_history h JOIN policy_permissions p ON h.permission_id = p.id ORDER BY h.created_at ASC"
    )
    .all() as Array<{
    id: string;
    permission_id: string;
    previous_status: string;
    new_status: string;
    reason: string;
    actor: string;
    created_at: string;
    input_version_id: string;
  }>;

  for (const h of histRows) {
    if (!inputVersionId || h.input_version_id === inputVersionId) {
      items.push({
        kind: "status-change",
        id: h.id,
        inputVersionId: h.input_version_id,
        details: `permission=${h.permission_id}: ${h.previous_status || "none"} -> ${h.new_status}`,
        status: h.new_status,
        reason: h.reason,
        actor: h.actor,
        createdAt: h.created_at
      });
    }
  }

  // Decisions
  const decRows = handle.db
    .prepare("SELECT * FROM policy_decisions ORDER BY created_at ASC")
    .all() as Array<Record<string, unknown>>;

  for (const d of decRows) {
    let inputs: string[] = [];
    try {
      inputs = JSON.parse(String(d.input_version_ids));
    } catch {
      inputs = [];
    }

    if (!inputVersionId || inputs.includes(inputVersionId)) {
      items.push({
        kind: "decision",
        id: String(d.id),
        inputVersionId: inputs[0],
        details: `operation=${d.operation}, destination=${d.destination}, purpose=${d.purpose}, result=${d.result}`,
        status: String(d.result),
        reason: String(d.reason),
        actor: String(d.actor),
        createdAt: String(d.created_at)
      });
    }
  }

  // Sort by createdAt
  items.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return items;
}

export function getEffectiveRestriction(
  handle: ProjectHandle,
  inputVersionIds: readonly string[]
): PolicyRestriction {
  let highestSensitivity = "public";
  const destinationsSet = new Set<string>();
  const purposesSet = new Set<string>();
  const transformationsSet = new Set<string>();
  let localOnly = false;
  let isWithdrawn = false;
  let isExpired = false;

  for (const v of inputVersionIds) {
    const c = getClassification(handle, v);
    if (!c) {
      localOnly = true;
    } else {
      if (c.sensitivity === "restricted" || c.sensitivity === "participant-identifiable") {
        highestSensitivity = c.sensitivity;
      } else if (c.sensitivity === "confidential" && highestSensitivity !== "restricted" && highestSensitivity !== "participant-identifiable") {
        highestSensitivity = c.sensitivity;
      }
    }

    const perms = listPermissions(handle, v);
    if (perms.length === 0) {
      localOnly = true;
    } else {
      for (const p of perms) {
        if (p.status === "withdrawn") {
          isWithdrawn = true;
        }
        if (p.status === "expired") {
          isExpired = true;
        }
        if (p.status === "active") {
          destinationsSet.add(p.destination);
          purposesSet.add(p.purpose);
          p.allowedTransformations.forEach((t) => transformationsSet.add(t));
        }
      }
    }
  }

  return {
    inputVersionId: inputVersionIds.join(","),
    sensitivity: highestSensitivity,
    allowedDestinations: Array.from(destinationsSet),
    allowedPurposes: Array.from(purposesSet),
    allowedTransformations: Array.from(transformationsSet),
    localOnly,
    isWithdrawn,
    isExpired
  };
}

function mapPermissionRow(row: Record<string, unknown>): DataUsePermissionRecord {
  let allowedTransformations: string[] = [];
  try {
    allowedTransformations = JSON.parse(String(row.allowed_transformations ?? "[]"));
  } catch {
    allowedTransformations = [];
  }

  let validity: ValidityConditions = {};
  try {
    validity = JSON.parse(String(row.validity_conditions ?? "{}"));
  } catch {
    validity = {};
  }

  return {
    id: String(row.id),
    inputVersionId: String(row.input_version_id),
    destination: String(row.destination),
    purpose: String(row.purpose),
    authority: String(row.authority),
    allowedTransformations,
    validity,
    status: String(row.status) as PermissionStatus,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}
