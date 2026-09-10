// story: e04s01

import { isOwnerCapability, type OwnerCapability } from "../authority/capability-broker.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertIdentifier, isoNow, newId, stringValue } from "../persistence/storage-utils.js";

export function requireOwner(handle: ProjectHandle, capability: unknown, actor?: string): OwnerCapability {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "this action requires a trusted owner capability");
  }
  if (capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "owner capability does not belong to this project");
  }
  if (actor !== undefined && actor !== capability.ownerId) {
    throw new ProjectStoreError("forbidden", "actor must match the trusted project owner");
  }
  return capability;
}

export function text(value: unknown, label: string): string {
  return stringValue(value, label);
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function valueFromJson<T>(value: unknown, label: string): T {
  if (typeof value !== "string") {
    throw new ProjectStoreError("invalid-record", `${label} is not encoded as JSON`);
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new ProjectStoreError("invalid-record", `${label} contains invalid JSON`);
  }
}

export function arrayFromJson(value: unknown, label: string): string[] {
  if (typeof value !== "string") {
    throw new ProjectStoreError("invalid-record", `${label} is not encoded as JSON`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new ProjectStoreError("invalid-record", `${label} contains invalid JSON`);
  }
  if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === "string")) {
    throw new ProjectStoreError("invalid-record", `${label} must be a JSON array of text values`);
  }
  return [...parsed];
}

export function uniqueIds(values: readonly string[] | undefined, label: string): string[] {
  const result = [...new Set(values ?? [])];
  for (const value of result) {
    assertIdentifier(value, label);
  }
  return result;
}

export function setEqual(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((item) => rightSet.has(item));
}

export function now(): string {
  return isoNow();
}

export function id(prefix: string): string {
  return newId(prefix);
}

export function commandHash(value: unknown): string {
  const canonical = JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === "object" && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
  let hash = 2166136261;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function rowString(row: Record<string, unknown>, key: string): string {
  return text(row[key], key);
}