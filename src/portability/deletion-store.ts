// story: e15s04
import { existsSync, rmSync, readdirSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import { hasSymlinkBetween, isoNow, newId, pathInside } from "../persistence/storage-utils.js";
import { dependentVersions } from "../branches/dependency-store.js";
import type {
  DeletionRequest, DeletionResult, EvidenceTombstone, DeletionEvent, NotRecalledDisclosure
} from "./portability-types.js";

function safeContainedPath(baseDir: string, relativeOrFullPath: string, boundary = baseDir): string | null {
  const resolvedBase = resolve(baseDir);
  if (!existsSync(resolvedBase) || hasSymlinkBetween(resolvedBase, boundary)) {
    return null;
  }
  let realBase: string;
  try {
    if (lstatSync(resolvedBase).isSymbolicLink()) { return null; }
    realBase = realpathSync(resolvedBase);
  } catch {
    return null;
  }

  const target = isAbsolute(relativeOrFullPath)
    ? resolve(relativeOrFullPath)
    : resolve(resolvedBase, relativeOrFullPath);

  const rel = relative(resolvedBase, target);
  if (rel.startsWith("..") || isAbsolute(rel) || rel === "") {
    return null;
  }

  const segments = rel.split(/[\\/]+/).filter(Boolean);
  let cur = resolvedBase;

  for (let i = 0; i < segments.length; i++) {
    cur = join(cur, segments[i]);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return null;
    }

    const isLeaf = i === segments.length - 1;

    if (!isLeaf) {
      if (st.isSymbolicLink()) {
        return null;
      }
      try {
        const realCur = realpathSync(cur);
        if (!pathInside(realBase, realCur)) {
          return null;
        }
      } catch {
        return null;
      }
    } else {
      if (st.isSymbolicLink()) {
        // Unlinking the leaf itself never follows its target, including a
        // broken or externally-targeted symlink.
      } else {
        try {
          const realCur = realpathSync(cur);
          if (!pathInside(realBase, realCur)) {
            return null;
          }
        } catch {
          return null;
        }
      }
    }
  }

  return cur;
}

function safeRecordedDeletionPath(handle: ProjectHandle, path: string): string | null {
  const roots = [handle.project.artifactRoot, join(handle.project.rootPath, ".ganesh", "backups")];
  for (const root of roots) {
    const safe = safeContainedPath(root, path, handle.project.rootPath);
    if (safe) { return safe; }
  }
  return null;
}

type CleanupResult = "removed" | "missing" | "pending";

function unlinkContainedPath(handle: ProjectHandle, recordedPath: string): CleanupResult {
  const safePath = safeRecordedDeletionPath(handle, recordedPath);
  if (!safePath) {
    try {
      lstatSync(resolve(recordedPath));
      return "pending";
    } catch (error) {
      return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "pending";
    }
  }
  try {
    const stat = lstatSync(safePath);
    if (stat.isSymbolicLink()) {
      unlinkSync(safePath);
    } else {
      rmSync(safePath, { force: true, recursive: true });
    }
    return "removed";
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "pending";
  }
}

export function deleteArtifactContent(
  handle: ProjectHandle,
  capability: unknown,
  request: DeletionRequest
): DeletionResult {
  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot delete artifact content");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: deletion requires owner capability");
  }
  const ownerCap = capability as OwnerCapability;
  if (ownerCap.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }
  assertWritable(handle);

  return protectCanonicalWrite(capability, () => {
    const existing = handle.db.prepare(
      "SELECT id, tombstone_id, unlinked_paths, not_recalled_disclosures, payload_hash FROM deletion_events WHERE command_id = ?"
    ).get(request.commandId) as Record<string, unknown> | undefined;
    if (existing) {
      if (String(existing.payload_hash) !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      const pending: string[] = [];
      let paths: string[];
      try {
        const parsed = JSON.parse(String(existing.unlinked_paths));
        if (!Array.isArray(parsed) || !parsed.every((path): path is string => typeof path === "string")) {
          throw new Error("unlinked_paths must be an array of strings");
        }
        paths = parsed;
      } catch (error) {
        throw new ProjectStoreError("corrupt-packet", `deletion event has malformed unlinked_paths: ${(error as Error).message}`);
      }
      for (const path of paths) {
        if (unlinkContainedPath(handle, path) === "pending") { pending.push(path); }
      }
      transaction(handle.db, () => {
        handle.db.prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
          .run(JSON.stringify(pending), String(existing.id));
      });
      let notRecalledDisclosures: NotRecalledDisclosure[] = [];
      try { notRecalledDisclosures = JSON.parse(String(existing.not_recalled_disclosures)) as NotRecalledDisclosure[]; } catch { /* preserve empty inspection fallback */ }
      return {
        deletionEventId: String(existing.id),
        unlinkedPaths: pending,
        tombstoneId: String(existing.tombstone_id),
        notRecalledDisclosures,
        detail: `deletion already recorded; ${pending.length} path(s) remain for recovery`
      };
    }
    const versionId = request.artifactVersionId;

    // Verify artifact exists
    const row = handle.db.prepare(
      "SELECT id, content_hash, storage_path, access_level FROM artifact_versions WHERE id = ?"
    ).get(versionId) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("artifact-not-found", `artifact version ${versionId} was not found`);
    }

    // 1. Discover all reachable versions through dependencies and derived materials
    const allAffectedVersionIds = new Set<string>([versionId]);
    const queue = [versionId];
    while (queue.length > 0) {
      const current = queue.shift()!;
      // A. Dependencies table
      try {
        const deps = dependentVersions(handle, current);
        for (const dep of deps) {
          if (!allAffectedVersionIds.has(dep)) {
            allAffectedVersionIds.add(dep);
            queue.push(dep);
          }
        }
      } catch { /* dependencies table might not exist in old schemas */ }

      // B. Derived materials table: exact parsed membership
      try {
        const derivedRows = handle.db.prepare(
          "SELECT candidate_version_id, source_version_ids FROM derived_materials WHERE source_version_ids IS NOT NULL"
        ).all() as Array<{ candidate_version_id?: string; source_version_ids?: string }>;
        for (const d of derivedRows) {
          const candId = d.candidate_version_id ? String(d.candidate_version_id) : null;
          if (candId && !allAffectedVersionIds.has(candId) && d.source_version_ids) {
            let matches = false;
            try {
              const parsed = JSON.parse(d.source_version_ids);
              if (Array.isArray(parsed) && parsed.some(x => String(x) === current)) {
                matches = true;
              }
            } catch {
              const tokens = d.source_version_ids.split(/[,\s[\]"']+/).filter(Boolean);
              if (tokens.includes(current)) {
                matches = true;
              }
            }
            if (matches) {
              allAffectedVersionIds.add(candId);
              queue.push(candId);
            }
          }
        }
      } catch { /* derived_materials table might not exist */ }
    }

    const unlinkedPaths: string[] = [];
    const pathsToUnlink = new Set<string>();
    const storeRoot = join(handle.project.rootPath, ".ganesh");
    const now = isoNow();
    const actor = ownerCap.ownerId;
    const tombstoneId = newId("tombstone");
    const tombstoneMap = new Map<string, string>();
    tombstoneMap.set(versionId, tombstoneId);

    // Collect affected tokens for targeted cache matching
    const affectedTokens = new Set<string>();

    // 2. Unlink files and app backups for all affected versions with strict containment
    for (const vId of allAffectedVersionIds) {
      affectedTokens.add(vId);
      const vRow = handle.db.prepare(
        "SELECT id, content_hash, storage_path FROM artifact_versions WHERE id = ?"
      ).get(vId) as Record<string, unknown> | undefined;
      const vStoragePath = vRow?.storage_path ? String(vRow.storage_path) : null;
      if (vRow?.content_hash) {
        affectedTokens.add(String(vRow.content_hash));
      }

      if (vStoragePath) {
        const baseName = vStoragePath.split(/[\\/]+/).pop();
        if (baseName) {
          affectedTokens.add(baseName);
        }

        const safePath = safeContainedPath(handle.project.artifactRoot, vStoragePath, handle.project.rootPath);
        if (safePath) {
          pathsToUnlink.add(safePath);
        }

        // Unlink from app backups if requested
        if (request.includeAppBackups) {
          const backupsDir = join(storeRoot, "backups");
          if (existsSync(backupsDir)) {
            try {
              for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
                if (entry.isDirectory() && !entry.isSymbolicLink()) {
                  const backupFile = join(backupsDir, entry.name, "artifacts", vStoragePath);
                  const safeBackupPath = safeContainedPath(storeRoot, backupFile, handle.project.rootPath);
                  if (safeBackupPath) {
                    pathsToUnlink.add(safeBackupPath);
                  }
                }
              }
            } catch { /* best effort */ }
          }
        }
      }

      if (vId !== versionId) {
        tombstoneMap.set(vId, newId("tombstone"));
      }
    }

    // 3. Unlink project-owned/derived/cache paths for affected versions (preserving unrelated caches)
    const artifactRoot = handle.project.artifactRoot;
    if (existsSync(artifactRoot)) {
      const scanForCache = (dir: string) => {
        try {
          for (const entry of readdirSync(dir, { withFileTypes: true })) {
            const p = join(dir, entry.name);
            let st;
            try {
              st = lstatSync(p);
            } catch {
              continue;
            }
            if (st.isSymbolicLink()) {
              // Strict no-follow: do not follow symbolic links during traversal
              continue;
            }
            if (st.isDirectory()) {
              const safeDir = safeContainedPath(storeRoot, p, handle.project.rootPath);
              if (safeDir) {
                scanForCache(safeDir);
              }
            } else if (entry.name.includes(".cache") || dir.split(/[\\/]+/).includes("cache")) {
              // Exact stem / token membership: never substring-match overlapping IDs
              const stems = new Set<string>();
              stems.add(entry.name.replace(/\.cache.*$/, ""));
              const lastDot = entry.name.lastIndexOf(".");
              if (lastDot > 0) {
                stems.add(entry.name.slice(0, lastDot));
              }
              stems.add(entry.name);
              const matchesAffected = Array.from(stems).some(s => s && affectedTokens.has(s));
              if (matchesAffected) {
                const safeCachePath = safeContainedPath(storeRoot, p, handle.project.rootPath);
                if (safeCachePath) {
                  pathsToUnlink.add(safeCachePath);
                }
              }
            }
          }
        } catch { /* permission or race */ }
      };
      scanForCache(artifactRoot);
    }

    // 4. Collect not-recalled disclosures across all affected versions with exact parsed membership
    const notRecalledDisclosures: NotRecalledDisclosure[] = [];
    try {
      const disclosureRows = handle.db.prepare(
        "SELECT id, destination, purpose, source_version_ids FROM disclosure_decisions WHERE status = 'allow' AND destination != 'local' AND source_version_ids IS NOT NULL"
      ).all() as Array<{ id: string; destination: string; purpose: string; source_version_ids: string }>;
      for (const d of disclosureRows) {
        let matches = false;
        try {
          const parsed = JSON.parse(d.source_version_ids);
          if (Array.isArray(parsed) && parsed.some(x => allAffectedVersionIds.has(String(x)))) {
            matches = true;
          }
        } catch {
          const tokens = d.source_version_ids.split(/[,\s[\]"']+/).filter(Boolean);
          if (tokens.some(tok => allAffectedVersionIds.has(tok))) {
            matches = true;
          }
        }
        if (matches) {
          const dId = String(d.id);
          if (!notRecalledDisclosures.some(x => x.disclosureId === dId)) {
            notRecalledDisclosures.push({
              disclosureId: dId,
              destination: String(d.destination),
              purpose: String(d.purpose),
              status: "recall-not-promised"
            });
          }
        }
      }
    } catch { /* disclosure table may not exist */ }

    // 5. Commit the durable deletion decision before unlinking bytes. The
    // database never claims a file was removed before its tombstone exists.
    const deletionEventId = newId("deletion");
    const affectedIds = [...allAffectedVersionIds];
    const placeholders = affectedIds.map(() => "?").join(",");
    transaction(handle.db, () => {
      for (const vId of affectedIds) {
        const vRow = handle.db.prepare(
          "SELECT id, content_hash FROM artifact_versions WHERE id = ?"
        ).get(vId) as Record<string, unknown> | undefined;
        const vHash = vRow?.content_hash ? String(vRow.content_hash) : null;
        const tId = tombstoneMap.get(vId) ?? newId("tombstone");
        const tReason = vId === versionId ? request.reason : `cascaded dependent deletion from ${versionId}: ${request.reason}`;

        handle.db.prepare(
          "INSERT INTO evidence_tombstones (id, artifact_version_id, content_hash, reason, actor, deleted_at) VALUES (?, ?, ?, ?, ?, ?)"
        ).run(tId, vId, vHash, tReason, actor, now);

        handle.db.prepare(
          "UPDATE artifact_versions SET storage_path = NULL, content_hash = NULL, byte_length = NULL, content_status = 'unavailable', access_level = 'unavailable' WHERE id = ?"
        ).run(vId);
        try {
          handle.db.prepare("UPDATE source_versions SET access_level = 'unavailable' WHERE artifact_version_id = ?").run(vId);
        } catch { /* optional table */ }
      }

      // Remove derived/source excerpts in the same transaction as the tombstone.
      try {
        handle.db.prepare(`DELETE FROM claim_evidence_links WHERE evidence_item_id IN (SELECT id FROM evidence_items WHERE source_version_id IN (${placeholders}))`).run(...affectedIds);
      } catch { /* optional table */ }
      for (const [table, column] of [
        ["evidence_items", "source_version_id"],
        ["source_segments", "source_version_id"],
        ["source_segments", "derived_version_id"],
        ["source_records", "source_version_id"],
        ["source_locators", "artifact_version_id"],
        ["source_diagnostics", "artifact_version_id"],
        ["citation_verifications", "source_version_id"],
        ["claim_reassessments", "source_version_id"],
        ["appraisals", "source_version_id"]
      ] as const) {
        try { handle.db.prepare(`DELETE FROM ${table} WHERE ${column} IN (${placeholders})`).run(...affectedIds); } catch { /* optional table */ }
      }
      try {
        const derived = handle.db.prepare("SELECT id, candidate_version_id, source_version_ids FROM derived_materials").all() as Array<Record<string, unknown>>;
        for (const row of derived) {
          let matches = row.candidate_version_id !== null && row.candidate_version_id !== undefined && allAffectedVersionIds.has(String(row.candidate_version_id));
          if (!matches && typeof row.source_version_ids === "string") {
            try {
              const parsed = JSON.parse(row.source_version_ids);
              matches = Array.isArray(parsed) && parsed.some((item) => allAffectedVersionIds.has(String(item)));
            } catch {
              matches = row.source_version_ids.split(/[\s,[\]"']+/).filter(Boolean).some((item) => allAffectedVersionIds.has(item));
            }
          }
          if (matches) {
            handle.db.prepare("DELETE FROM derived_materials WHERE id = ?").run(String(row.id));
          }
        }
      } catch { /* optional table */ }

      handle.db.prepare(
        "INSERT INTO deletion_events (id, artifact_version_id, unlinked_paths, tombstone_id, not_recalled_disclosures, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(deletionEventId, versionId, JSON.stringify([...pathsToUnlink]), tombstoneId, JSON.stringify(notRecalledDisclosures), request.commandId, request.payloadHash, now);
    });

    // Filesystem cleanup is deliberately after the durable transaction. A
    // failed unlink leaves unavailable metadata and can be retried safely.
    const remainingPaths: string[] = [];
    for (const path of pathsToUnlink) {
      const result = unlinkContainedPath(handle, path);
      if (result === "removed") {
        unlinkedPaths.push(path);
      } else if (result === "pending") {
        remainingPaths.push(path);
      }
    }
    transaction(handle.db, () => {
      handle.db.prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
        .run(JSON.stringify(remainingPaths), deletionEventId);
    });

    return {
      deletionEventId,
      unlinkedPaths,
      tombstoneId,
      notRecalledDisclosures,
      detail: `deleted ${unlinkedPaths.length} file(s); ${notRecalledDisclosures.length} not-recalled disclosure(s)`
    };
  });
}

function requireDeletionReadCapability(handle: ProjectHandle, capability: unknown): void {
  if (!isOwnerCapability(capability) || capability.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: deletion records require the project owner capability");
  }
}

export function getEvidenceTombstone(
  handle: ProjectHandle,
  capability: unknown,
  artifactVersionId: string
): EvidenceTombstone | undefined {
  requireDeletionReadCapability(handle, capability);
  const row = handle.db.prepare(
    "SELECT id, artifact_version_id, content_hash, reason, actor, deleted_at FROM evidence_tombstones WHERE artifact_version_id = ? LIMIT 1"
  ).get(artifactVersionId) as Record<string, unknown> | undefined;
  if (!row) {return undefined;}
  return {
    id: String(row.id),
    artifactVersionId: String(row.artifact_version_id),
    contentHash: row.content_hash ? String(row.content_hash) : null,
    reason: String(row.reason),
    actor: String(row.actor),
    deletedAt: String(row.deleted_at)
  };
}

export function listDeletionEvents(
  handle: ProjectHandle,
  capability: unknown
): readonly DeletionEvent[] {
  requireDeletionReadCapability(handle, capability);
  const rows = handle.db.prepare(
    "SELECT id, artifact_version_id, unlinked_paths, tombstone_id, not_recalled_disclosures, command_id, payload_hash, created_at FROM deletion_events ORDER BY created_at"
  ).all() as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id),
    artifactVersionId: String(row.artifact_version_id),
    unlinkedPaths: String(row.unlinked_paths),
    tombstoneId: String(row.tombstone_id),
    notRecalledDisclosures: String(row.not_recalled_disclosures),
    commandId: String(row.command_id),
    payloadHash: String(row.payload_hash),
    createdAt: String(row.created_at)
  }));
}
