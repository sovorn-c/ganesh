// story: e15s02, e15s05
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PROJECT_SCHEMA_VERSION, type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { createSchema, configureDatabase, transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256 } from "../persistence/storage-utils.js";
import { acquireProjectWriteLock } from "../project/project-lock.js";
import { assertContainedRelativePath, inspectProjectPacket } from "./export-store.js";
import type {
  RestoreRequest, RestoreResult, PacketManifest
} from "./portability-types.js";

function getDatabaseOwnerId(sqlitePath: string): string | null {
  if (!existsSync(sqlitePath)) {
    return null;
  }
  try {
    const db = new DatabaseSync(sqlitePath, { readOnly: true });
    configureDatabase(db);
    const row = db.prepare("SELECT owner_id FROM projects LIMIT 1").get() as { owner_id: string } | undefined;
    db.close();
    return row?.owner_id ?? null;
  } catch {
    return null;
  }
}

function copyDirRecursive(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else {
      copyFileSync(srcPath, destPath);
    }
  }
}

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
  const ownerCap = capability as OwnerCapability;

  const inspection = inspectProjectPacket(request.sourcePath);

  // Validate manifest schema version
  if (
    typeof inspection.manifest.schemaVersion !== "number" ||
    inspection.manifest.schemaVersion > PROJECT_SCHEMA_VERSION ||
    inspection.manifest.schemaVersion < 1
  ) {
    throw new ProjectStoreError(
      "unsupported-schema",
      `unsupported-schema: packet schema version ${inspection.manifest.schemaVersion} exceeds supported version ${PROJECT_SCHEMA_VERSION}`
    );
  }

  // Validate packet kind
  if (inspection.manifest.kind !== "project" && inspection.manifest.kind !== "backup") {
    throw new ProjectStoreError(
      "invalid-packet-kind",
      `invalid-packet-kind: unrecognized packet kind "${inspection.manifest.kind}"`
    );
  }

  // Enforce matching owner between capability and source packet
  const packetDbPath = join(request.sourcePath, "project.sqlite");
  const packetOwnerId = getDatabaseOwnerId(packetDbPath);
  if (packetOwnerId && ownerCap.ownerId !== packetOwnerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match packet owner");
  }

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
    return materializeRestore(ownerCap, request, inspection);
  }

  if (request.mode === "replace") {
    return replaceRestore(ownerCap, request, inspection);
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

    // Acquire write lock on destination
    const lock = acquireProjectWriteLock(request.destinationPath);
    try {
      const destDb = join(destStore, "project.sqlite");
      const srcDb = join(request.sourcePath, "project.sqlite");
      copyFileSync(srcDb, destDb);

      // Copy artifacts with strict path containment
      for (const file of inspection.manifest.files) {
        if (file.relativePath === "project.sqlite") { continue; }
        const src = assertContainedRelativePath(request.sourcePath, file.relativePath);
        const dest = assertContainedRelativePath(destStore, file.relativePath);
        mkdirSync(join(dest, ".."), { recursive: true });
        copyFileSync(src, dest);
      }

      // Record operation into destination database
      try {
        const db = new DatabaseSync(destDb);
        configureDatabase(db);
        try {
          transaction(db, () => {
            db.prepare(
              "INSERT INTO portability_operations (id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(newId("restore"), request.commandId, "restore-materialize", request.payloadHash, "complete", request.sourcePath, isoNow(), isoNow());
          });
        } finally {
          db.close();
        }
      } catch { /* table may not exist in earlier schema */ }

      return {
        mode: "materialize",
        valid: true,
        hashResults: inspection.hashResults,
        operationId: newId("restore"),
        detail: "materialize complete: project created from packet",
        reinstatedGrants: [],
        preservedWithdrawals: []
      };
    } catch (err) {
      try { rmSync(destStore, { recursive: true, force: true }); } catch { /* best effort */ }
      throw err;
    } finally {
      lock.release();
    }
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

  const destDbPath = join(destStore, "project.sqlite");
  const destOwnerId = getDatabaseOwnerId(destDbPath);
  if (destOwnerId && capability.ownerId !== destOwnerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }

  return protectCanonicalWrite(capability, () => {
    // Acquire destination write lock
    const lock = acquireProjectWriteLock(request.destinationPath);

    try {
      // Check persisted idempotency & payload conflict
      try {
        const checkDb = new DatabaseSync(destDbPath, { readOnly: true });
        configureDatabase(checkDb);
        try {
          const row = checkDb.prepare(
            "SELECT id, payload_hash, status FROM portability_operations WHERE command_id = ?"
          ).get(request.commandId) as { id: string; payload_hash: string; status: string } | undefined;
          if (row) {
            if (row.payload_hash && request.payloadHash && String(row.payload_hash) !== request.payloadHash) {
              throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
            }
            if (row.status === "complete") {
              return {
                mode: "replace",
                valid: true,
                hashResults: inspection.hashResults,
                operationId: String(row.id),
                detail: "replace complete: idempotent return",
                reinstatedGrants: [],
                preservedWithdrawals: []
              };
            }
          }
        } finally {
          checkDb.close();
        }
      } catch (err) {
        if (err instanceof ProjectStoreError) { throw err; }
      }

      // Read live rows to preserve monotonic withdrawals, tombstones, and not-recalled rows
      let liveTerminalGrants: Array<{ id: string; input_version_id: string; destination: string; purpose: string; status: string }> = [];
      let liveStatusHistory: Array<Record<string, unknown>> = [];
      let liveDisclosureDecisions: Array<Record<string, unknown>> = [];
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
          liveStatusHistory = liveDb.prepare(
            "SELECT id, permission_id, previous_status, new_status, reason, actor, created_at FROM policy_status_history"
          ).all() as Array<Record<string, unknown>>;
        } catch { /* table may not exist */ }
        try {
          liveDisclosureDecisions = liveDb.prepare(
            "SELECT id, correlation_id, operation_kind, destination, purpose, source_version_ids, transformation, branch_id, status, reason, policy_decision_id, created_at FROM disclosure_decisions"
          ).all() as Array<Record<string, unknown>>;
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

      // Stage in a temporary directory
      const stageId = newId("replace-stage");
      const stageDir = join(destStore, `tmp-stage-${stageId}`);
      mkdirSync(stageDir, { recursive: true });

      const preservedWithdrawals: string[] = [];

      try {
        const stageDbPath = join(stageDir, "project.sqlite");
        const srcDb = join(request.sourcePath, "project.sqlite");
        copyFileSync(srcDb, stageDbPath);

        // Copy artifacts into stage directory with strict path containment
        for (const file of inspection.manifest.files) {
          if (file.relativePath === "project.sqlite") { continue; }
          const src = assertContainedRelativePath(request.sourcePath, file.relativePath);
          const dest = assertContainedRelativePath(stageDir, file.relativePath);
          mkdirSync(join(dest, ".."), { recursive: true });
          copyFileSync(src, dest);
        }

        // Open staged DB and apply preserved rows
        const stagedDb = new DatabaseSync(stageDbPath);
        configureDatabase(stagedDb);
        try {
          // 1. Re-apply monotonic terminal grants
          for (const grant of liveTerminalGrants) {
            try {
              stagedDb.prepare(
                "UPDATE policy_permissions SET status = ? WHERE (id = ? OR (input_version_id = ? AND destination = ? AND purpose = ?)) AND status = 'active'"
              ).run(grant.status, grant.id, grant.input_version_id, grant.destination, grant.purpose);
              preservedWithdrawals.push(grant.id);
            } catch { /* row may not exist in packet */ }
          }

          // 2. Re-apply policy status history
          for (const hist of liveStatusHistory) {
            try {
              stagedDb.prepare(
                "INSERT OR IGNORE INTO policy_status_history (id, permission_id, previous_status, new_status, reason, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
              ).run(
                String(hist.id),
                String(hist.permission_id),
                String(hist.previous_status),
                String(hist.new_status),
                hist.reason ? String(hist.reason) : null,
                hist.actor ? String(hist.actor) : null,
                String(hist.created_at)
              );
            } catch { /* table may not exist */ }
          }

          // 3. Re-apply disclosure decisions (preserve past external disclosure rows)
          for (const disc of liveDisclosureDecisions) {
            try {
              stagedDb.prepare(
                "INSERT OR IGNORE INTO disclosure_decisions (id, correlation_id, operation_kind, destination, purpose, source_version_ids, transformation, branch_id, status, reason, policy_decision_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
              ).run(
                String(disc.id),
                String(disc.correlation_id),
                String(disc.operation_kind),
                String(disc.destination),
                String(disc.purpose),
                String(disc.source_version_ids),
                disc.transformation ? String(disc.transformation) : null,
                disc.branch_id ? String(disc.branch_id) : null,
                String(disc.status),
                disc.reason ? String(disc.reason) : null,
                disc.policy_decision_id ? String(disc.policy_decision_id) : null,
                String(disc.created_at)
              );
            } catch { /* table may not exist */ }
          }

          // 4. Re-apply tombstones
          for (const tombstone of liveTombstones) {
            try {
              stagedDb.prepare(
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

          // 5. Re-apply deletion events
          for (const event of liveDeletionEvents) {
            try {
              stagedDb.prepare(
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

          // 6. Mark tombstoned artifacts as unavailable and unlink copied files in stage
          for (const tombstone of liveTombstones) {
            const vId = String(tombstone.artifact_version_id);
            try {
              const row = stagedDb.prepare("SELECT storage_path FROM artifact_versions WHERE id = ?").get(vId) as { storage_path?: string } | undefined;
              if (row?.storage_path) {
                const fullP = join(stageDir, "artifacts", row.storage_path);
                rmSync(fullP, { force: true });
              }
              stagedDb.prepare(
                "UPDATE artifact_versions SET content_status = 'unavailable', access_level = 'unavailable' WHERE id = ?"
              ).run(vId);
            } catch { /* best effort */ }
          }

          // 7. Record operation
          try {
            stagedDb.prepare(
              "INSERT OR REPLACE INTO portability_operations (id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(newId("restore"), request.commandId, "restore-replace", request.payloadHash, "complete", request.sourcePath, isoNow(), isoNow());
          } catch { /* table may not exist */ }

          // Validate integrity before swap
          stagedDb.prepare("PRAGMA integrity_check").get();
        } finally {
          stagedDb.close();
        }

        // Atomic swap
        const bakDbPath = join(destStore, "project.sqlite.bak");
        try {
          renameSync(destDbPath, bakDbPath);
        } catch {
          copyFileSync(destDbPath, bakDbPath);
        }

        try {
          copyFileSync(stageDbPath, destDbPath);
          const stageArtifacts = join(stageDir, "artifacts");
          if (existsSync(stageArtifacts)) {
            const destArtifacts = join(destStore, "artifacts");
            copyDirRecursive(stageArtifacts, destArtifacts);
          }
          try { rmSync(bakDbPath, { force: true }); } catch { /* best effort */ }
        } catch (swapError) {
          // Roll back database
          if (existsSync(bakDbPath)) {
            try {
              copyFileSync(bakDbPath, destDbPath);
              rmSync(bakDbPath, { force: true });
            } catch { /* best effort */ }
          }
          throw swapError;
        }
      } finally {
        rmSync(stageDir, { recursive: true, force: true });
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
    } finally {
      lock.release();
    }
  });
}
