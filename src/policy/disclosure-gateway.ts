// story: e03s02
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import {
  evaluatePolicy,
  getClassification,
  listPermissions
} from "./policy-store.js";
import {
  DISCLOSURE_OPERATIONS,
  type DerivedMaterialRecord,
  type DisclosureDecision,
  type DisclosureOperationKind,
  type DisclosureRequest,
  type EffectiveRestrictions
} from "./disclosure-types.js";

export function resolveTransitiveVersions(
  handle: ProjectHandle,
  versionIds: readonly string[]
): Set<string> {
  const all = new Set<string>();
  const queue = [...versionIds];

  while (queue.length > 0) {
    const v = queue.shift();
    if (!v || all.has(v)) {
      continue;
    }
    all.add(v);

    const deps = handle.db
      .prepare("SELECT dependency_version_id FROM dependencies WHERE artifact_version_id = ?")
      .all(v) as Array<{ dependency_version_id: string }>;

    for (const d of deps) {
      if (!all.has(d.dependency_version_id)) {
        queue.push(d.dependency_version_id);
      }
    }
  }

  return all;
}

export function effectiveRestriction(
  handle: ProjectHandle,
  sourceVersions: readonly string[],
  _branchId?: string
): EffectiveRestrictions {
  const allVersions = resolveTransitiveVersions(handle, sourceVersions);
  const allVersionList = Array.from(allVersions);

  let highestSensitivity = "public";
  let isLocalOnly = false;
  let isWithdrawn = false;
  let isExpired = false;

  const destinationSets: Array<Set<string>> = [];
  const purposeSets: Array<Set<string>> = [];
  const transformationSets: Array<Set<string>> = [];
  const restrictions: string[] = [];

  const sensitivityRanks: Record<string, number> = {
    public: 0,
    confidential: 1,
    "participant-identifiable": 2,
    restricted: 3
  };

  for (const v of allVersionList) {
    const classification = getClassification(handle, v);
    if (!classification) {
      isLocalOnly = true;
      restrictions.push(`unclassified:${v}`);
    } else {
      const rank = sensitivityRanks[classification.sensitivity] ?? 1;
      const currentRank = sensitivityRanks[highestSensitivity] ?? 0;
      if (rank > currentRank) {
        highestSensitivity = classification.sensitivity;
      }
      restrictions.push(`sensitivity:${classification.sensitivity}:${v}`);
    }

    const perms = listPermissions(handle, v);
    if (perms.length === 0) {
      isLocalOnly = true;
      restrictions.push(`no-permission:${v}`);
    } else {
      const vDests = new Set<string>();
      const vPurposes = new Set<string>();
      const vTransforms = new Set<string>();

      for (const p of perms) {
        if (p.status === "withdrawn") {
          isWithdrawn = true;
          restrictions.push(`withdrawn-permission:${p.id}:${v}`);
        }
        if (p.status === "expired") {
          isExpired = true;
          restrictions.push(`expired-permission:${p.id}:${v}`);
        }
        if (p.status === "active") {
          vDests.add(p.destination);
          vPurposes.add(p.purpose);
          p.allowedTransformations.forEach((t) => vTransforms.add(t));
        }
      }

      if (vDests.size > 0) {
        destinationSets.push(vDests);
      }
      if (vPurposes.size > 0) {
        purposeSets.push(vPurposes);
      }
      if (vTransforms.size > 0) {
        transformationSets.push(vTransforms);
      }
    }
  }

  // Intersect destinations and purposes for combination (most restrictive)
  const permittedDestinations = intersectSets(destinationSets);
  const permittedPurposes = intersectSets(purposeSets);
  const permittedTransformations = Array.from(unionSets(transformationSets));

  return {
    sourceVersionIds: sourceVersions,
    allResolvedVersionIds: allVersionList,
    highestSensitivity,
    isLocalOnly,
    isWithdrawn,
    isExpired,
    permittedDestinations,
    permittedPurposes,
    permittedTransformations,
    restrictions
  };
}

function intersectSets(sets: Array<Set<string>>): string[] {
  if (sets.length === 0) {
    return [];
  }
  const first = sets[0];
  const result: string[] = [];
  for (const item of first) {
    if (sets.every((s) => s.has(item) || s.has("*"))) {
      result.push(item);
    }
  }
  return result;
}

function unionSets(sets: Array<Set<string>>): Set<string> {
  const result = new Set<string>();
  for (const s of sets) {
    for (const item of s) {
      result.add(item);
    }
  }
  return result;
}

export function deriveMaterial(
  handle: ProjectHandle,
  inputVersions: readonly string[],
  transformation: string,
  branchId?: string
): DerivedMaterialRecord {
  assertWritable(handle);
  if (!inputVersions || inputVersions.length === 0) {
    throw new ProjectStoreError("invalid-argument", "inputVersions must not be empty");
  }
  if (!transformation || typeof transformation !== "string") {
    throw new ProjectStoreError("invalid-argument", "transformation must be a non-empty string");
  }

  const effective = effectiveRestriction(handle, inputVersions, branchId);
  const id = newId("deriv");
  const createdAt = isoNow();
  const inheritedRestrictions = [
    `sensitivity:${effective.highestSensitivity}`,
    effective.isLocalOnly ? "restriction:local-only" : "restriction:external-eligible",
    ...effective.restrictions
  ];

  transaction(handle.db, () => {
    handle.db
      .prepare(
        `INSERT INTO derived_materials (
          id, candidate_version_id, source_version_ids, transformation, inherited_restrictions, branch_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        null,
        JSON.stringify(inputVersions),
        transformation,
        JSON.stringify(inheritedRestrictions),
        branchId ?? null,
        createdAt
      );
  });

  return {
    id,
    sourceVersionIds: inputVersions,
    transformation,
    inheritedRestrictions,
    branchId,
    createdAt
  };
}

const ALLOWED_OPERATIONS_ONLY_KEYS = new Set([
  "kind",
  "operationsonly",
  "commandid",
  "correlationid",
  "runid",
  "limit",
  "exportid",
  "timestamp",
  "status",
  "format",
  "destination",
  "purpose",
  "destinationpath",
  "bundlepath",
  "createdat",
  "schemaversion",
  "severity"
]);

export function isOperationsOnlyPayload(payload: unknown): boolean {
  if (payload === undefined) {
    return true;
  }
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }
  const obj = payload as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    const lower = key.toLowerCase();
    if (!ALLOWED_OPERATIONS_ONLY_KEYS.has(lower)) {
      return false;
    }
    normalized[lower] = value;
  }

  if ("operationsonly" in normalized) {
    if (typeof normalized.operationsonly !== "boolean" || normalized.operationsonly !== true) {
      return false;
    }
  }
  if ("kind" in normalized) {
    if (
      typeof normalized.kind !== "string" ||
      !["diagnostic", "telemetry", "operations", "health"].includes(normalized.kind)
    ) {
      return false;
    }
  }
  if ("limit" in normalized) {
    if (typeof normalized.limit !== "number" || !Number.isFinite(normalized.limit) || normalized.limit < 0) {
      return false;
    }
  }
  if ("schemaversion" in normalized) {
    if (typeof normalized.schemaversion !== "number" || !Number.isInteger(normalized.schemaversion)) {
      return false;
    }
  }
  if ("severity" in normalized) {
    if (typeof normalized.severity !== "string" || !["info", "warning", "error"].includes(normalized.severity)) {
      return false;
    }
  }

  const stringKeys = [
    "commandid",
    "correlationid",
    "runid",
    "exportid",
    "destination",
    "purpose",
    "destinationpath",
    "bundlepath",
    "createdat",
    "timestamp",
    "status",
    "format"
  ] as const;

  for (const key of stringKeys) {
    if (key in normalized && typeof normalized[key] !== "string") {
      return false;
    }
  }

  return true;
}

export function requestDisclosure(
  handle: ProjectHandle,
  request: DisclosureRequest
): DisclosureDecision {
  const correlationId = request.correlationId ?? newId("corr");
  const id = newId("discl");
  const createdAt = isoNow();

  // 1. Validate operation kind
  if (!DISCLOSURE_OPERATIONS.includes(request.operation)) {
    const decision: DisclosureDecision = {
      id,
      correlationId,
      operation: request.operation,
      destination: request.destination,
      purpose: request.purpose,
      sourceVersions: request.sourceVersions ?? [],
      transformation: request.transformation,
      branchId: request.branchId,
      status: "deny",
      reason: `denied: unsupported disclosure operation '${request.operation}'`,
      createdAt
    };
    recordDisclosureDecision(handle, decision);
    return decision;
  }

  // 2. Validate sources
  if (!request.sourceVersions || request.sourceVersions.length === 0) {
    if (request.operation === "diagnostic" || request.operation === "telemetry") {
      if (isOperationsOnlyPayload(request.payload)) {
        if (request.destination === "local") {
          const decision: DisclosureDecision = {
            id,
            correlationId,
            operation: request.operation,
            destination: request.destination,
            purpose: request.purpose,
            sourceVersions: [],
            transformation: request.transformation,
            branchId: request.branchId,
            status: "allow",
            reason: `allowed: operations-only ${request.operation} disclosure for local destination`,
            createdAt
          };
          recordDisclosureDecision(handle, decision);
          return decision;
        }

        // Non-local destination
        if (
          !request.destination ||
          request.destination === "*" ||
          !request.purpose ||
          request.purpose === "*"
        ) {
          const decision: DisclosureDecision = {
            id,
            correlationId,
            operation: request.operation,
            destination: request.destination,
            purpose: request.purpose,
            sourceVersions: [],
            transformation: request.transformation,
            branchId: request.branchId,
            status: "deny",
            reason: `denied: non-local ${request.operation} disclosure requires explicit destination and purpose`,
            createdAt
          };
          recordDisclosureDecision(handle, decision);
          return decision;
        }

        const isOptedIn = request.optIn === true;

        if (!isOptedIn) {
          const decision: DisclosureDecision = {
            id,
            correlationId,
            operation: request.operation,
            destination: request.destination,
            purpose: request.purpose,
            sourceVersions: [],
            transformation: request.transformation,
            branchId: request.branchId,
            status: "deny",
            reason: `denied: remote ${request.operation} disclosure requires explicit owner opt-in`,
            createdAt
          };
          recordDisclosureDecision(handle, decision);
          return decision;
        }

        const decision: DisclosureDecision = {
          id,
          correlationId,
          operation: request.operation,
          destination: request.destination,
          purpose: request.purpose,
          sourceVersions: [],
          transformation: request.transformation,
          branchId: request.branchId,
          status: "allow",
          reason: `allowed: operations-only ${request.operation} disclosure for remote destination with owner opt-in`,
          createdAt
        };
        recordDisclosureDecision(handle, decision);
        return decision;
      } else {
        const decision: DisclosureDecision = {
          id,
          correlationId,
          operation: request.operation,
          destination: request.destination,
          purpose: request.purpose,
          sourceVersions: [],
          transformation: request.transformation,
          branchId: request.branchId,
          status: "deny",
          reason: `denied: payload contains research content or source versions`,
          createdAt
        };
        recordDisclosureDecision(handle, decision);
        return decision;
      }
    }

    const decision: DisclosureDecision = {
      id,
      correlationId,
      operation: request.operation,
      destination: request.destination,
      purpose: request.purpose,
      sourceVersions: [],
      transformation: request.transformation,
      branchId: request.branchId,
      status: "deny",
      reason: "denied: no source versions specified for disclosure",
      createdAt
    };
    recordDisclosureDecision(handle, decision);
    return decision;
  }

  // 3. Resolve effective restrictions (including transitive dependencies)
  const effective = effectiveRestriction(handle, request.sourceVersions, request.branchId);

  // 4. Evaluate destination
  const isLocal = request.destination === "local";

  if (!isLocal) {
    if (effective.isLocalOnly) {
      const decision: DisclosureDecision = {
        id,
        correlationId,
        operation: request.operation,
        destination: request.destination,
        purpose: request.purpose,
        sourceVersions: request.sourceVersions,
        transformation: request.transformation,
        branchId: request.branchId,
        status: "deny",
        reason: "denied: source material is restricted to local-only destinations",
        createdAt
      };
      recordDisclosureDecision(handle, decision);
      return decision;
    }

    if (effective.isWithdrawn) {
      const decision: DisclosureDecision = {
        id,
        correlationId,
        operation: request.operation,
        destination: request.destination,
        purpose: request.purpose,
        sourceVersions: request.sourceVersions,
        transformation: request.transformation,
        branchId: request.branchId,
        status: "deny",
        reason: "denied: permission for source version was withdrawn",
        createdAt
      };
      recordDisclosureDecision(handle, decision);
      return decision;
    }

    if (effective.isExpired) {
      const decision: DisclosureDecision = {
        id,
        correlationId,
        operation: request.operation,
        destination: request.destination,
        purpose: request.purpose,
        sourceVersions: request.sourceVersions,
        transformation: request.transformation,
        branchId: request.branchId,
        status: "deny",
        reason: "denied: permission for source version has expired",
        createdAt
      };
      recordDisclosureDecision(handle, decision);
      return decision;
    }

    // Call evaluatePolicy for all resolved versions
    const polDecision = evaluatePolicy(handle, {
      inputVersions: effective.allResolvedVersionIds,
      destination: request.destination,
      purpose: request.purpose,
      transformation: request.transformation,
      correlationId,
      branchId: request.branchId,
      actor: request.actor
    });

    const decision: DisclosureDecision = {
      id,
      correlationId,
      operation: request.operation,
      destination: request.destination,
      purpose: request.purpose,
      sourceVersions: request.sourceVersions,
      transformation: request.transformation,
      branchId: request.branchId,
      status: polDecision.result,
      reason: polDecision.reason,
      policyDecisionId: polDecision.id,
      createdAt
    };
    recordDisclosureDecision(handle, decision);
    return decision;
  }

  // Local destination: permitted
  const decision: DisclosureDecision = {
    id,
    correlationId,
    operation: request.operation,
    destination: request.destination,
    purpose: request.purpose,
    sourceVersions: request.sourceVersions,
    transformation: request.transformation,
    branchId: request.branchId,
    status: "allow",
    reason: `allowed: local operation '${request.operation}' approved`,
    createdAt
  };
  recordDisclosureDecision(handle, decision);
  return decision;
}

export function recordDisclosureDecision(
  handle: ProjectHandle,
  decision: DisclosureDecision
): string {
  if (handle.writable) {
    handle.assertCurrent();
    try {
      transaction(handle.db, () => {
        handle.db
          .prepare(
            `INSERT INTO disclosure_decisions (
              id, correlation_id, operation_kind, destination, purpose, source_version_ids, transformation, branch_id, status, reason, policy_decision_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            decision.id,
            decision.correlationId,
            decision.operation,
            decision.destination,
            decision.purpose,
            JSON.stringify(decision.sourceVersions),
            decision.transformation ?? null,
            decision.branchId ?? null,
            decision.status,
            decision.reason,
            decision.policyDecisionId ?? null,
            decision.createdAt
          );
      });
    } catch {
      // In read-only mode, do not throw
    }
  }
  return decision.id;
}

export function listDisclosureDecisions(
  handle: ProjectHandle,
  filter?: { branchId?: string; operation?: string }
): readonly DisclosureDecision[] {
  let sql = "SELECT * FROM disclosure_decisions";
  const params: string[] = [];
  const clauses: string[] = [];

  if (filter?.branchId) {
    clauses.push("branch_id = ?");
    params.push(filter.branchId);
  }
  if (filter?.operation) {
    clauses.push("operation_kind = ?");
    params.push(filter.operation);
  }
  if (clauses.length > 0) {
    sql += " WHERE " + clauses.join(" AND ");
  }
  sql += " ORDER BY created_at ASC";

  const rows = handle.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map((r) => {
    let sourceVersions: string[] = [];
    try {
      sourceVersions = JSON.parse(String(r.source_version_ids));
    } catch {
      sourceVersions = [];
    }

    return {
      id: String(r.id),
      correlationId: String(r.correlation_id),
      operation: String(r.operation_kind) as DisclosureOperationKind,
      destination: String(r.destination),
      purpose: String(r.purpose),
      sourceVersions,
      transformation: r.transformation ? String(r.transformation) : undefined,
      branchId: r.branch_id ? String(r.branch_id) : undefined,
      status: String(r.status) as "allow" | "deny",
      reason: String(r.reason),
      policyDecisionId: r.policy_decision_id ? String(r.policy_decision_id) : undefined,
      createdAt: String(r.created_at)
    };
  });
}
