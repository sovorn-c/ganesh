// story: e15s04
import { existsSync, rmSync, readdirSync, lstatSync, realpathSync, unlinkSync } from "node:fs";
import { join, resolve, relative, isAbsolute } from "node:path";
import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, type OwnerCapability, protectCanonicalWrite, isWorkerCapability } from "../authority/capability-broker.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId, pathInside } from "../persistence/storage-utils.js";
import { dependentVersions } from "../branches/dependency-store.js";
import type {
  DeletionRequest, DeletionResult, EvidenceTombstone, DeletionEvent, NotRecalledDisclosure
} from "./portability-types.js";

function safeContainedPath(baseDir: string, relativeOrFullPath: string): string | null {
  const resolvedBase = resolve(baseDir);
  if (!existsSync(resolvedBase)) {
    return null;
  }
  let realBase: string;
  try {
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
        try {
          const realCur = realpathSync(cur);
          if (!pathInside(realBase, realCur)) {
            return null;
          }
        } catch {
          return null;
        }
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

      // B. Derived materials table
      try {
        const derivedRows = handle.db.prepare(
          "SELECT candidate_version_id FROM derived_materials WHERE source_version_ids LIKE ?"
        ).all(`%${current}%`) as Array<Record<string, unknown>>;
        for (const d of derivedRows) {
          const candId = d.candidate_version_id ? String(d.candidate_version_id) : null;
          if (candId && !allAffectedVersionIds.has(candId)) {
            allAffectedVersionIds.add(candId);
            queue.push(candId);
          }
        }
      } catch { /* derived_materials table might not exist */ }
    }

    const unlinkedPaths: string[] = [];
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

        const safePath = safeContainedPath(handle.project.artifactRoot, vStoragePath);
        if (safePath) {
          const st = lstatSync(safePath);
          if (st.isSymbolicLink()) {
            unlinkSync(safePath);
          } else {
            rmSync(safePath, { force: true, recursive: true });
          }
          unlinkedPaths.push(safePath);
        }

        // Unlink from app backups if requested
        if (request.includeAppBackups) {
          const backupsDir = join(storeRoot, "backups");
          if (existsSync(backupsDir)) {
            try {
              for (const entry of readdirSync(backupsDir, { withFileTypes: true })) {
                if (entry.isDirectory() && !entry.isSymbolicLink()) {
                  const backupFile = join(backupsDir, entry.name, "artifacts", vStoragePath);
                  const safeBackupPath = safeContainedPath(storeRoot, backupFile);
                  if (safeBackupPath) {
                    const bSt = lstatSync(safeBackupPath);
                    if (bSt.isSymbolicLink()) {
                      unlinkSync(safeBackupPath);
                    } else {
                      rmSync(safeBackupPath, { force: true, recursive: true });
                    }
                    unlinkedPaths.push(safeBackupPath);
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
              const safeDir = safeContainedPath(storeRoot, p);
              if (safeDir) {
                scanForCache(safeDir);
              }
            } else if (entry.name.includes(".cache")) {
              const matchesAffected = Array.from(affectedTokens).some(tok => entry.name.includes(tok));
              if (matchesAffected) {
                const safeCachePath = safeContainedPath(storeRoot, p);
                if (safeCachePath) {
                  rmSync(safeCachePath, { force: true });
                  unlinkedPaths.push(safeCachePath);
                }
              }
            }
          }
        } catch { /* permission or race */ }
      };
      scanForCache(artifactRoot);
    }

    // 4. Collect not-recalled disclosures across all affected versions
    const notRecalledDisclosures: NotRecalledDisclosure[] = [];
    for (const vId of allAffectedVersionIds) {
      try {
        const disclosureRows = handle.db.prepare(
          "SELECT id, destination, purpose FROM disclosure_decisions WHERE source_version_ids LIKE ? AND status = 'allow' AND destination != 'local'"
        ).all(`%${vId}%`) as Array<Record<string, unknown>>;
        for (const d of disclosureRows) {
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
      } catch { /* disclosure table may not exist */ }
    }

    // 5. Persist tombstones, deletion event, and mark all affected versions unavailable in one transaction
    const deletionEventId = newId("deletion");
    transaction(handle.db, () => {
      for (const vId of allAffectedVersionIds) {
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
          "UPDATE artifact_versions SET content_status = 'unavailable', access_level = 'unavailable' WHERE id = ?"
        ).run(vId);
      }

      handle.db.prepare(
        "INSERT INTO deletion_events (id, artifact_version_id, unlinked_paths, tombstone_id, not_recalled_disclosures, command_id, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(deletionEventId, versionId, JSON.stringify(unlinkedPaths), tombstoneId, JSON.stringify(notRecalledDisclosures), request.commandId, request.payloadHash, now);
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

export function getEvidenceTombstone(
  handle: ProjectHandle,
  _capability: unknown,
  artifactVersionId: string
): EvidenceTombstone | undefined {
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
  _capability: unknown
): readonly DeletionEvent[] {
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
