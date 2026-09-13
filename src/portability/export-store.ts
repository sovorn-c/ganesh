// story: e15s01
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PROJECT_SCHEMA_VERSION, type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability, type OwnerCapability, protectCanonicalWrite } from "../authority/capability-broker.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { configureDatabase, createSchema, readSchemaVersion, transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256, bytesFor, pathInside } from "../persistence/storage-utils.js";
import type {
  ExportRequest, PacketManifest, PacketFileEntry, OmissionNotice,
  ProjectPacket, ProjectPacketInspection, PacketHashResult, PortabilityOperation
} from "./portability-types.js";

export function getPortabilityOperation(handle: ProjectHandle, commandId: string): PortabilityOperation | undefined {
  const row = handle.db.prepare(
    "SELECT id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at FROM portability_operations WHERE command_id = ?"
  ).get(commandId) as Record<string, unknown> | undefined;
  return row ? {
    id: String(row.id), commandId: String(row.command_id), kind: String(row.kind),
    payloadHash: String(row.payload_hash), status: String(row.status) as PortabilityOperation["status"],
    packetPath: row.packet_path ? String(row.packet_path) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  } : undefined;
}

let canonicalColumns: Record<string, readonly string[]> | undefined;

function expectedCanonicalColumns(): Record<string, readonly string[]> {
  if (canonicalColumns) { return canonicalColumns; }
  const expected = new DatabaseSync(":memory:");
  try {
    createSchema(expected);
    canonicalColumns = Object.fromEntries(
      (expected.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>).map(({ name }) => [
        name,
        (expected.prepare(`PRAGMA table_info(${name})`).all() as Array<{ name: string }>).map((column) => String(column.name))
      ])
    );
    return canonicalColumns;
  } finally {
    expected.close();
  }
}

export function validateCanonicalDatabase(databasePath: string): void {
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(databasePath, { readOnly: true });
    configureDatabase(db);
  } catch (error) {
    throw new ProjectStoreError("corrupt-packet", `canonical SQLite database is unreadable: ${(error as Error).message}`);
  }
  try {
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    if (integrity?.integrity_check !== "ok") {
      throw new ProjectStoreError("corrupt-packet", `canonical SQLite database failed integrity check: ${integrity?.integrity_check ?? "unknown"}`);
    }
    const tables = new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name: string }>).map((entry) => String(entry.name)));
    for (const [table, columns] of Object.entries(expectedCanonicalColumns())) {
      if (!tables.has(table)) {
        throw new ProjectStoreError("corrupt-packet", `canonical SQLite database is missing table ${table}`);
      }
      const actual = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((column) => String(column.name)));
      const missing = columns.find((column) => !actual.has(column));
      if (missing) {
        throw new ProjectStoreError("corrupt-packet", `canonical SQLite database table ${table} is missing column ${missing}`);
      }
    }
    const project = db.prepare("SELECT id, schema_version FROM projects LIMIT 1").get() as { id?: unknown; schema_version?: unknown } | undefined;
    if (typeof project?.id !== "string" || project.id.length === 0 || project.schema_version !== readSchemaVersion(db)) {
      throw new ProjectStoreError("corrupt-packet", "canonical SQLite database has missing or inconsistent project metadata");
    }
  } catch (error) {
    if (error instanceof ProjectStoreError) { throw error; }
    throw new ProjectStoreError("corrupt-packet", `canonical SQLite database validation failed: ${(error as Error).message}`);
  } finally {
    db.close();
  }
}

function exactVersionMembership(value: unknown, versionIds: Set<string>): boolean {
  if (typeof value !== "string") {
    return false;
  }
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) && parsed.some((item) => versionIds.has(String(item)));
  } catch {
    return value.split(/[\s,[\]"']+/).filter(Boolean).some((item) => versionIds.has(item));
  }
}

/** Remove derived/source excerpts from a packet that omits their source versions. */
export function redactOmittedDatabase(databasePath: string, omittedVersionIds: readonly string[], clearArtifactRows = true): void {
  if (omittedVersionIds.length === 0) {
    return;
  }
  const ids = new Set(omittedVersionIds.map(String));
  const db = new DatabaseSync(databasePath);
  configureDatabase(db);
  try {
    transaction(db, () => {
      const placeholders = [...ids].map(() => "?").join(",");
      const params = [...ids];
      const deleteBySource = (table: string, column: string): void => {
        try { db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...params); } catch { /* optional table */ }
      };

      // Delete links before evidence rows so foreign-key enforcement remains enabled.
      try {
        db.prepare(`DELETE FROM claim_evidence_links WHERE evidence_item_id IN (SELECT id FROM evidence_items WHERE source_version_id IN (${placeholders}))`).run(...params);
      } catch { /* optional table */ }
      deleteBySource("evidence_items", "source_version_id");
      deleteBySource("source_segments", "source_version_id");
      deleteBySource("source_segments", "derived_version_id");
      deleteBySource("source_records", "source_version_id");
      deleteBySource("source_locators", "artifact_version_id");
      deleteBySource("source_diagnostics", "artifact_version_id");
      deleteBySource("citation_verifications", "source_version_id");
      deleteBySource("claim_reassessments", "source_version_id");
      deleteBySource("appraisals", "source_version_id");

      try {
        const rows = db.prepare("SELECT id, candidate_version_id, source_version_ids FROM derived_materials").all() as Array<Record<string, unknown>>;
        for (const row of rows) {
          if ((row.candidate_version_id && ids.has(String(row.candidate_version_id))) || exactVersionMembership(row.source_version_ids, ids)) {
            db.prepare("DELETE FROM derived_materials WHERE id = ?").run(String(row.id));
          }
        }
      } catch { /* optional table */ }

      if (clearArtifactRows) {
        db.prepare(`UPDATE artifact_versions
          SET storage_path = NULL, content_hash = NULL, byte_length = NULL,
              access_level = 'unavailable', content_status = 'unavailable'
          WHERE id IN (${placeholders})`).run(...params);
      }
      try {
        db.prepare(`UPDATE source_versions SET access_level = 'unavailable' WHERE artifact_version_id IN (${placeholders})`).run(...params);
      } catch { /* optional table */ }
    });
  } finally {
    db.close();
  }
  validateCanonicalDatabase(databasePath);
}

export function exportProject(handle: ProjectHandle, capability: unknown, request: ExportRequest): ProjectPacket {
  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot export projects");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: export requires owner capability");
  }
  const ownerCap = capability as OwnerCapability;
  if (ownerCap.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }
  assertWritable(handle);
  validateCanonicalDatabase(handle.project.databasePath);

  return protectCanonicalWrite(capability, () => {
    // Check idempotency
    const existing = getPortabilityOperation(handle, request.commandId);
    if (existing) {
      if (existing.payloadHash !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      if (existing.status === "complete" && existing.packetPath && existsSync(join(existing.packetPath, "ganesh-project-packet.json"))) {
        const manifest = JSON.parse(readFileSync(join(existing.packetPath, "ganesh-project-packet.json"), "utf-8")) as PacketManifest;
        return { manifest, packetPath: existing.packetPath, operationId: existing.id };
      }
    }

    const operationId = existing?.id ?? newId("portability-op");
    const now = isoNow();

    if (!existing) {
      transaction(handle.db, () => {
        handle.db.prepare(
          "INSERT INTO portability_operations (id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(operationId, request.commandId, "export", request.payloadHash, "pending", null, now, now);
      });
    }

    const packetDir = resolve(request.destinationPath);
    if (existsSync(packetDir) && lstatSync(packetDir).isSymbolicLink()) {
      throw new ProjectStoreError("path-escape", "export destination cannot be a symlink");
    }

    const parentDir = dirname(packetDir);
    mkdirSync(parentDir, { recursive: true });

    const stageId = newId("export-stage");
    const stagingDir = join(parentDir, `.${basename(packetDir)}.staging-${stageId}`);
    const discardDir = join(parentDir, `.${basename(packetDir)}.discard-${stageId}`);

    // Purge any stale discard or staging residue from prior operations
    try {
      for (const e of readdirSync(parentDir)) {
        if (e.startsWith(`.${basename(packetDir)}.discard-`) || e.startsWith(`.${basename(packetDir)}.staging-`)) {
          rmSync(join(parentDir, e), { recursive: true, force: true });
        }
      }
    } catch { /* best effort */ }

    let movedOld = false;
    let published = false;
    try {
      mkdirSync(stagingDir, { recursive: true });

      const files: PacketFileEntry[] = [];
      const omissions: OmissionNotice[] = [];
      const permittedArtifacts: Array<{ storagePath: string; srcPath: string }> = [];

      // Decide disclosure before copying the database so omitted versions can be redacted from it.
      const artifactRows = handle.db.prepare(
        "SELECT id, logical_id, storage_path, content_hash, access_level, content_status FROM artifact_versions ORDER BY logical_id"
      ).all() as Array<Record<string, unknown>>;
      for (const row of artifactRows) {
        const versionId = String(row.id);
        const storagePath = row.storage_path ? String(row.storage_path) : null;
        const contentStatus = String(row.content_status);
        const accessLevel = String(row.access_level);

        if (accessLevel === "unavailable" || contentStatus === "unavailable" || !storagePath) {
          omissions.push({ artifactVersionId: versionId, reason: "content-unavailable" });
          continue;
        }
        let srcPath: string;
        try {
          srcPath = assertContainedRelativePath(handle.project.artifactRoot, storagePath);
        } catch {
          throw new ProjectStoreError("corrupt-packet", `available artifact has an unsafe storage path: ${storagePath}`);
        }
        if (!existsSync(srcPath)) {
          throw new ProjectStoreError("corrupt-packet", `available artifact bytes are missing: ${storagePath}`);
        }
        if (request.destination !== "local") {
          const disclosure = requestDisclosure(handle, {
            operation: "export",
            destination: request.destination,
            purpose: request.purpose,
            sourceVersions: [versionId]
          });
          if (disclosure.status === "deny") {
            omissions.push({ artifactVersionId: versionId, reason: disclosure.reason });
            continue;
          }
        }
        const actualHash = computeSha256(readFileSync(srcPath));
        if (row.content_hash && String(row.content_hash) !== actualHash) {
          throw new ProjectStoreError("corrupt-packet", `available artifact hash mismatch: ${storagePath}`);
        }
        permittedArtifacts.push({ storagePath, srcPath });
      }

      // The packet database is a canonical, validated copy. Remote packets must not
      // carry source excerpts or other derived rows for omitted versions.
      const dbDest = join(stagingDir, "project.sqlite");
      copyFileSync(handle.project.databasePath, dbDest);
      if (request.destination !== "local") {
        redactOmittedDatabase(dbDest, omissions.map((omission) => omission.artifactVersionId));
      }
      validateCanonicalDatabase(dbDest);
      const dbHash = computeSha256(readFileSync(dbDest));
      files.push({ relativePath: "project.sqlite", sha256: dbHash });

      const artifactsDir = join(stagingDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });
      for (const { storagePath, srcPath } of permittedArtifacts) {
        const destArtifact = assertContainedRelativePath(artifactsDir, storagePath);
        mkdirSync(join(destArtifact, ".."), { recursive: true });
        copyFileSync(srcPath, destArtifact);
        files.push({ relativePath: `artifacts/${storagePath}`, sha256: computeSha256(readFileSync(destArtifact)) });
      }

      let commitmentIds: string[] = [];
      try { commitmentIds = (handle.db.prepare("SELECT id FROM commitments ORDER BY created_at").all() as Array<{ id: string }>).map((r) => String(r.id)); } catch { /* ignore */ }
      let evidenceLocatorIds: string[] = [];
      const packetDb = new DatabaseSync(dbDest, { readOnly: true });
      try {
        configureDatabase(packetDb);
        try {
          evidenceLocatorIds = (packetDb.prepare("SELECT id FROM source_locators ORDER BY id").all() as Array<{ id: string }>).map((r) => String(r.id));
        } catch { /* optional table */ }
      } finally {
        packetDb.close();
      }

      const manifest: PacketManifest = {
        kind: "project",
        schemaVersion: PROJECT_SCHEMA_VERSION,
        projectId: handle.project.id,
        createdAt: now,
        destination: request.destination,
        purpose: request.purpose,
        files,
        omissions,
        commitmentIds,
        evidenceLocatorIds
      };

      writeFileSync(join(stagingDir, "ganesh-project-packet.json"), JSON.stringify(manifest, null, 2));

      // Publish only after the staged packet is complete. If recording completion
      // fails, restore the previous destination rather than leaving an untracked packet.
      if (existsSync(packetDir)) {
        renameSync(packetDir, discardDir);
        movedOld = true;
      }
      try {
        renameSync(stagingDir, packetDir);
        published = true;
        transaction(handle.db, () => {
          handle.db.prepare("UPDATE portability_operations SET status = ?, packet_path = ?, updated_at = ? WHERE id = ?")
            .run("complete", packetDir, isoNow(), operationId);
        });
        if (movedOld) {
          rmSync(discardDir, { recursive: true, force: true });
        }
      } catch (swapErr) {
        if (published && existsSync(packetDir)) {
          try { rmSync(packetDir, { recursive: true, force: true }); } catch { /* best effort */ }
        }
        if (movedOld && existsSync(discardDir)) {
          try { renameSync(discardDir, packetDir); } catch { /* rollback */ }
        }
        throw swapErr;
      }

      return { manifest, packetPath: packetDir, operationId };
    } catch (error) {
      // Mark failed, clean up
      try {
        transaction(handle.db, () => {
          handle.db.prepare("UPDATE portability_operations SET status = ?, updated_at = ? WHERE id = ?")
            .run("failed", isoNow(), operationId);
        });
      } catch { /* preserve original error */ }
      if (existsSync(stagingDir)) { try { rmSync(stagingDir, { recursive: true, force: true }); } catch { /* ignore */ } }
      if (existsSync(discardDir)) { try { rmSync(discardDir, { recursive: true, force: true }); } catch { /* ignore */ } }
      throw error;
    }
  });
}

export function assertContainedRelativePath(basePath: string, relativePath: string): string {
  if (typeof relativePath !== "string" || !relativePath.trim()) {
    throw new ProjectStoreError("path-escape", "relative path must be a non-empty string");
  }
  if (isAbsolute(relativePath)) {
    throw new ProjectStoreError("path-escape", `path must not be absolute: ${relativePath}`);
  }
  if (relativePath.includes("\0")) {
    throw new ProjectStoreError("path-escape", "path contains null byte");
  }

  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(resolvedBase, relativePath);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel) || resolvedTarget === resolvedBase) {
    throw new ProjectStoreError("path-escape", `path escapes root directory: ${relativePath}`);
  }

  const realBase = existsSync(resolvedBase) ? realpathSync(resolvedBase) : resolvedBase;

  // Walk segments to ensure no intermediate symlink or directory escapes base
  const segments = relativePath.split(/[\\/]+/).filter(Boolean);
  let cur = resolvedBase;
  for (const segment of segments) {
    cur = join(cur, segment);
    if (existsSync(cur)) {
      const st = lstatSync(cur);
      if (st.isSymbolicLink()) {
        const realCur = realpathSync(cur);
        const relFromBase = relative(realBase, realCur);
        if (relFromBase.startsWith("..") || isAbsolute(relFromBase)) {
          throw new ProjectStoreError("path-escape", `symlink escapes root: ${relativePath}`);
        }
      } else {
        const realCur = realpathSync(cur);
        const relFromBase = relative(realBase, realCur);
        if (relFromBase.startsWith("..") || isAbsolute(relFromBase)) {
          throw new ProjectStoreError("path-escape", `path escapes root: ${relativePath}`);
        }
      }
    }
  }

  if (existsSync(resolvedTarget)) {
    const realTarget = realpathSync(resolvedTarget);
    const relFromBase = relative(realBase, realTarget);
    if (relFromBase.startsWith("..") || isAbsolute(relFromBase)) {
      throw new ProjectStoreError("path-escape", `resolved path escapes root: ${relativePath}`);
    }
  }

  return resolvedTarget;
}

export function inspectProjectPacket(packetPath: string): ProjectPacketInspection {
  const manifestPath = join(packetPath, "ganesh-project-packet.json");
  if (!existsSync(manifestPath)) {
    throw new ProjectStoreError("packet-not-found", "no ganesh-project-packet.json at the specified path");
  }
  let manifest: PacketManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PacketManifest;
  } catch (err) {
    throw new ProjectStoreError("corrupt-packet", `malformed manifest JSON: ${(err as Error).message}`);
  }
  if (!manifest || typeof manifest !== "object" || !Array.isArray(manifest.files)) {
    throw new ProjectStoreError("corrupt-packet", "manifest must contain a files array");
  }
  const hashResults: PacketHashResult[] = [];

  for (const file of manifest.files) {
    if (!file || typeof file !== "object" || typeof file.relativePath !== "string" || typeof file.sha256 !== "string") {
      throw new ProjectStoreError("corrupt-packet", "manifest files must contain relativePath and sha256 strings");
    }
    const filePath = assertContainedRelativePath(packetPath, file.relativePath);
    if (!existsSync(filePath)) {
      hashResults.push({ relativePath: file.relativePath, expected: file.sha256, actual: null, match: false });
      continue;
    }
    const bytes = readFileSync(filePath);
    const actual = computeSha256(bytes);
    hashResults.push({ relativePath: file.relativePath, expected: file.sha256, actual, match: actual === file.sha256 });
  }

  const sqliteEntries = manifest.files.filter((f) => f && f.relativePath === "project.sqlite");
  if (sqliteEntries.length !== 1 || typeof sqliteEntries[0].sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sqliteEntries[0].sha256)) {
    throw new ProjectStoreError("corrupt-packet", "packet manifest is missing canonical hashed project.sqlite entry");
  }

  return {
    manifest,
    hashResults,
    valid: hashResults.every((r) => r.match)
  };
}
