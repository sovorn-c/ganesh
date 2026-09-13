// story: e16s02 — Opt-in Diagnostic Export Without Research Content
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
  readdirSync
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import {
  isOwnerCapability,
  isWorkerCapability,
  protectCanonicalWrite,
  type OwnerCapability
} from "../authority/capability-broker.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { redactDiagnostic } from "../runtime/preflight.js";
import { assertOperationsSchema, inspectDiagnostics } from "./diagnostic-store.js";
import { hasSymlinkBetween, isoNow, newId, safeChildPath } from "../persistence/storage-utils.js";
import type {
  DiagnosticBundle,
  DiagnosticBundleFileEntry,
  DiagnosticBundleHashResult,
  DiagnosticBundleInspection,
  DiagnosticBundleManifest,
  DiagnosticExportRequest
} from "./diagnostic-types.js";

export function exportDiagnostics(
  handle: ProjectHandle,
  capability: unknown,
  request: DiagnosticExportRequest
): DiagnosticBundle {
  if (isWorkerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: workers cannot export diagnostics");
  }
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "forbidden: export diagnostics requires owner capability");
  }
  const ownerCap = capability as OwnerCapability;
  if (ownerCap.ownerId !== handle.project.ownerId) {
    throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
  }

  assertWritable(handle);
  assertOperationsSchema(handle);

  if (!request || typeof request !== "object") {
    throw new ProjectStoreError("invalid-argument", "request must be an object");
  }
  if (!request.commandId || typeof request.commandId !== "string" || request.commandId.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "commandId must be a non-empty string");
  }
  if (!request.payloadHash || typeof request.payloadHash !== "string" || request.payloadHash.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "payloadHash must be a non-empty string");
  }
  if (!request.destinationPath || typeof request.destinationPath !== "string" || request.destinationPath.trim() === "") {
    throw new ProjectStoreError("invalid-argument", "destinationPath must be a non-empty string");
  }

  const bundleDir = resolve(request.destinationPath);
  if (existsSync(bundleDir)) {
    const destinationStat = lstatSync(bundleDir);
    if (destinationStat.isSymbolicLink()) {
      throw new ProjectStoreError("path-escape", "export destination cannot be a symlink");
    }
    if (!destinationStat.isDirectory()) {
      throw new ProjectStoreError("invalid-path", "export destination must be a directory");
    }
  }

  return protectCanonicalWrite(capability, () => {
    const rawDestination = request.destination ?? "local";
    const rawPurpose = request.purpose ?? (rawDestination === "local" ? "operations-diagnostics" : "");
    const destination = redactDiagnostic(String(rawDestination)).slice(0, 160);
    const purpose = redactDiagnostic(String(rawPurpose || (destination === "local" ? "operations-diagnostics" : ""))).slice(0, 160);
    const effectivePurpose = purpose || (destination === "local" ? "operations-diagnostics" : "");
    const safeCommandId = redactDiagnostic(String(request.commandId)).slice(0, 160);
    const safeCorrelationId = request.correlationId !== undefined
      ? redactDiagnostic(String(request.correlationId)).slice(0, 160)
      : undefined;

    const disclosure = requestDisclosure(handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination,
      purpose,
      optIn: request.optIn ?? false,
      payload: request.payload ?? { kind: "diagnostic", operationsOnly: true },
      actor: ownerCap.ownerId,
      correlationId: safeCorrelationId
    });

    if (disclosure.status === "deny") {
      throw new ProjectStoreError("forbidden", `forbidden: ${disclosure.reason}`);
    }

    // Check idempotency in operations_commands
    const existing = handle.db
      .prepare("SELECT * FROM operations_commands WHERE command_id = ?")
      .get(request.commandId) as Record<string, unknown> | undefined;

    if (existing) {
      if (String(existing.payload_hash) !== request.payloadHash) {
        throw new ProjectStoreError("payload-conflict", "payload-conflict: command retry with different payload");
      }
      if (existing.status === "complete" && existing.result_data) {
        try {
          const data = JSON.parse(String(existing.result_data)) as { bundlePath: string; exportId?: string };
          if (typeof data.bundlePath === "string" && resolve(data.bundlePath) === bundleDir) {
            const inspection = inspectDiagnosticBundle(data.bundlePath);
            if (inspection.valid && inspection.manifest.commandId === safeCommandId && inspection.manifest.destination === destination && inspection.manifest.purpose === effectivePurpose && inspection.manifest.correlationId === safeCorrelationId && inspection.manifest.limit === request.limit && (data.exportId === undefined || inspection.manifest.exportId === data.exportId)) {
              return {
                manifest: inspection.manifest,
                bundlePath: data.bundlePath,
                operationId: String(existing.id)
              };
            }
            if (inspection.valid) {
              throw new ProjectStoreError("payload-conflict", "payload-conflict: cached diagnostic bundle identity does not match request");
            }
          }
        } catch (error) {
          if (error instanceof ProjectStoreError && error.code === "payload-conflict") {
            throw error;
          }
          // fallback to regeneration if cached bundle invalid
        }
      }
    }

    const operationId = existing ? String(existing.id) : newId("op-cmd");
    const now = isoNow();

    if (!existing) {
      handle.db
        .prepare(
          "INSERT INTO operations_commands (id, command_id, kind, payload_hash, status, result_data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .run(operationId, request.commandId, "export-diagnostics", request.payloadHash, "pending", null, now, now);
    }

    const parentDir = dirname(bundleDir);
    mkdirSync(parentDir, { recursive: true });

    const stageId = newId("diag-stage");
    const stagingDir = join(parentDir, `.${basename(bundleDir)}.staging-${stageId}`);
    const backupDir = join(parentDir, `.${basename(bundleDir)}.backup-${stageId}`);
    const oldExists = existsSync(bundleDir);
    let swapped = false;

    try {
      mkdirSync(stagingDir, { recursive: true });

      const events = inspectDiagnostics(handle, capability, {
        correlationId: safeCorrelationId,
        limit: request.limit
      });

      const jsonlContent = events.map((e) => JSON.stringify(e)).join("\n") + (events.length > 0 ? "\n" : "");
      const jsonlPath = join(stagingDir, "events.jsonl");
      writeFileSync(jsonlPath, jsonlContent, "utf-8");

      const jsonlBytes = Buffer.byteLength(jsonlContent, "utf-8");
      const jsonlSha256 = createHash("sha256").update(Buffer.from(jsonlContent, "utf-8")).digest("hex");

      const files: DiagnosticBundleFileEntry[] = [
        {
          relativePath: "events.jsonl",
          sha256: jsonlSha256,
          bytes: jsonlBytes
        }
      ];

      const manifest: DiagnosticBundleManifest = {
        schemaVersion: 1,
        kind: "diagnostic",
        exportId: newId("diag-exp"),
        commandId: safeCommandId,
        destination,
        purpose: effectivePurpose,
        ...(safeCorrelationId === undefined ? {} : { correlationId: safeCorrelationId }),
        ...(request.limit === undefined ? {} : { limit: request.limit }),
        createdAt: isoNow(),
        files,
        omissions: [
          "Research artifacts omitted from diagnostic bundle"
        ]
      };

      writeFileSync(join(stagingDir, "ganesh-diagnostic-bundle.json"), JSON.stringify(manifest, null, 2), "utf-8");

      if (oldExists) {
        renameSync(bundleDir, backupDir);
      }
      renameSync(stagingDir, bundleDir);
      swapped = true;

      const completedAt = isoNow();
      handle.db
        .prepare("UPDATE operations_commands SET status = 'complete', result_data = ?, updated_at = ? WHERE id = ?")
        .run(JSON.stringify({ bundlePath: bundleDir, exportId: manifest.exportId }), completedAt, operationId);

      if (oldExists && existsSync(backupDir)) {
        try {
          rmSync(backupDir, { recursive: true, force: true });
        } catch { /* ignore */ }
      }

      return {
        manifest,
        bundlePath: bundleDir,
        operationId
      };
    } catch (error) {
      if (swapped) {
        try {
          if (existsSync(bundleDir)) {
            rmSync(bundleDir, { recursive: true, force: true });
          }
          if (oldExists && existsSync(backupDir)) {
            renameSync(backupDir, bundleDir);
          }
        } catch { /* ignore */ }
      } else {
        try {
          if (oldExists && existsSync(backupDir) && !existsSync(bundleDir)) {
            renameSync(backupDir, bundleDir);
          }
        } catch { /* ignore */ }
      }
      try {
        if (existsSync(stagingDir)) {
          rmSync(stagingDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
      try {
        if (existsSync(backupDir)) {
          rmSync(backupDir, { recursive: true, force: true });
        }
      } catch { /* ignore */ }
      throw error;
    }
  });
}

function bundleDirectoryFiles(resolvedPath: string, manifestPath: string): Set<string> {
  const files = new Set<string>();
  for (const entry of readdirSync(resolvedPath)) {
    const entryPath = join(resolvedPath, entry);
    const stat = lstatSync(entryPath);
    if (stat.isSymbolicLink() || hasSymlinkBetween(entryPath, resolvedPath)) {
      throw new ProjectStoreError("path-escape", "diagnostic bundle contains a symbolic link");
    }
    if (entryPath === manifestPath) { continue; }
    if (!stat.isFile()) {
      throw new ProjectStoreError("invalid-bundle", "diagnostic bundle contains an unmanifested directory or special file");
    }
    files.add(entry);
  }
  return files;
}

export function inspectDiagnosticBundle(bundlePath: string): DiagnosticBundleInspection {
  const resolvedPath = resolve(bundlePath);
  let bundleStat;
  try { bundleStat = lstatSync(resolvedPath); } catch {
    throw new ProjectStoreError("bundle-not-found", "diagnostic bundle directory does not exist");
  }
  if (bundleStat.isSymbolicLink() || !bundleStat.isDirectory()) {
    throw new ProjectStoreError("path-escape", "diagnostic bundle path must be a real directory");
  }
  const manifestPath = join(resolvedPath, "ganesh-diagnostic-bundle.json");
  let manifestStat;
  try { manifestStat = lstatSync(manifestPath); } catch {
    throw new ProjectStoreError("bundle-not-found", "no ganesh-diagnostic-bundle.json at the specified path");
  }
  if (manifestStat.isSymbolicLink() || !manifestStat.isFile() || hasSymlinkBetween(manifestPath, resolvedPath)) {
    throw new ProjectStoreError("path-escape", "diagnostic bundle manifest must be a regular file without symlink components");
  }

  let manifest: DiagnosticBundleManifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as DiagnosticBundleManifest;
  } catch (err) {
    throw new ProjectStoreError("corrupt-bundle", `malformed manifest JSON: ${(err as Error).message}`);
  }

  if (!manifest || typeof manifest !== "object") {
    throw new ProjectStoreError("corrupt-bundle", "manifest must be a JSON object");
  }

  if (manifest.kind !== "diagnostic") {
    throw new ProjectStoreError(
      "invalid-bundle-kind",
      `invalid-bundle-kind: expected "diagnostic" but found "${manifest.kind}"`
    );
  }

  if (manifest.schemaVersion !== 1) {
    throw new ProjectStoreError("unsupported-schema", `unsupported schema version: ${manifest.schemaVersion}`);
  }
  if (typeof manifest.exportId !== "string" || typeof manifest.commandId !== "string" || typeof manifest.destination !== "string" || typeof manifest.purpose !== "string" || typeof manifest.createdAt !== "string") {
    throw new ProjectStoreError("corrupt-bundle", "manifest is missing required identity fields");
  }
  if (manifest.correlationId !== undefined && typeof manifest.correlationId !== "string") {
    throw new ProjectStoreError("corrupt-bundle", "manifest correlationId must be a string");
  }
  if (manifest.limit !== undefined && (!Number.isSafeInteger(manifest.limit) || manifest.limit < 0)) {
    throw new ProjectStoreError("corrupt-bundle", "manifest limit must be a finite non-negative integer");
  }

  if (!Array.isArray(manifest.files)) {
    throw new ProjectStoreError("corrupt-bundle", "manifest must contain a files array");
  }

  const artifactsPath = join(resolvedPath, "artifacts");
  if (existsSync(artifactsPath)) {
    throw new ProjectStoreError("invalid-bundle", "diagnostic bundle must not contain an artifacts directory");
  }

  const actualFiles = bundleDirectoryFiles(resolvedPath, manifestPath);
  const listedFiles = new Set<string>();
  const hashResults: DiagnosticBundleHashResult[] = [];
  let eventCount = 0;

  for (const file of manifest.files) {
    if (!file || typeof file !== "object" || typeof file.relativePath !== "string" || typeof file.sha256 !== "string" || !Number.isSafeInteger(file.bytes) || file.bytes < 0) {
      throw new ProjectStoreError("corrupt-bundle", "manifest files must contain relativePath, sha256 and non-negative byte count");
    }
    if (file.relativePath === "ganesh-diagnostic-bundle.json" || file.relativePath.includes("\\") || file.relativePath.includes("/") || file.relativePath.split("/").some((part: string) => part === "." || part === "..") || !/^[a-f0-9]{64}$/.test(file.sha256) || listedFiles.has(file.relativePath)) {
      throw new ProjectStoreError("corrupt-bundle", "manifest contains an invalid or duplicate file entry");
    }
    listedFiles.add(file.relativePath);

    const filePath = safeChildPath(resolvedPath, file.relativePath, "bundle file");
    if (hasSymlinkBetween(filePath, resolvedPath)) {
      throw new ProjectStoreError("path-escape", "diagnostic bundle file has a symbolic link component");
    }
    if (!existsSync(filePath)) {
      hashResults.push({
        relativePath: file.relativePath,
        expected: file.sha256,
        actual: null,
        match: false
      });
      continue;
    }

    let fileStat;
    try { fileStat = lstatSync(filePath); } catch {
      hashResults.push({ relativePath: file.relativePath, expected: file.sha256, actual: null, match: false });
      continue;
    }
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      throw new ProjectStoreError("path-escape", "diagnostic bundle file must be a regular file without symlink components");
    }
    const bytes = readFileSync(filePath);
    const actual = createHash("sha256").update(bytes).digest("hex");
    const match = actual === file.sha256 && bytes.byteLength === file.bytes;
    hashResults.push({
      relativePath: file.relativePath,
      expected: file.sha256,
      actual,
      match
    });

    if (file.relativePath === "events.jsonl" && match) {
      const text = bytes.toString("utf-8");
      const lines = text.split("\n").filter((l) => l.trim().length > 0);
      eventCount = lines.length;
    }
  }

  for (const extra of actualFiles) {
    if (!listedFiles.has(extra)) {
      const bytes = readFileSync(join(resolvedPath, extra));
      hashResults.push({ relativePath: extra, expected: "", actual: createHash("sha256").update(bytes).digest("hex"), match: false });
    }
  }

  const hasEvents = manifest.files.some((f) => f && f.relativePath === "events.jsonl");
  if (!hasEvents) {
    throw new ProjectStoreError("corrupt-bundle", "manifest missing events.jsonl entry");
  }

  return {
    manifest,
    hashResults,
    valid: hashResults.length > 0 && hashResults.every((r) => r.match),
    eventCount
  };
}
