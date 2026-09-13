// story: e02s03
import { lstatSync, realpathSync, rmSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectHandle,
  type RecoveryResult,
  type SchemaStatus,
  ProjectStoreError
} from "../project/project-types.js";
import { inspectArtifactVersion, listArtifactVersions, listTemporaryArtifactFiles } from "../artifacts/artifact-store.js";
import { openProject } from "../project/project-store.js";
import { transaction } from "../persistence/schema.js";
import { hasSymlinkBetween, isoNow, newId, pathInside } from "../persistence/storage-utils.js";

export function schemaStatus(handle: ProjectHandle): SchemaStatus {
  const version = handle.project.schemaVersion;
  if (version > PROJECT_SCHEMA_VERSION) {
    return {
      status: "unknown-future",
      version,
      supportedVersion: PROJECT_SCHEMA_VERSION,
      allowedOperations: ["inspect", "export-metadata"],
      remediation: `Upgrade Ganesh to read schema version ${version} before mutating this project.`
    };
  }
  if (version < PROJECT_SCHEMA_VERSION) {
    return {
      status: "migration-required",
      version,
      supportedVersion: PROJECT_SCHEMA_VERSION,
      allowedOperations: ["inspect", "export-metadata"],
      remediation: `Run the supported migration before mutating schema version ${version}.`
    };
  }
  return {
    status: "supported",
    version,
    supportedVersion: PROJECT_SCHEMA_VERSION,
    allowedOperations: handle.writable ? ["inspect", "mutate", "recover"] : ["inspect", "recover-read-only"],
    remediation: handle.writable ? "No schema action is required." : "Open the project from a writable storage root to enable mutations."
  };
}

export function recordRecoveryCheckpoint(
  handle: ProjectHandle,
  operation: string,
  stage: string,
  status: "started" | "completed" | "blocked" | "failed",
  details: string
): string {
  if (!handle.writable) {
    throw new ProjectStoreError("read-only", "cannot record a recovery checkpoint on a read-only project");
  }
  handle.assertCurrent();
  const id = newId("checkpoint");
  transaction(handle.db, () => {
    handle.db.prepare(
      "INSERT INTO recovery_checkpoints (id, operation, stage, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, operation, stage, status, details, isoNow());
  });
  return id;
}

function artifactInspection(handle: ProjectHandle): ReturnType<typeof inspectArtifactVersion>[] {
  return listArtifactVersions(handle).map((artifact) => inspectArtifactVersion(handle, artifact.id));
}

function safeRecoveryPath(allowedRoots: readonly string[], recordedPath: string, boundary: string): string | null {
  const target = resolve(recordedPath);
  for (const root of allowedRoots) {
    const resolvedRoot = resolve(root);
    if (!pathInside(resolvedRoot, target) || target === resolvedRoot || hasSymlinkBetween(resolvedRoot, boundary)) { continue; }
    let realRoot: string;
    try {
      if (lstatSync(resolvedRoot).isSymbolicLink()) { continue; }
      realRoot = realpathSync(resolvedRoot); } catch { continue; }
    let current = target;
    while (current !== resolvedRoot) {
      try {
        const stat = lstatSync(current);
        if (current !== target && stat.isSymbolicLink()) { current = ""; break; }
        if (current !== target && !pathInside(realRoot, realpathSync(current))) { current = ""; break; }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { current = ""; break; }
      }
      const parent = dirname(current);
      if (parent === current) { current = ""; break; }
      current = parent;
    }
    if (current === resolvedRoot) { return target; }
  }
  return null;
}

function reconcileDeletionPaths(handle: ProjectHandle): void {
  const allowedRoots = [handle.project.artifactRoot, join(handle.project.rootPath, ".ganesh", "backups")];
  let rows: Array<{ id: string; unlinked_paths: string }>;
  try {
    rows = handle.db.prepare("SELECT id, unlinked_paths FROM deletion_events WHERE unlinked_paths IS NOT NULL").all() as Array<{ id: string; unlinked_paths: string }>;
  } catch {
    return;
  }
  for (const row of rows) {
    let paths: string[];
    try {
      const parsed = JSON.parse(row.unlinked_paths);
      if (!Array.isArray(parsed) || !parsed.every((path): path is string => typeof path === "string")) {
        continue;
      }
      paths = parsed;
    } catch {
      continue;
    }
    const remaining: string[] = [];
    for (const path of paths) {
      const target = safeRecoveryPath(allowedRoots, path, handle.project.rootPath);
      if (!target || target === resolve(handle.project.rootPath)) {
        remaining.push(path);
        continue;
      }
      try {
        const stat = lstatSync(target);
        if (stat.isSymbolicLink()) { unlinkSync(target); }
        else { rmSync(target, { force: true, recursive: true }); }
        try { lstatSync(target); remaining.push(target); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") { remaining.push(target); }
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") { remaining.push(target); }
      }
    }
    transaction(handle.db, () => {
      handle.db.prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
        .run(JSON.stringify(remaining), row.id);
    });
  }
}

export function recoverProject(projectRoot: string): RecoveryResult {
  const handle = openProject(projectRoot);
  try {
    const schema = schemaStatus(handle);
    const temporaryFiles = listTemporaryArtifactFiles(handle);
    const canMutate = handle.writable && schema.status === "supported";

    // Collect pending lifecycle operations regardless of mutability
    let uncertainOperationIds: string[] = [];
    try {
      const pendingRows = handle.db.prepare(
        "SELECT id FROM lifecycle_operations WHERE status IN ('pending', 'running', 'queued', 'waiting')"
      ).all() as Array<Record<string, unknown>>;
      uncertainOperationIds = pendingRows.map((r) => String(r.id));
    } catch { /* lifecycle table may not exist */ }

    if (!canMutate) {
      return {
        status: handle.status,
        removedTemporaryFiles: [],
        artifactStatuses: artifactInspection(handle),
        checkpointId: null,
        detail: `${schema.status} project opened for inspection; no recovery mutation was attempted`,
        uncertainOperationIds
      };
    }

    for (const path of temporaryFiles) {
      rmSync(path, { force: true });
    }
    reconcileDeletionPaths(handle);
    const checkpointId = recordRecoveryCheckpoint(
      handle,
      "project-recovery",
      "reconcile-artifacts",
      "completed",
      `removed ${temporaryFiles.length} temporary artifact file(s)`
    );
    return {
      status: "ready",
      removedTemporaryFiles: temporaryFiles,
      artifactStatuses: artifactInspection(handle),
      checkpointId,
      detail: "last complete database state retained; temporary files reconciled",
      uncertainOperationIds
    };
  } finally {
    handle.close();
  }
}
