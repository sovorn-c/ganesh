// story: e02s01
import { createHash, randomUUID } from "node:crypto";
import { lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { ProjectStoreError } from "../project/project-types.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SHA256 = /^[a-f0-9]{64}$/;

export function assertIdentifier(value: string, label: string): string {
  if (!IDENTIFIER.test(value)) {
    throw new ProjectStoreError("invalid-identifier", `${label} must use a safe identifier`);
  }
  return value;
}

export function assertHash(value: string, label = "hash"): string {
  if (!SHA256.test(value)) {
    throw new ProjectStoreError("invalid-hash", `${label} must be a lowercase SHA-256 hash`);
  }
  return value;
}

export function resolveProjectRoot(rootPath: string): string {
  if (rootPath.trim() === "") {
    throw new ProjectStoreError("invalid-path", "project root must not be empty");
  }
  return resolve(rootPath);
}

export function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

export function pathInside(parent: string, candidate: string): boolean {
  const distance = relative(resolve(parent), resolve(candidate));
  return distance === "" || (distance !== ".." && !distance.startsWith(`..${sep}`) && !isAbsolute(distance));
}

export function hasSymlinkBetween(path: string, boundary: string): boolean {
  const resolvedBoundary = resolve(boundary);
  let current = resolve(path);
  while (current !== resolvedBoundary) {
    try {
      if (lstatSync(current).isSymbolicLink()) { return true; }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") { return true; }
    }
    const parent = resolve(current, "..");
    if (parent === current) { return false; }
    current = parent;
  }
  return false;
}

export function safeChildPath(parent: string, child: string, label: string): string {
  if (child.trim() === "" || isAbsolute(child)) {
    throw new ProjectStoreError("invalid-path", `${label} must be a non-empty relative path`);
  }
  const candidate = resolve(parent, child);
  if (!pathInside(parent, candidate)) {
    throw new ProjectStoreError("path-escape", `${label} must remain inside the configured storage root`);
  }
  return candidate;
}

export function bytesFor(content: string | Uint8Array): Uint8Array {
  return typeof content === "string" ? new TextEncoder().encode(content) : content;
}

export function sha256(content: Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function newId(prefix: string): string {
  return `${prefix}-${randomUUID()}`;
}

export function isoNow(): string {
  return new Date().toISOString();
}

export function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new ProjectStoreError("invalid-record", `${label} is not a text value`);
  }
  return value;
}

export function numberValue(value: unknown, label: string): number {
  const number = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isFinite(number)) {
    throw new ProjectStoreError("invalid-record", `${label} is not a numeric value`);
  }
  return number;
}

export function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function optionalNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : numberValue(value, "optional value");
}
