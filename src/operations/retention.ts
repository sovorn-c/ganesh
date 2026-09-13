// story: e16s04
import { createHash } from "node:crypto";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability, protectCanonicalWrite } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import { redactDiagnostic } from "../runtime/preflight.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import {
  assertOperationsSchema,
  DIAGNOSTIC_EVENT_LIMIT
} from "./diagnostic-store.js";
import type {
  DiagnosticPurgeRequest,
  DiagnosticPurgeResult
} from "./diagnostic-types.js";

export function purgeDiagnosticEvents(
  handle: ProjectHandle,
  capability: unknown,
  request: DiagnosticPurgeRequest
): DiagnosticPurgeResult {
  assertWritable(handle);

  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot purge diagnostics");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: purge diagnostics requires owner capability");
  }
  if (capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }

  if (!request || typeof request !== "object") {
    throw new ProjectStoreError("invalid-argument", "request must be an object");
  }

  const commandId = String(request?.commandId ?? "").trim();
  if (!commandId) {
    throw new ProjectStoreError("invalid-argument", "commandId is required for purge");
  }

  assertOperationsSchema(handle);

  return protectCanonicalWrite(capability, () => {
    const rawPayload = JSON.stringify({
      olderThan: request.olderThan ?? null,
      correlationId: request.correlationId ?? null,
      runId: request.runId ?? null
    });
    const payloadHash = request.payloadHash ?? createHash("sha256").update(rawPayload).digest("hex");

    const existing = handle.db.prepare(
      "SELECT * FROM operations_commands WHERE command_id = ?"
    ).get(commandId) as Record<string, unknown> | undefined;

    if (existing) {
      if (String(existing.payload_hash) !== payloadHash) {
        throw new ProjectStoreError(
          "conflict",
          `command ${commandId} already executed with different payload`
        );
      }
      if (existing.status === "complete" && existing.result_data) {
        return JSON.parse(String(existing.result_data)) as DiagnosticPurgeResult;
      }
    }

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (request.olderThan !== undefined) {
      conditions.push("created_at < ?");
      params.push(request.olderThan);
    }
    if (request.correlationId !== undefined) {
      conditions.push("correlation_id = ?");
      params.push(request.correlationId);
    }
    if (request.runId !== undefined) {
      conditions.push("run_id = ?");
      params.push(request.runId);
    }
    if (conditions.length === 0) {
      conditions.push("1 = 1");
    }

    const whereClause = conditions.join(" AND ");

    let deletedCount = 0;
    let finalRemaining = 0;
    const operationId = existing ? String(existing.id) : newId("op-cmd");
    const now = isoNow();

    transaction(handle.db, () => {
      const countRow = (handle.db.prepare(
        `SELECT COUNT(*) as count FROM diagnostic_events WHERE ${whereClause}`
      ).get as (...args: unknown[]) => { count?: number } | undefined)(...params);
      deletedCount = Number(countRow?.count ?? 0);

      (handle.db.prepare(
        `DELETE FROM diagnostic_events WHERE ${whereClause}`
      ).run as (...args: unknown[]) => void)(...params);

      const countAfter = Number(
        (handle.db.prepare("SELECT COUNT(*) AS count FROM diagnostic_events").get() as { count?: number } | undefined)?.count ?? 0
      );

      if (countAfter < DIAGNOSTIC_EVENT_LIMIT) {
        const diagId = newId("diag");
        const msg = redactDiagnostic(`purged ${deletedCount} diagnostic events`).slice(0, 160);
        const safeCommandId = redactDiagnostic(commandId).slice(0, 160);
        const safeRunId = request.runId !== undefined
          ? redactDiagnostic(String(request.runId)).slice(0, 160)
          : null;
        handle.db.prepare(`
          INSERT INTO diagnostic_events (id, correlation_id, command_id, run_id, kind, code, severity, message, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          diagId,
          "retention-purge",
          safeCommandId,
          safeRunId,
          "retention",
          "purge-complete",
          "info",
          msg,
          now
        );
      }

      finalRemaining = Number(
        (handle.db.prepare("SELECT COUNT(*) AS count FROM diagnostic_events").get() as { count?: number } | undefined)?.count ?? 0
      );

      const resultData: DiagnosticPurgeResult = {
        commandId,
        deletedCount,
        remainingCount: finalRemaining,
        recalled: false
      };

      handle.db.prepare(`
        INSERT OR REPLACE INTO operations_commands (id, command_id, kind, payload_hash, status, result_data, created_at, updated_at)
        VALUES (?, ?, 'purge-diagnostics', ?, 'complete', ?, ?, ?)
      `).run(operationId, commandId, payloadHash, JSON.stringify(resultData), now, now);
    });

    return {
      commandId,
      deletedCount,
      remainingCount: finalRemaining,
      recalled: false
    };
  });
}
