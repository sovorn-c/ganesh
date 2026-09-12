// story: e02s01
import { closeSync, existsSync, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import {
  type ArtifactInspection,
  type ArtifactVersionInput,
  type ArtifactVersionRecord,
  type ContentStatus,
  type DependencyReference,
  type ProjectHandle,
  ProjectStoreError
} from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { transaction } from "../persistence/schema.js";
import { assertHash, assertIdentifier, bytesFor, isoNow, newId, pathInside, safeChildPath, sha256, stringValue, optionalNumber } from "../persistence/storage-utils.js";

type ArtifactRow = Record<string, unknown>;

function rowFor(handle: ProjectHandle, versionId: string): ArtifactRow {
  const row = handle.db.prepare(
    "SELECT id, logical_id, version_label, content_hash, storage_path, byte_length, origin, access_level, created_at FROM artifact_versions WHERE id = ?"
  ).get(versionId) as ArtifactRow | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("artifact-not-found", `artifact version ${versionId} was not found`);
  }
  return row;
}

function recordFor(handle: ProjectHandle, row: ArtifactRow): ArtifactVersionRecord {
  let storedPath: string | null = null;
  if (typeof row.storage_path === "string") {
    try {
      const candidate = safeChildPath(handle.project.artifactRoot, row.storage_path, "stored artifact path");
      if (existsSync(candidate) && lstatSync(candidate).isSymbolicLink()) {
        throw new ProjectStoreError("path-escape", "stored artifact path is a symbolic link");
      }
      const realRoot = realpathSync(handle.project.artifactRoot);
      const realParent = realpathSync(dirname(candidate));
      if (!pathInside(realRoot, realParent)) {
        throw new ProjectStoreError("path-escape", "stored artifact path resolves outside the artifact root");
      }
      storedPath = candidate;
    } catch (error) {
      if (error instanceof ProjectStoreError) {
        storedPath = null;
      } else {
        // A missing parent is retained as a lexical path so inspection reports missing.
        try {
          storedPath = safeChildPath(handle.project.artifactRoot, row.storage_path, "stored artifact path");
        } catch {
          storedPath = null;
        }
      }
    }
  }
  return {
    id: stringValue(row.id, "artifact id"),
    logicalId: stringValue(row.logical_id, "artifact logical id"),
    version: stringValue(row.version_label, "artifact version"),
    contentHash: typeof row.content_hash === "string" ? row.content_hash : null,
    storagePath: storedPath,
    byteLength: optionalNumber(row.byte_length),
    origin: stringValue(row.origin, "artifact origin"),
    access: stringValue(row.access_level, "artifact access") as ArtifactVersionRecord["access"],
    createdAt: stringValue(row.created_at, "artifact creation time")
  };
}

function dependenciesFor(handle: ProjectHandle, versionId: string): readonly DependencyReference[] {
  const rows = handle.db.prepare(
    "SELECT artifact_version_id, dependency_version_id, relation FROM dependencies WHERE artifact_version_id = ? ORDER BY dependency_version_id, relation"
  ).all(versionId) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    artifactVersionId: stringValue(row.artifact_version_id, "dependency artifact id"),
    dependencyVersionId: stringValue(row.dependency_version_id, "dependency version id"),
    relation: stringValue(row.relation, "dependency relation")
  }));
}

function relativeStoragePath(root: string, path: string): string {
  return relative(root, path).split("\\").join("/");
}

function flushFile(path: string): void {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export function registerArtifactVersion(handle: ProjectHandle, input: ArtifactVersionInput): ArtifactVersionRecord {
  assertWritable(handle);
  assertIdentifier(input.logicalId, "logicalId");
  assertIdentifier(input.version, "version");
  const versionId = input.versionId === undefined ? newId("artifact-version") : assertIdentifier(input.versionId, "versionId");
  const access = input.access ?? (input.availability === "unavailable" ? "unavailable" : "full-text");
  if (!["full-text", "metadata-only", "abstract-only", "unavailable"].includes(access)) {
    throw new ProjectStoreError("invalid-artifact", "artifact access must be a supported access level");
  }
  if (input.origin !== undefined && input.origin.trim() === "") {
    throw new ProjectStoreError("invalid-artifact", "artifact origin must not be empty");
  }
  const unavailable = input.availability === "unavailable" || access === "unavailable";
  if (unavailable && input.content !== undefined) {
    throw new ProjectStoreError("invalid-artifact", "unavailable artifacts cannot include local content");
  }
  if (!unavailable && input.content === undefined) {
    throw new ProjectStoreError("invalid-artifact", "available artifacts require content");
  }

  const content = input.content === undefined ? undefined : bytesFor(input.content);
  const actualHash = content === undefined ? null : sha256(content);
  if (actualHash !== null && input.expectedHash !== undefined && assertHash(input.expectedHash, "expectedHash") !== actualHash) {
    throw new ProjectStoreError("hash-mismatch", "artifact content does not match expected hash");
  }
  const hash = actualHash ?? (input.expectedHash === undefined ? null : assertHash(input.expectedHash, "expectedHash"));
  const artifactRoot = handle.project.artifactRoot;
  const finalRelativePath = input.relativePath ?? (hash === null ? `${versionId}.unavailable` : join(hash.slice(0, 2), `${versionId}.artifact`));
  const finalPath = safeChildPath(artifactRoot, finalRelativePath, "artifact storage path");
  const temporaryPath = `${finalPath}.tmp-${newId("write")}`;
  let finalized = false;
  let committed = false;

  try {
    if (content !== undefined) {
      mkdirSync(dirname(finalPath), { recursive: true });
      try {
        if (!pathInside(realpathSync(artifactRoot), realpathSync(dirname(finalPath)))) {
          throw new ProjectStoreError("path-escape", "artifact storage path resolves outside the artifact root");
        }
      } catch (error) {
        if (error instanceof ProjectStoreError) {
          throw error;
        }
        throw new ProjectStoreError("invalid-path", "artifact storage parent could not be resolved safely");
      }
      if (input.failAt === "before-finalize") {
        throw new ProjectStoreError("registration-failed", "injected failure before artifact finalization");
      }
      if (input.failAt === "disk-full") {
        const err = new ProjectStoreError("registration-failed", "injected disk-full: no space left on device");
        (err as unknown as Record<string, string>).code = "ENOSPC";
        throw err;
      }
      writeFileSync(temporaryPath, content, { flag: "wx" });
      flushFile(temporaryPath);
      // A hard link creates the final entry without replacing an existing immutable file.
      linkSync(temporaryPath, finalPath);
      finalized = true;
      rmSync(temporaryPath, { force: true });
      if (input.failAt === "after-finalize-before-register") {
        throw new ProjectStoreError("registration-failed", "injected failure after artifact finalization");
      }
    }

    const now = isoNow();
    transaction(handle.db, () => {
      handle.db.prepare(
        "INSERT INTO artifact_versions (id, logical_id, version_label, content_hash, storage_path, byte_length, origin, access_level, content_status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        versionId,
        input.logicalId,
        input.version,
        hash,
        content === undefined ? null : relativeStoragePath(artifactRoot, finalPath),
        content?.byteLength ?? null,
        input.origin ?? "local",
        access,
        unavailable ? "unavailable" : "available",
        now
      );
      for (const dependency of input.dependencies ?? []) {
        assertIdentifier(dependency.versionId, "dependency versionId");
        if (dependency.versionId === versionId) {
          throw new ProjectStoreError("invalid-dependency", "an artifact cannot depend on itself");
        }
        const relation = dependency.relation ?? "derived-from";
        if (relation.trim() === "") {
          throw new ProjectStoreError("invalid-dependency", "dependency relation must not be empty");
        }
        const exists = handle.db.prepare("SELECT 1 AS present FROM artifact_versions WHERE id = ?").get(dependency.versionId);
        if (exists === undefined) {
          throw new ProjectStoreError("dependency-not-found", `dependency version ${dependency.versionId} was not found`);
        }
        handle.db.prepare(
          "INSERT INTO dependencies (artifact_version_id, dependency_version_id, relation) VALUES (?, ?, ?)"
        ).run(versionId, dependency.versionId, relation);
      }
    });
    committed = true;
    if (input.failAt === "after-commit" || input.failAt === "after-register") {
      throw new ProjectStoreError("registration-failed", "injected failure after artifact registration commit");
    }
    return recordFor(handle, rowFor(handle, versionId));
  } catch (error) {
    if (!committed) {
      rmSync(temporaryPath, { force: true });
      if (finalized) {
        rmSync(finalPath, { force: true });
      }
    }
    if (input.failAt === "disk-full" && handle.writable) {
      try {
        const id = newId("checkpoint");
        transaction(handle.db, () => {
          handle.db.prepare(
            "INSERT INTO recovery_checkpoints (id, operation, stage, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)"
          ).run(id, "artifact-registration", "finalize", "failed", "disk-full: ENOSPC", isoNow());
        });
      } catch { /* best effort */ }
    }
    throw error;
  }
}

export function getArtifactVersion(handle: ProjectHandle, versionId: string): ArtifactVersionRecord {
  assertIdentifier(versionId, "versionId");
  return recordFor(handle, rowFor(handle, versionId));
}

export function inspectArtifactVersion(handle: ProjectHandle, versionId: string): ArtifactInspection {
  const record = getArtifactVersion(handle, versionId);
  let contentStatus: ContentStatus;
  let detail: string;
  if (record.access === "unavailable" || record.storagePath === null || record.contentHash === null) {
    contentStatus = "unavailable";
    detail = "local content is unavailable; metadata is retained";
  } else if (!existsSync(record.storagePath)) {
    contentStatus = "missing";
    detail = "the recorded artifact file is missing";
  } else {
    try {
      const bytes = readFileSync(record.storagePath);
      const observedHash = sha256(bytes);
      if (observedHash !== record.contentHash || (record.byteLength !== null && bytes.byteLength !== record.byteLength)) {
        contentStatus = "corrupt";
        detail = "the recorded bytes do not match the stored hash or length";
      } else {
        contentStatus = "available";
        detail = "the recorded bytes match the stored content hash";
      }
    } catch {
      contentStatus = "unavailable";
      detail = "the recorded artifact file could not be read locally";
    }
  }
  return { ...record, contentStatus, detail, dependencies: dependenciesFor(handle, versionId) };
}

export function listArtifactVersions(handle: ProjectHandle): readonly ArtifactVersionRecord[] {
  const rows = handle.db.prepare("SELECT id, logical_id, version_label, content_hash, storage_path, byte_length, origin, access_level, created_at FROM artifact_versions ORDER BY logical_id, version_label").all() as ArtifactRow[];
  return rows.map((row) => recordFor(handle, row));
}

export function listDependencies(handle: ProjectHandle, versionId: string): readonly DependencyReference[] {
  assertIdentifier(versionId, "versionId");
  rowFor(handle, versionId);
  return dependenciesFor(handle, versionId);
}

export function listTemporaryArtifactFiles(handle: ProjectHandle): readonly string[] {
  const entries = listArtifactEntries(handle.project.artifactRoot);
  return entries.filter((path) => path.endsWith(".tmp") || path.includes(".tmp-") || path.endsWith(".incomplete"));
}

function listArtifactEntries(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  try {
    if (lstatSync(root).isSymbolicLink()) {
      return [];
    }
  } catch {
    return [];
  }
  const result: string[] = [];
  const visit = (directory: string): void => {
    let entries: readonly string[];
    try {
      entries = readdirSync(directory);
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(directory, entry);
      try {
        const entryInfo = lstatSync(path);
        if (entryInfo.isSymbolicLink()) {
          continue;
        }
        if (entryInfo.isDirectory()) {
          visit(path);
        } else {
          result.push(path);
        }
      } catch {
        // A disappearing temporary file is already reconciled.
      }
    }
  };
  visit(root);
  return result;
}
