// story: e15s02
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_SCHEMA_VERSION, type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { migrateSchema, transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256 } from "../persistence/storage-utils.js";
import { assertContainedRelativePath } from "./export-store.js";
import type {
  BackupRequest, BackupSnapshot, PacketManifest, PacketFileEntry,
  MigrateWithBackupResult
} from "./portability-types.js";

export function backupProject(
  handle: ProjectHandle,
  capability: unknown,
  request: BackupRequest
): BackupSnapshot {
  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot create backups");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: backup requires owner capability");
  }
  const ownerCap = capability as OwnerCapability;
  if (ownerCap.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }
  assertWritable(handle);

  return protectCanonicalWrite(capability, () => {
    // Check idempotency
    const existing = handle.db.prepare(
      "SELECT id, backup_path, payload_hash FROM backup_records WHERE command_id = ?"
    ).get(request.commandId) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.payload_hash && request.payloadHash && String(existing.payload_hash) !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      const bp = String(existing.backup_path);
      const manifest = JSON.parse(readFileSync(join(bp, "ganesh-project-packet.json"), "utf-8")) as PacketManifest;
      return { backupId: String(existing.id), backupPath: bp, manifest, operationId: String(existing.id) };
    }

    const backupId = newId("backup");
    const now = isoNow();
    const backupsRoot = join(handle.project.rootPath, ".ganesh", "backups");
    const tmpDir = join(backupsRoot, `${backupId}.tmp`);
    const finalDir = join(backupsRoot, backupId);

    mkdirSync(tmpDir, { recursive: true });

    try {
      // Copy database
      const dbDest = join(tmpDir, "project.sqlite");
      copyFileSync(handle.project.databasePath, dbDest);
      const dbBytes = readFileSync(dbDest);
      const dbHash = computeSha256(dbBytes);
      const files: PacketFileEntry[] = [{ relativePath: "project.sqlite", sha256: dbHash }];

      // Copy referenced artifacts
      const artifactRows = handle.db.prepare(
        "SELECT id, storage_path, content_status, access_level FROM artifact_versions WHERE content_status = 'available' AND storage_path IS NOT NULL"
      ).all() as Array<Record<string, unknown>>;

      const artifactsDir = join(tmpDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      for (const row of artifactRows) {
        const storagePath = String(row.storage_path);
        let srcPath: string;
        let destPath: string;
        try {
          srcPath = assertContainedRelativePath(handle.project.artifactRoot, storagePath);
          destPath = assertContainedRelativePath(artifactsDir, storagePath);
        } catch {
          continue;
        }
        if (!existsSync(srcPath)) {continue;}
        mkdirSync(join(destPath, ".."), { recursive: true });
        copyFileSync(srcPath, destPath);
        const bytes = readFileSync(destPath);
        files.push({ relativePath: `artifacts/${storagePath}`, sha256: computeSha256(bytes) });
      }

      const manifest: PacketManifest = {
        kind: "backup",
        schemaVersion: PROJECT_SCHEMA_VERSION,
        projectId: handle.project.id,
        createdAt: now,
        destination: "local",
        purpose: "backup",
        files,
        omissions: [],
        commitmentIds: [],
        evidenceLocatorIds: []
      };

      writeFileSync(join(tmpDir, "ganesh-project-packet.json"), JSON.stringify(manifest, null, 2));

      // Atomic rename
      renameSync(tmpDir, finalDir);

      const manifestHash = computeSha256(new TextEncoder().encode(JSON.stringify(manifest)));
      transaction(handle.db, () => {
        handle.db.prepare(
          "INSERT INTO backup_records (id, backup_path, manifest_hash, schema_version, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(backupId, finalDir, manifestHash, PROJECT_SCHEMA_VERSION, request.commandId, request.payloadHash, now);
      });

      return { backupId, backupPath: finalDir, manifest, operationId: backupId };
    } catch (error) {
      try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* best effort */ }
      throw error;
    }
  });
}

export function migrateWithBackup(
  handle: ProjectHandle,
  capability: unknown,
  commandId: string
): MigrateWithBackupResult {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "migration with backup requires owner capability");
  }
  const ownerCap = capability as OwnerCapability;
  if (ownerCap.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "capability owner does not match project owner");
  }

  const payloadHash = computeSha256(new TextEncoder().encode(commandId));
  const backup = backupProject(handle, capability, { commandId: `${commandId}-backup`, payloadHash });
  const result = migrateSchema(handle.db);
  return { backupId: backup.backupId, fromVersion: result.fromVersion, toVersion: result.toVersion };
}
