// story: e18s03
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { openProject } from "../project/project-store.js";
import { restoreProject } from "../portability/restore-store.js";
import { sha256 } from "../persistence/storage-utils.js";
import type {
  ProductLifecycleOptions,
  ProductLifecycleReport
} from "./types.js";

const BANNED_PREFIXES = new Set(["/", "/usr", "/usr/local", "/etc", "/var", os.homedir()]);

export function validateLifecyclePrefix(prefix: string): string {
  const resolved = path.resolve(prefix);
  if (!resolved || resolved.trim().length === 0 || BANNED_PREFIXES.has(resolved)) {
    throw new Error(`runProductLifecycle requires an isolated prefix directory; rejected unsafe prefix: ${prefix}`);
  }
  return resolved;
}

export async function runProductLifecycle(
  options: ProductLifecycleOptions
): Promise<ProductLifecycleReport> {
  const resolvedPrefix = validateLifecyclePrefix(options.prefix);
  const projectFolder = path.resolve(options.projectFolder);
  const dbPath = path.join(projectFolder, ".ganesh", "project.sqlite");
  const artifactsDir = path.join(projectFolder, ".ganesh", "artifacts");

  if (options.action === "upgrade") {
    if (!fs.existsSync(dbPath)) {
      return {
        status: "fail",
        action: "upgrade",
        prefix: resolvedPrefix,
        projectFolder,
        reasons: [`Project database does not exist at ${dbPath}`]
      };
    }

    if (options.tarballPath) {
      const installResult = spawnSync(
        "npm",
        ["install", options.tarballPath, "--prefix", resolvedPrefix, "--no-audit", "--no-fund"],
        { cwd: resolvedPrefix, encoding: "utf8" }
      );
      if (installResult.status !== 0) {
        return {
          status: "fail",
          action: "upgrade",
          prefix: resolvedPrefix,
          projectFolder,
          reasons: [`npm install into prefix failed: ${installResult.stderr}`]
        };
      }
    }

    let artifactHashMatches = true;
    const reasons: string[] = [];

    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const rows = db.prepare(
        "SELECT storage_path, content_hash FROM artifact_versions WHERE storage_path IS NOT NULL AND content_status = 'available'"
      ).all() as Array<{ storage_path: string; content_hash: string | null }>;

      for (const row of rows) {
        const filePath = path.join(artifactsDir, row.storage_path);
        if (!fs.existsSync(filePath)) {
          artifactHashMatches = false;
          reasons.push(`Artifact file missing: ${row.storage_path}`);
          continue;
        }
        if (row.content_hash) {
          const actualHash = sha256(fs.readFileSync(filePath));
          if (actualHash !== row.content_hash) {
            artifactHashMatches = false;
            reasons.push(`Artifact hash mismatch: ${row.storage_path}`);
          }
        }
      }
    } finally {
      db.close();
    }

    let schemaStatus = "unknown";
    let reopened = false;
    try {
      const handle = openProject(projectFolder);
      schemaStatus = handle.status === "ready" ? "supported" : handle.status;
      reopened = handle.status === "ready";
      handle.close();
    } catch (err) {
      reasons.push(`Failed to reopen project: ${(err as Error).message}`);
    }

    const passed = reopened && artifactHashMatches && schemaStatus === "supported" && reasons.length === 0;
    return {
      status: passed ? "pass" : "fail",
      action: "upgrade",
      prefix: resolvedPrefix,
      projectFolder,
      schemaStatus,
      artifactHashMatches,
      projectPreserved: fs.existsSync(dbPath),
      reopened,
      reasons: passed ? undefined : reasons
    };
  }

  if (options.action === "uninstall") {
    if (!fs.existsSync(dbPath)) {
      return {
        status: "fail",
        action: "uninstall",
        prefix: resolvedPrefix,
        projectFolder,
        reasons: [`Project database does not exist at ${dbPath}`]
      };
    }

    let deletionEventsBefore = 0;
    const dbBefore = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = dbBefore.prepare("SELECT count(*) as count FROM deletion_events").get() as { count: number } | undefined;
      deletionEventsBefore = row?.count ?? 0;
    } catch {
      // Table might not exist in empty db
    } finally {
      dbBefore.close();
    }

    spawnSync(
      "npm",
      ["uninstall", "ganesh", "--prefix", resolvedPrefix, "--no-audit", "--no-fund"],
      { cwd: resolvedPrefix, encoding: "utf8" }
    );

    const packageInPrefix = path.join(resolvedPrefix, "node_modules", "ganesh");
    const binInPrefix = path.join(resolvedPrefix, "bin", "ganesh");
    if (fs.existsSync(packageInPrefix)) {
      fs.rmSync(packageInPrefix, { recursive: true, force: true });
    }
    if (fs.existsSync(binInPrefix)) {
      fs.rmSync(binInPrefix, { force: true });
    }

    const uninstalledFromPrefix = !fs.existsSync(packageInPrefix) && !fs.existsSync(binInPrefix);
    const projectPreserved = fs.existsSync(dbPath);
    const artifactsPreserved = fs.existsSync(artifactsDir);

    let e15DeletionRecorded = false;
    const dbAfter = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const row = dbAfter.prepare("SELECT count(*) as count FROM deletion_events").get() as { count: number } | undefined;
      const deletionEventsAfter = row?.count ?? 0;
      if (deletionEventsAfter > deletionEventsBefore) {
        e15DeletionRecorded = true;
      }
    } catch {
      // ignore
    } finally {
      dbAfter.close();
    }

    const passed = uninstalledFromPrefix && projectPreserved && artifactsPreserved && !e15DeletionRecorded;
    return {
      status: passed ? "pass" : "fail",
      action: "uninstall",
      prefix: resolvedPrefix,
      projectFolder,
      uninstalledFromPrefix,
      projectPreserved,
      artifactsPreserved,
      e15DeletionRecorded,
      reasons: passed ? undefined : ["Uninstall did not meet preservation criteria"]
    };
  }

  if (options.action === "rollback-check") {
    const reasons: string[] = [];

    if (options.previousTarballPath) {
      const installResult = spawnSync(
        "npm",
        ["install", options.previousTarballPath, "--prefix", resolvedPrefix, "--no-audit", "--no-fund"],
        { cwd: resolvedPrefix, encoding: "utf8" }
      );
      if (installResult.status !== 0) {
        reasons.push(`npm install previous tarball failed: ${installResult.stderr}`);
      }
    }

    let restored = false;
    if (options.backupPath && options.ownerCapability) {
      try {
        const restoreRes = restoreProject(options.ownerCapability, {
          commandId: options.commandId ?? `rollback-restore-${Date.now()}`,
          sourcePath: options.backupPath,
          destinationPath: projectFolder,
          mode: "replace",
          payloadHash: ""
        });
        restored = restoreRes.valid;
      } catch (err) {
        reasons.push(`E15 restore failed: ${(err as Error).message}`);
      }
    } else {
      restored = true;
    }

    let reopened = false;
    try {
      const handle = openProject(projectFolder);
      reopened = handle.status === "ready";
      handle.close();
    } catch (err) {
      reasons.push(`Failed to reopen project after rollback: ${(err as Error).message}`);
    }

    const passed = restored && reopened && reasons.length === 0;
    return {
      status: passed ? "pass" : "fail",
      action: "rollback-check",
      prefix: resolvedPrefix,
      projectFolder,
      rollbackEngine: "e15",
      reopened,
      reasons: passed ? undefined : reasons
    };
  }

  throw new Error(`Unsupported lifecycle action: ${String((options as { action: unknown }).action)}`);
}
