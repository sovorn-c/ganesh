// story: e15s02, e15s05
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { createSchema, configureDatabase, transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256 } from "../persistence/storage-utils.js";
import { inspectProjectPacket } from "./export-store.js";
import type {
  RestoreRequest, RestoreResult, PacketManifest
} from "./portability-types.js";

export function restoreProject(
  capability: unknown,
  request: RestoreRequest
): RestoreResult {
  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot restore projects");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: restore requires owner capability");
  }

  const inspection = inspectProjectPacket(request.sourcePath);

  if (request.mode === "drill") {
    return {
      mode: "drill",
      valid: inspection.valid,
      hashResults: inspection.hashResults,
      operationId: newId("drill"),
      detail: inspection.valid ? "drill passed: all hashes match" : "drill failed: hash mismatch detected",
      reinstatedGrants: [],
      preservedWithdrawals: []
    };
  }

  if (!inspection.valid) {
    return {
      mode: request.mode,
      valid: false,
      hashResults: inspection.hashResults,
      operationId: newId("restore-failed"),
      detail: "restore rejected: hash mismatch before destination is ready",
      reinstatedGrants: [],
      preservedWithdrawals: []
    };
  }

  if (request.mode === "materialize") {
    return materializeRestore(capability as OwnerCapability, request, inspection);
  }

  if (request.mode === "replace") {
    return replaceRestore(capability as OwnerCapability, request, inspection);
  }

  throw new ProjectStoreError("invalid-argument", `unsupported restore mode: ${request.mode}`);
}

function materializeRestore(
  capability: OwnerCapability,
  request: RestoreRequest,
  inspection: ReturnType<typeof inspectProjectPacket>
): RestoreResult {
  const destStore = join(request.destinationPath, ".ganesh");
  if (existsSync(destStore)) {
    throw new ProjectStoreError("project-exists", "materialize requires an empty destination without .ganesh");
  }

  return protectCanonicalWrite(capability, () => {
    mkdirSync(destStore, { recursive: true });
    const destDb = join(destStore, "project.sqlite");
    const srcDb = join(request.sourcePath, "project.sqlite");
    copyFileSync(srcDb, destDb);

    // Copy artifacts
    const destArtifacts = join(destStore, "artifacts");
    for (const file of inspection.manifest.files) {
      if (file.relativePath === "project.sqlite") {continue;}
      const src = join(request.sourcePath, file.relativePath);
      const dest = join(destStore, file.relativePath);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
    }

    return {
      mode: "materialize",
      valid: true,
      hashResults: inspection.hashResults,
      operationId: newId("restore"),
      detail: "materialize complete: project created from packet",
      reinstatedGrants: [],
      preservedWithdrawals: []
    };
  });
}

function replaceRestore(
  capability: OwnerCapability,
  request: RestoreRequest,
  inspection: ReturnType<typeof inspectProjectPacket>
): RestoreResult {
  const destStore = join(request.destinationPath, ".ganesh");
  if (!existsSync(destStore)) {
    throw new ProjectStoreError("project-not-found", "replace requires an existing project at destination");
  }

  return protectCanonicalWrite(capability, () => {
    const destDbPath = join(destStore, "project.sqlite");
    const preservedWithdrawals: string[] = [];

    // Read live withdrawn/expired grants, tombstones, and deletion events before overwrite
    let liveTerminalGrants: Array<{ id: string; input_version_id: string; destination: string; purpose: string; status: string }> = [];
    let liveTombstones: Array<Record<string, unknown>> = [];
    let liveDeletionEvents: Array<Record<string, unknown>> = [];
    try {
      const liveDb = new DatabaseSync(destDbPath, { readOnly: true });
      configureDatabase(liveDb);
      try {
        liveTerminalGrants = liveDb.prepare(
          "SELECT id, input_version_id, destination, purpose, status FROM policy_permissions WHERE status IN ('withdrawn', 'expired')"
        ).all() as typeof liveTerminalGrants;
      } catch { /* table may not exist */ }
      try {
        liveTombstones = liveDb.prepare(
          "SELECT id, artifact_version_id, content_hash, reason, actor, deleted_at FROM evidence_tombstones"
        ).all() as Array<Record<string, unknown>>;
      } catch { /* table may not exist */ }
      try {
        liveDeletionEvents = liveDb.prepare(
          "SELECT id, artifact_version_id, unlinked_paths, tombstone_id, not_recalled_disclosures, command_id, payload_hash, created_at FROM deletion_events"
        ).all() as Array<Record<string, unknown>>;
      } catch { /* table may not exist */ }
      liveDb.close();
    } catch { /* no live db to read */ }

    // Copy packet files over destination
    const srcDb = join(request.sourcePath, "project.sqlite");
    copyFileSync(srcDb, destDbPath);

    for (const file of inspection.manifest.files) {
      if (file.relativePath === "project.sqlite") {
        continue;
      }
      const src = join(request.sourcePath, file.relativePath);
      const dest = join(destStore, file.relativePath);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
    }

    // Re-apply monotonic grant rules: withdrawn/expired win
    if (liveTerminalGrants.length > 0 || liveTombstones.length > 0 || liveDeletionEvents.length > 0) {
      const db = new DatabaseSync(destDbPath);
      configureDatabase(db);
      try {
        for (const grant of liveTerminalGrants) {
          try {
            db.prepare(
              "UPDATE policy_permissions SET status = ? WHERE (id = ? OR (input_version_id = ? AND destination = ? AND purpose = ?)) AND status = 'active'"
            ).run(grant.status, grant.id, grant.input_version_id, grant.destination, grant.purpose);
            preservedWithdrawals.push(grant.id);
          } catch { /* row may not exist in packet */ }
        }
        // Restore tombstones
        for (const tombstone of liveTombstones) {
          try {
            db.prepare(
              "INSERT OR IGNORE INTO evidence_tombstones (id, artifact_version_id, content_hash, reason, actor, deleted_at) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(
              String(tombstone.id),
              String(tombstone.artifact_version_id),
              tombstone.content_hash ? String(tombstone.content_hash) : null,
              String(tombstone.reason),
              String(tombstone.actor),
              String(tombstone.deleted_at)
            );
          } catch { /* table may not exist */ }
        }
        // Restore deletion events
        for (const event of liveDeletionEvents) {
          try {
            db.prepare(
              "INSERT OR IGNORE INTO deletion_events (id, artifact_version_id, unlinked_paths, tombstone_id, not_recalled_disclosures, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(
              String(event.id),
              String(event.artifact_version_id),
              String(event.unlinked_paths),
              String(event.tombstone_id),
              String(event.not_recalled_disclosures),
              String(event.command_id),
              String(event.payload_hash),
              String(event.created_at)
            );
          } catch { /* table may not exist */ }
        }
        // Mark tombstoned artifacts as unavailable and unlink copied files
        for (const tombstone of liveTombstones) {
          const vId = String(tombstone.artifact_version_id);
          try {
            const row = db.prepare("SELECT storage_path FROM artifact_versions WHERE id = ?").get(vId) as { storage_path?: string } | undefined;
            if (row?.storage_path) {
              const fullP = join(destStore, "artifacts", row.storage_path);
              rmSync(fullP, { force: true });
            }
            db.prepare(
              "UPDATE artifact_versions SET content_status = 'unavailable', access_level = 'unavailable' WHERE id = ?"
            ).run(vId);
          } catch { /* best effort */ }
        }
      } finally {
        db.close();
      }
    }

    return {
      mode: "replace",
      valid: true,
      hashResults: inspection.hashResults,
      operationId: newId("restore-replace"),
      detail: `replace complete: ${preservedWithdrawals.length} withdrawn/expired grants preserved`,
      reinstatedGrants: [],
      preservedWithdrawals
    };
  });
}
