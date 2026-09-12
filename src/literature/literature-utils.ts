import { createHash } from "node:crypto";
import { assertIdentifier, sha256, isoNow, newId } from "../persistence/storage-utils.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import type { LiteratureOperation, LiteratureOperationStatus } from "./literature-types.js";

export function json(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item instanceof Set ? [...item] : item);
}

export function payloadHash(value: unknown): string {
  return sha256(new TextEncoder().encode(json(value)));
}

export function parse<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

export function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== "string") { throw new ProjectStoreError("invalid-record", `${key} must be text`); }
  return value;
}

export function optionalText(row: Record<string, unknown>, key: string): string | undefined {
  return typeof row[key] === "string" ? row[key] as string : undefined;
}

export function assertLiteratureSchema(handle: ProjectHandle): void {
  try {
    const row = handle.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'literature_operations'").get();
    if (row === undefined) { throw new Error("missing"); }
  } catch {
    throw new ProjectStoreError("literature-schema-unavailable", "E08 literature tables are unavailable; open a writable ready project or migrate it");
  }
}

export function allowed(handle: ProjectHandle, capability: unknown, operations: readonly string[]): boolean {
  if (isOwnerCapability(capability)) {return capability.ownerId === handle.project.ownerId;}
  return isWorkerCapability(capability)
    && capability.projectId === handle.project.id
    && operations.every((operation) => capability.canPerform(operation));
}

export function requireCapability(handle: ProjectHandle, capability: unknown, operations: readonly string[], message: string): void {
  if (!allowed(handle, capability, operations)) {throw new ProjectStoreError("forbidden", message);}
}

export function requireText(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") {throw new ProjectStoreError("invalid-argument", `${name} is required`);}
  return value;
}

export function requireCommand(commandId: string): string {
  return requireText(commandId, "commandId");
}

export function operation(handle: ProjectHandle, commandId: string): LiteratureOperation | undefined {
  const row = handle.db.prepare("SELECT * FROM literature_operations WHERE command_id = ?").get(commandId) as Record<string, unknown> | undefined;
  if (!row) {return undefined;}
  return {
    commandId: text(row, "command_id"), payloadHash: text(row, "payload_hash"), status: text(row, "status") as LiteratureOperationStatus,
    ...(optionalText(row, "result_id") ? { resultId: optionalText(row, "result_id") } : {}),
    ...(optionalText(row, "result_kind") ? { resultKind: optionalText(row, "result_kind") } : {}),
    ...(optionalText(row, "error_code") ? { errorCode: optionalText(row, "error_code") } : {}),
    createdAt: text(row, "created_at"), updatedAt: text(row, "updated_at")
  };
}

export function beginOperation(handle: ProjectHandle, commandId: string, hash: string): LiteratureOperation | undefined {
  const existing = operation(handle, commandId);
  if (existing) {
    if (existing.payloadHash !== hash) {throw new ProjectStoreError("literature-payload-conflict", "command ID was reused with a different payload");}
    return existing;
  }
  const now = isoNow();
  handle.db.prepare("INSERT INTO literature_operations (command_id, payload_hash, status, created_at, updated_at) VALUES (?, ?, 'pending', ?, ?)").run(commandId, hash, now, now);
  return undefined;
}

export function completeOperation(handle: ProjectHandle, commandId: string, resultId: string, resultKind: string): void {
  handle.db.prepare("UPDATE literature_operations SET status = 'complete', result_id = ?, result_kind = ?, error_code = NULL, updated_at = ? WHERE command_id = ?").run(resultId, resultKind, isoNow(), commandId);
}

export function failOperation(handle: ProjectHandle, commandId: string, errorCode: string): void {
  handle.db.prepare("UPDATE literature_operations SET status = 'failed', error_code = ?, updated_at = ? WHERE command_id = ?").run(errorCode, isoNow(), commandId);
}

export function resultIdFor(handle: ProjectHandle, commandId: string): string {
  const row = handle.db.prepare("SELECT result_id FROM literature_operations WHERE command_id = ?").get(commandId) as { result_id?: unknown } | undefined;
  if (typeof row?.result_id !== "string") {throw new ProjectStoreError("literature-operation-incomplete", "literature operation has no completed result");}
  return row.result_id;
}

export function recordId(prefix: string, requested?: string): string {
  if (requested !== undefined && requested.trim() === "") {throw new ProjectStoreError("invalid-identifier", `${prefix} must not be empty`);}
  return requested === undefined ? newId(prefix) : assertIdentifier(requested, prefix);
}

export function stableObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeError(error: unknown): string {
  return error instanceof ProjectStoreError ? error.code : "literature-operation-failed";
}

export function digestText(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
