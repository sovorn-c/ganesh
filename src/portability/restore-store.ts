// story: e15s02, e15s05
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PROJECT_SCHEMA_VERSION, type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { createSchema, configureDatabase, readSchemaVersion, transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256, pathInside } from "../persistence/storage-utils.js";
import { acquireProjectWriteLock } from "../project/project-lock.js";
import { assertContainedRelativePath, inspectProjectPacket } from "./export-store.js";
import type {
  RestoreRequest, RestoreResult, PacketManifest
} from "./portability-types.js";

function getPortabilityRegistryPath(): string {
  const base = process.env.GANESH_DATA_DIR || join(tmpdir(), ".ganesh-registry");
  mkdirSync(base, { recursive: true });
  return join(base, "portability-commands.sqlite");
}

function getPortabilityRegistryDb(): DatabaseSync {
  const p = getPortabilityRegistryPath();
  const db = new DatabaseSync(p);
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS portability_commands (
      command_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_hash TEXT,
      source_path TEXT NOT NULL,
      destination_path TEXT NOT NULL,
      status TEXT NOT NULL,
      operation_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

function checkPortabilityCommand(commandId: string): {
  commandId: string;
  kind: string;
  payloadHash: string | null;
  sourcePath: string;
  destinationPath: string;
  status: string;
  operationId: string;
} | null {
  const db = getPortabilityRegistryDb();
  try {
    const row = db.prepare(
      "SELECT command_id, kind, payload_hash, source_path, destination_path, status, operation_id FROM portability_commands WHERE command_id = ?"
    ).get(commandId) as Record<string, unknown> | undefined;
    if (!row) { return null; }
    return {
      commandId: String(row.command_id),
      kind: String(row.kind),
      payloadHash: row.payload_hash ? String(row.payload_hash) : null,
      sourcePath: String(row.source_path),
      destinationPath: String(row.destination_path),
      status: String(row.status),
      operationId: String(row.operation_id)
    };
  } finally {
    db.close();
  }
}

function recordPortabilityCommand(entry: {
  commandId: string;
  kind: string;
  payloadHash: string | null;
  sourcePath: string;
  destinationPath: string;
  status: string;
  operationId: string;
}): void {
  const db = getPortabilityRegistryDb();
  try {
    const now = isoNow();
    db.prepare(`
      INSERT OR REPLACE INTO portability_commands
      (command_id, kind, payload_hash, source_path, destination_path, status, operation_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      entry.commandId,
      entry.kind,
      entry.payloadHash,
      entry.sourcePath,
      entry.destinationPath,
      entry.status,
      entry.operationId,
      now,
      now
    );
  } finally {
    db.close();
  }
}

export function _clearPortabilityRegistryForTests(): void {
  try {
    const p = getPortabilityRegistryPath();
    if (existsSync(p)) {
      rmSync(p, { force: true });
    }
  } catch { /* best effort */ }
}

function assertContainedArtifactPath(baseDir: string, relativePath: string): string {
  if (typeof relativePath !== "string" || relativePath.trim() === "") {
    throw new ProjectStoreError("path-escape", "storage path must be a non-empty string");
  }
  if (relativePath.includes("\0")) {
    throw new ProjectStoreError("path-escape", "storage path contains null byte");
  }
  if (isAbsolute(relativePath)) {
    throw new ProjectStoreError("path-escape", `storage path cannot be absolute: ${relativePath}`);
  }

  const resolvedBase = resolve(baseDir);
  mkdirSync(resolvedBase, { recursive: true });
  const realBase = realpathSync(resolvedBase);

  const resolvedTarget = resolve(resolvedBase, relativePath);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel) || resolvedTarget === resolvedBase) {
    throw new ProjectStoreError("path-escape", `storage path escapes base directory: ${relativePath}`);
  }

  const segments = rel.split(/[\\/]+/).filter(Boolean);
  let cur = resolvedBase;

  for (let i = 0; i < segments.length; i++) {
    cur = join(cur, segments[i]);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      continue;
    }

    const isLeaf = i === segments.length - 1;

    if (!isLeaf) {
      if (st.isSymbolicLink()) {
        throw new ProjectStoreError("path-escape", `intermediate symlink in storage path: ${relativePath}`);
      }
      try {
        const realCur = realpathSync(cur);
        if (!pathInside(realBase, realCur)) {
          throw new ProjectStoreError("path-escape", `storage path segment escapes root: ${relativePath}`);
        }
      } catch {
        throw new ProjectStoreError("path-escape", `storage path segment inaccessible: ${relativePath}`);
      }
    } else {
      if (st.isSymbolicLink()) {
        try {
          const realCur = realpathSync(cur);
          if (!pathInside(realBase, realCur)) {
            throw new ProjectStoreError("path-escape", `symlink target escapes root: ${relativePath}`);
          }
        } catch {
          throw new ProjectStoreError("path-escape", `symlink target inaccessible: ${relativePath}`);
        }
      } else {
        try {
          const realCur = realpathSync(cur);
          if (!pathInside(realBase, realCur)) {
            throw new ProjectStoreError("path-escape", `storage path escapes root: ${relativePath}`);
          }
        } catch {
          throw new ProjectStoreError("path-escape", `storage path target inaccessible: ${relativePath}`);
        }
      }
    }
  }

  return resolvedTarget;
}

function validateAndGetPacketOwnerId(packetPath: string): { ownerId: string; schemaVersion: number } {
  const sqlitePath = join(packetPath, "project.sqlite");
  if (!existsSync(sqlitePath)) {
    throw new ProjectStoreError("corrupt-packet", "packet is missing project.sqlite");
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
    configureDatabase(db);
  } catch (err) {
    throw new ProjectStoreError("corrupt-packet", `packet database is malformed or unreadable: ${(err as Error).message}`);
  }

  try {
    const integrity = db.prepare("PRAGMA integrity_check").get() as { integrity_check?: string } | undefined;
    if (!integrity || integrity.integrity_check !== "ok") {
      throw new ProjectStoreError("corrupt-packet", `packet database failed integrity check: ${integrity?.integrity_check ?? "unknown"}`);
    }

    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='projects'"
    ).get();
    if (!tableExists) {
      throw new ProjectStoreError("unsupported-schema", "packet database is missing projects table");
    }

    const row = db.prepare("SELECT owner_id, schema_version FROM projects LIMIT 1").get() as { owner_id?: string; schema_version?: number } | undefined;
    if (!row || typeof row.owner_id !== "string" || !row.owner_id.trim()) {
      throw new ProjectStoreError("corrupt-packet", "packet database has missing or invalid project owner");
    }

    let schemaVersion = 1;
    try {
      const v = readSchemaVersion(db);
      if (v > 0) {
        schemaVersion = v;
      }
    } catch {
      // Table may not exist, check projects table
    }
    if (typeof row.schema_version === "number" && row.schema_version > 0) {
      schemaVersion = Math.max(schemaVersion, row.schema_version);
    }

    return { ownerId: row.owner_id, schemaVersion };
  } catch (err) {
    if (err instanceof ProjectStoreError) {
      throw err;
    }
    throw new ProjectStoreError("corrupt-packet", `packet database validation failed: ${(err as Error).message}`);
  } finally {
    try { db.close(); } catch { /* ignore */ }
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

function validatePacketArtifactReferences(packetPath: string, manifest: PacketManifest): void {
  const sqlitePath = join(packetPath, "project.sqlite");
  const packetArtifactsDir = join(packetPath, "artifacts");
  const omittedIds = new Set((manifest.omissions ?? []).map((o) => String(o.artifactVersionId)));

  const manifestFileMap = new Map<string, string>();
  for (const f of manifest.files) {
    manifestFileMap.set(f.relativePath, f.sha256);
  }

  let db: DatabaseSync;
  try {
    db = new DatabaseSync(sqlitePath, { readOnly: true });
    configureDatabase(db);
  } catch (err) {
    throw new ProjectStoreError("corrupt-packet", `packet database is unreadable: ${(err as Error).message}`);
  }

  try {
    const tableExists = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='artifact_versions'"
    ).get();
    if (!tableExists) {
      return;
    }

    const rows = db.prepare(
      "SELECT id, storage_path, content_hash, content_status, access_level FROM artifact_versions"
    ).all() as Array<{
      id: string;
      storage_path: string | null;
      content_hash: string | null;
      content_status: string;
      access_level: string;
    }>;

    for (const row of rows) {
      const vId = String(row.id);
      if (
        row.content_status === "unavailable" ||
        row.access_level === "unavailable" ||
        omittedIds.has(vId)
      ) {
        continue;
      }

      if (!row.storage_path || typeof row.storage_path !== "string" || !row.storage_path.trim()) {
        throw new ProjectStoreError(
          "corrupt-packet",
          `packet has non-omitted artifact version ${vId} with missing storage path`
        );
      }

      const storagePath = row.storage_path;
      assertContainedArtifactPath(packetArtifactsDir, storagePath);

      const relPath = `artifacts/${storagePath}`;
      const expectedHash = manifestFileMap.get(relPath);
      if (!expectedHash || typeof expectedHash !== "string" || !/^[0-9a-f]{64}$/i.test(expectedHash)) {
        throw new ProjectStoreError(
          "corrupt-packet",
          `packet manifest is missing entry for referenced artifact: ${storagePath}`
        );
      }

      const fullDiskPath = join(packetPath, relPath);
      if (!existsSync(fullDiskPath)) {
        throw new ProjectStoreError(
          "corrupt-packet",
          `packet is missing referenced artifact file: ${storagePath}`
        );
      }

      const bytes = readFileSync(fullDiskPath);
      const actualHash = computeSha256(bytes);
      if (actualHash !== expectedHash) {
        throw new ProjectStoreError(
          "corrupt-packet",
          `packet artifact hash mismatch for referenced artifact: ${storagePath}`
        );
      }
      if (row.content_hash && actualHash !== row.content_hash) {
        throw new ProjectStoreError(
          "corrupt-packet",
          `packet artifact content hash does not match database record: ${storagePath}`
        );
      }
    }
  } catch (err) {
    if (err instanceof ProjectStoreError) {
      throw err;
    }
    throw new ProjectStoreError("corrupt-packet", `packet artifact validation failed: ${(err as Error).message}`);
  } finally {
    try { db.close(); } catch { /* ignore */ }
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

  // Require canonical hashed project.sqlite entry in manifest
  const sqliteEntries = inspection.manifest.files?.filter((f) => f && f.relativePath === "project.sqlite") ?? [];
  if (sqliteEntries.length !== 1 || typeof sqliteEntries[0].sha256 !== "string" || !/^[0-9a-f]{64}$/i.test(sqliteEntries[0].sha256)) {
    throw new ProjectStoreError("corrupt-packet", "packet manifest is missing canonical hashed project.sqlite entry");
  }

  // If packet file hashes do not match manifest, reject immediately before DB inspection or destination modification
  if (!inspection.valid) {
    if (request.mode === "drill") {
      return {
        mode: "drill",
        valid: false,
        hashResults: inspection.hashResults,
        operationId: newId("drill"),
        detail: "drill failed: hash mismatch detected",
        reinstatedGrants: [],
        preservedWithdrawals: []
      };
    }
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

  // Fail closed on unreadable/malformed/missing-schema/future-schema packet database
  const { ownerId: packetOwnerId, schemaVersion: dbSchemaVersion } = validateAndGetPacketOwnerId(request.sourcePath);
  if (dbSchemaVersion > PROJECT_SCHEMA_VERSION) {
    throw new ProjectStoreError(
      "unsupported-schema",
      `unsupported-schema: packet database schema version ${dbSchemaVersion} exceeds supported version ${PROJECT_SCHEMA_VERSION}`
    );
  }

  // Enforce matching owner between capability and source packet
  if (ownerCap.ownerId !== packetOwnerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match packet owner");
  }

  // Enforce checking every DB artifact reference has a safe, present, hash-valid packet artifact
  validatePacketArtifactReferences(request.sourcePath, inspection.manifest);

  // Enforce global command idempotency and payload conflict (for materialize and replace)
  if (request.mode === "materialize" || request.mode === "replace") {
    const existing = checkPortabilityCommand(request.commandId);
    if (existing) {
      if (existing.payloadHash && request.payloadHash && existing.payloadHash !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      if (resolve(existing.destinationPath) !== resolve(request.destinationPath)) {
        throw new ProjectStoreError(
          "payload-conflict",
          `payload-conflict: command ${request.commandId} was already executed for destination ${existing.destinationPath}`
        );
      }
      if (existing.status === "complete") {
        return {
          mode: request.mode,
          valid: true,
          hashResults: inspection.hashResults,
          operationId: existing.operationId,
          detail: `${request.mode} complete: idempotent return`,
          reinstatedGrants: [],
          preservedWithdrawals: []
        };
      }
    }
  }

  if (request.mode === "drill") {
    return {
      mode: "drill",
      valid: true,
      hashResults: inspection.hashResults,
      operationId: newId("drill"),
      detail: "drill passed: all hashes match",
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
    const destDbPath = join(destStore, "project.sqlite");
    if (existsSync(destDbPath)) {
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
                mode: "materialize",
                valid: true,
                hashResults: inspection.hashResults,
                operationId: String(row.id),
                detail: "materialize complete: idempotent return",
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
    }
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

      // Validate all artifact storage paths in destination database
      const destArtifactsDir = join(destStore, "artifacts");
      try {
        const db = new DatabaseSync(destDb);
        configureDatabase(db);
        try {
          const allArtifacts = db.prepare(
            "SELECT storage_path FROM artifact_versions WHERE storage_path IS NOT NULL"
          ).all() as Array<{ storage_path: string }>;
          for (const art of allArtifacts) {
            if (art.storage_path) {
              assertContainedArtifactPath(destArtifactsDir, art.storage_path);
            }
          }
        } finally {
          db.close();
        }
      } catch (err) {
        if (err instanceof ProjectStoreError) { throw err; }
      }

      // Record operation into destination database
      const opId = newId("restore");
      try {
        const db = new DatabaseSync(destDb);
        configureDatabase(db);
        try {
          transaction(db, () => {
            db.prepare(
              "INSERT INTO portability_operations (id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            ).run(opId, request.commandId, "restore-materialize", request.payloadHash ?? "", "complete", request.sourcePath, isoNow(), isoNow());
          });
        } finally {
          db.close();
        }
      } catch { /* table may not exist in earlier schema */ }

      recordPortabilityCommand({
        commandId: request.commandId,
        kind: "restore-materialize",
        payloadHash: request.payloadHash ?? null,
        sourcePath: request.sourcePath,
        destinationPath: request.destinationPath,
        status: "complete",
        operationId: opId
      });

      return {
        mode: "materialize",
        valid: true,
        hashResults: inspection.hashResults,
        operationId: opId,
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

  return protectCanonicalWrite(capability, () => {
    // Acquire destination write lock
    const lock = acquireProjectWriteLock(request.destinationPath);

    try {
      const destDbPath = join(destStore, "project.sqlite");
      if (!existsSync(destDbPath)) {
        throw new ProjectStoreError("project-not-found", "replace requires an existing project database");
      }
      const { ownerId: destOwnerId } = validateAndGetPacketOwnerId(destStore);
      if (capability.ownerId !== destOwnerId) {
        throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
      }
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

          // 6. Mark tombstoned artifacts as unavailable and unlink copied files in stage with strict containment
          const stageArtifactsDir = join(stageDir, "artifacts");

          // Defense-in-depth: validate containment of all artifact storage paths in packet database
          try {
            const allArtifacts = stagedDb.prepare(
              "SELECT storage_path FROM artifact_versions WHERE storage_path IS NOT NULL"
            ).all() as Array<{ storage_path: string }>;
            for (const art of allArtifacts) {
              if (art.storage_path) {
                assertContainedArtifactPath(stageArtifactsDir, art.storage_path);
              }
            }
          } catch (err) {
            if (err instanceof ProjectStoreError) { throw err; }
          }

          for (const tombstone of liveTombstones) {
            const vId = String(tombstone.artifact_version_id);
            let row: { storage_path?: string } | undefined;
            try {
              row = stagedDb.prepare("SELECT storage_path FROM artifact_versions WHERE id = ?").get(vId) as { storage_path?: string } | undefined;
            } catch { /* table or column may not exist */ }
            if (row?.storage_path) {
              const safePath = assertContainedArtifactPath(stageArtifactsDir, row.storage_path);
              if (existsSync(safePath)) {
                const st = lstatSync(safePath);
                if (st.isSymbolicLink()) {
                  unlinkSync(safePath);
                } else {
                  rmSync(safePath, { force: true, recursive: true });
                }
              }
            }
            try {
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

        // Atomic swap of BOTH DB and artifacts with complete rollback
        const bakDbPath = join(destStore, "project.sqlite.bak");
        const bakArtifactsDir = join(destStore, "artifacts.bak");
        const destArtifacts = join(destStore, "artifacts");

        // Backup existing database
        copyFileSync(destDbPath, bakDbPath);

        // Backup existing artifacts if any exist
        if (existsSync(destArtifacts)) {
          rmSync(bakArtifactsDir, { recursive: true, force: true });
          copyDirRecursive(destArtifacts, bakArtifactsDir);
        }

        try {
          copyFileSync(stageDbPath, destDbPath);
          const stageArtifacts = join(stageDir, "artifacts");
          if (existsSync(stageArtifacts)) {
            const tmpDestArtifacts = join(destStore, "artifacts.tmp");
            rmSync(tmpDestArtifacts, { recursive: true, force: true });
            copyDirRecursive(stageArtifacts, tmpDestArtifacts);
            rmSync(destArtifacts, { recursive: true, force: true });
            renameSync(tmpDestArtifacts, destArtifacts);
          } else {
            rmSync(destArtifacts, { recursive: true, force: true });
          }
          try { rmSync(bakDbPath, { force: true }); } catch { /* best effort */ }
          try { rmSync(bakArtifactsDir, { recursive: true, force: true }); } catch { /* best effort */ }
        } catch (swapError) {
          // Roll back database
          if (existsSync(bakDbPath)) {
            try {
              copyFileSync(bakDbPath, destDbPath);
              rmSync(bakDbPath, { force: true });
            } catch { /* best effort */ }
          }
          // Roll back artifacts
          if (existsSync(bakArtifactsDir)) {
            try {
              rmSync(destArtifacts, { recursive: true, force: true });
              renameSync(bakArtifactsDir, destArtifacts);
            } catch { /* best effort */ }
          }
          throw swapError;
        }
      } finally {
        rmSync(stageDir, { recursive: true, force: true });
      }

      const opId = newId("restore-replace");
      recordPortabilityCommand({
        commandId: request.commandId,
        kind: "restore-replace",
        payloadHash: request.payloadHash ?? null,
        sourcePath: request.sourcePath,
        destinationPath: request.destinationPath,
        status: "complete",
        operationId: opId
      });

      return {
        mode: "replace",
        valid: true,
        hashResults: inspection.hashResults,
        operationId: opId,
        detail: `replace complete: ${preservedWithdrawals.length} withdrawn/expired grants preserved`,
        reinstatedGrants: [],
        preservedWithdrawals
      };
    } finally {
      lock.release();
    }
  });
}
