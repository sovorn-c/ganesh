// story: e15s01
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { PROJECT_SCHEMA_VERSION, type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability, type OwnerCapability, protectCanonicalWrite } from "../authority/capability-broker.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId, sha256 as computeSha256, bytesFor, pathInside } from "../persistence/storage-utils.js";
import type {
  ExportRequest, PacketManifest, PacketFileEntry, OmissionNotice,
  ProjectPacket, ProjectPacketInspection, PacketHashResult, PortabilityOperation
} from "./portability-types.js";

function getPortabilityOp(handle: ProjectHandle, commandId: string): PortabilityOperation | undefined {
  const row = handle.db.prepare(
    "SELECT id, command_id, kind, payload_hash, status, packet_path, created_at, updated_at FROM portability_operations WHERE command_id = ?"
  ).get(commandId) as Record<string, unknown> | undefined;
  if (!row) {return undefined;}
  return {
    id: String(row.id), commandId: String(row.command_id), kind: String(row.kind),
    payloadHash: String(row.payload_hash), status: String(row.status) as PortabilityOperation["status"],
    packetPath: row.packet_path ? String(row.packet_path) : null,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at)
  };
}

export function getPortabilityOperation(handle: ProjectHandle, commandId: string): PortabilityOperation | undefined {
  return getPortabilityOp(handle, commandId);
}

export function exportProject(
  handle: ProjectHandle,
  capability: unknown,
  request: ExportRequest
): ProjectPacket {
  // Authority: owner-only, workers denied
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

  return protectCanonicalWrite(capability, () => {
    // Check idempotency
    const existing = getPortabilityOp(handle, request.commandId);
    if (existing) {
      if (existing.payloadHash !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      if (existing.status === "complete" && existing.packetPath) {
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

    const packetDir = request.destinationPath;
    try {
      mkdirSync(packetDir, { recursive: true });

      // Copy SQLite
      const dbSrc = handle.project.databasePath;
      const dbDest = join(packetDir, "project.sqlite");
      copyFileSync(dbSrc, dbDest);
      const dbBytes = readFileSync(dbDest);
      const dbHash = computeSha256(dbBytes);

      const files: PacketFileEntry[] = [{ relativePath: "project.sqlite", sha256: dbHash }];
      const omissions: OmissionNotice[] = [];

      // Copy permitted artifacts
      const artifactRows = handle.db.prepare(
        "SELECT id, logical_id, storage_path, content_hash, access_level, content_status FROM artifact_versions ORDER BY logical_id"
      ).all() as Array<Record<string, unknown>>;

      const artifactsDir = join(packetDir, "artifacts");
      mkdirSync(artifactsDir, { recursive: true });

      for (const row of artifactRows) {
        const versionId = String(row.id);
        const storagePath = row.storage_path ? String(row.storage_path) : null;
        const contentStatus = String(row.content_status);
        const accessLevel = String(row.access_level);

        if (accessLevel === "unavailable" || contentStatus === "unavailable" || !storagePath) {
          omissions.push({ artifactVersionId: versionId, reason: "content-unavailable" });
          continue;
        }

        const srcPath = join(handle.project.artifactRoot, storagePath);
        if (!existsSync(srcPath)) {
          omissions.push({ artifactVersionId: versionId, reason: "content-missing" });
          continue;
        }

        // Check disclosure for non-local
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

        const destArtifact = join(artifactsDir, storagePath);
        mkdirSync(join(destArtifact, ".."), { recursive: true });
        copyFileSync(srcPath, destArtifact);
        const artifactBytes = readFileSync(destArtifact);
        const artifactHash = computeSha256(artifactBytes);
        files.push({ relativePath: `artifacts/${storagePath}`, sha256: artifactHash });
      }

      // Collect commitment ids (read-only, no new decisions)
      const commitmentIds: string[] = [];
      try {
        const commitmentRows = handle.db.prepare("SELECT id FROM commitments ORDER BY created_at").all() as Array<Record<string, unknown>>;
        for (const r of commitmentRows) {commitmentIds.push(String(r.id));}
      } catch { /* table may not exist in very old schemas */ }

      // Collect evidence locator ids
      const evidenceLocatorIds: string[] = [];
      try {
        const locatorRows = handle.db.prepare("SELECT id FROM source_locators ORDER BY id").all() as Array<Record<string, unknown>>;
        for (const r of locatorRows) {evidenceLocatorIds.push(String(r.id));}
      } catch { /* table may not exist */ }

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

      writeFileSync(join(packetDir, "ganesh-project-packet.json"), JSON.stringify(manifest, null, 2));

      // Mark complete
      transaction(handle.db, () => {
        handle.db.prepare(
          "UPDATE portability_operations SET status = ?, packet_path = ?, updated_at = ? WHERE id = ?"
        ).run("complete", packetDir, isoNow(), operationId);
      });

      return { manifest, packetPath: packetDir, operationId };
    } catch (error) {
      // Mark failed, clean up
      try {
        transaction(handle.db, () => {
          handle.db.prepare(
            "UPDATE portability_operations SET status = ?, updated_at = ? WHERE id = ?"
          ).run("failed", isoNow(), operationId);
        });
      } catch { /* preserve original error */ }
      try { rmSync(packetDir, { recursive: true, force: true }); } catch { /* best effort */ }
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
  const resolvedBase = resolve(basePath);
  const resolvedTarget = resolve(resolvedBase, relativePath);
  const rel = relative(resolvedBase, resolvedTarget);
  if (rel.startsWith("..") || isAbsolute(rel) || resolvedTarget === resolvedBase) {
    throw new ProjectStoreError("path-escape", `path escapes packet directory: ${relativePath}`);
  }
  return resolvedTarget;
}

export function inspectProjectPacket(packetPath: string): ProjectPacketInspection {
  const manifestPath = join(packetPath, "ganesh-project-packet.json");
  if (!existsSync(manifestPath)) {
    throw new ProjectStoreError("packet-not-found", "no ganesh-project-packet.json at the specified path");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as PacketManifest;
  const hashResults: PacketHashResult[] = [];

  for (const file of manifest.files) {
    const filePath = assertContainedRelativePath(packetPath, file.relativePath);
    if (!existsSync(filePath)) {
      hashResults.push({ relativePath: file.relativePath, expected: file.sha256, actual: null, match: false });
      continue;
    }
    const bytes = readFileSync(filePath);
    const actual = computeSha256(bytes);
    hashResults.push({ relativePath: file.relativePath, expected: file.sha256, actual, match: actual === file.sha256 });
  }

  return {
    manifest,
    hashResults,
    valid: hashResults.every((r) => r.match)
  };
}
