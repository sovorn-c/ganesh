// story: e16s01, e16s04
import type { DatabaseSync } from "node:sqlite";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { redactDiagnostic } from "../runtime/preflight.js";
import { isoNow, newId, stringValue } from "../persistence/storage-utils.js";
import type {
  DiagnosticEvent,
  DiagnosticInput,
  DiagnosticQuery,
  DiagnosticSeverity
} from "./diagnostic-types.js";

export const DIAGNOSTIC_EVENT_LIMIT = 10000;

export function operationsSchemaAvailable(target: ProjectHandle | DatabaseSync): boolean {
  const db = "db" in target ? target.db : target;
  try {
    const row = db.prepare(
      "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('diagnostic_events', 'operations_commands')"
    ).get() as { count?: number } | undefined;
    return Number(row?.count ?? 0) === 2;
  } catch {
    return false;
  }
}

export function assertOperationsSchema(target: ProjectHandle | DatabaseSync): void {
  if (!operationsSchemaAvailable(target)) {
    throw new ProjectStoreError(
      "operations-schema-unavailable",
      "E16 operations tables are unavailable in this project"
    );
  }
}

export function getDiagnosticEventCount(target: ProjectHandle | DatabaseSync): number {
  const db = "db" in target ? target.db : target;
  assertOperationsSchema(db);
  const row = db.prepare("SELECT COUNT(*) AS count FROM diagnostic_events").get() as { count?: number } | undefined;
  return Number(row?.count ?? 0);
}

export function recordDiagnostic(
  handle: ProjectHandle,
  input: DiagnosticInput
): DiagnosticEvent {
  handle.assertCurrent();
  assertOperationsSchema(handle);

  const count = getDiagnosticEventCount(handle);
  if (count >= DIAGNOSTIC_EVENT_LIMIT) {
    throw new ProjectStoreError(
      "resource-limit",
      `diagnostic event cap reached (${DIAGNOSTIC_EVENT_LIMIT})`
    );
  }

  const id = newId("diag");
  const rawCorr = String(input.correlationId ?? "").trim();
  if (!rawCorr) {
    throw new ProjectStoreError("invalid-argument", "correlationId is required");
  }
  const correlationId = redactDiagnostic(rawCorr).slice(0, 160);

  const rawKind = String(input.kind ?? "").trim();
  const kind = redactDiagnostic(rawKind || "general").slice(0, 160);

  const rawCode = String(input.code ?? "").trim();
  const code = redactDiagnostic(rawCode || "unspecified").slice(0, 160);

  const commandId = input.commandId !== undefined
    ? redactDiagnostic(String(input.commandId)).slice(0, 160)
    : undefined;
  const runId = input.runId !== undefined
    ? redactDiagnostic(String(input.runId)).slice(0, 160)
    : undefined;

  const severity: DiagnosticSeverity = input.severity === "info" || input.severity === "warning" || input.severity === "error"
    ? input.severity
    : "error";
  const message = redactDiagnostic(String(input.message ?? "")).slice(0, 160);
  const createdAt = isoNow();

  handle.db.prepare(`
    INSERT INTO diagnostic_events (id, correlation_id, command_id, run_id, kind, code, severity, message, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    correlationId,
    commandId ?? null,
    runId ?? null,
    kind,
    code,
    severity,
    message,
    createdAt
  );

  return {
    id,
    correlationId,
    commandId,
    runId,
    kind,
    code,
    severity,
    message,
    createdAt
  };
}

export function inspectDiagnostics(
  handle: ProjectHandle,
  capability: unknown,
  query: DiagnosticQuery = {}
): readonly DiagnosticEvent[] {
  handle.assertCurrent();

  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot inspect diagnostics");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: inspect diagnostics requires owner capability");
  }
  if (capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }

  assertOperationsSchema(handle);

  const conditions: string[] = [];
  const params: unknown[] = [];

  if (query.correlationId !== undefined) {
    conditions.push("correlation_id = ?");
    params.push(query.correlationId);
  }
  if (query.runId !== undefined) {
    conditions.push("run_id = ?");
    params.push(query.runId);
  }
  if (query.commandId !== undefined) {
    conditions.push("command_id = ?");
    params.push(query.commandId);
  }

  let sql = "SELECT * FROM diagnostic_events";
  if (conditions.length > 0) {
    sql += ` WHERE ${conditions.join(" AND ")}`;
  }
  sql += " ORDER BY created_at ASC, rowid ASC";

  if (typeof query.limit === "number" && query.limit > 0) {
    sql += ` LIMIT ${Math.floor(query.limit)}`;
  }

  const rows = (handle.db.prepare(sql).all as (...args: unknown[]) => Array<Record<string, unknown>>)(...params);

  return rows.map((row) => ({
    id: stringValue(row.id, "diagnostic id"),
    correlationId: stringValue(row.correlation_id, "correlation id"),
    ...(typeof row.command_id === "string" ? { commandId: row.command_id } : {}),
    ...(typeof row.run_id === "string" ? { runId: row.run_id } : {}),
    kind: stringValue(row.kind, "diagnostic kind"),
    code: stringValue(row.code, "diagnostic code"),
    severity: stringValue(row.severity, "diagnostic severity") as DiagnosticSeverity,
    message: stringValue(row.message, "diagnostic message"),
    createdAt: stringValue(row.created_at, "diagnostic created_at")
  }));
}
