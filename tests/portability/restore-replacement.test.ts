// story: e15s02 — Backup, Restore, Migrations and Restore Drills
import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  rmSync,
  existsSync,
  mkdirSync,
  readFileSync,
  copyFileSync,
  unlinkSync,
  symlinkSync,
} from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  backupProject,
  restoreProject,
  migrateWithBackup,
  migrateSchema,
  openProject,
  createProject,
  inspectArtifactVersion,
  PROJECT_SCHEMA_VERSION,
  createBranch,
  createOwnerCapability,
  ProjectStoreError,
} from "../../src/index.js";
import { _clearPortabilityRegistryForTests } from "../../src/portability/restore-store.js";
import { createSchema } from "../../src/persistence/schema.js";
import { sha256 } from "../../src/persistence/storage-utils.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  packetPayloadHash,
  emptyDestination,
  type PortabilityFixture,
} from "../support/portability-fixtures.js";

describe("Transactional restore replacement", () => {
  let fix: PortabilityFixture;
  let cleanDirs: string[] = [];

  beforeEach(() => {
    _clearPortabilityRegistryForTests();
    fix = portabilityFixture("owner-backup-test");
  });

  afterEach(() => {
    _clearPortabilityRegistryForTests();
    disposePortabilityFixture(fix);
    for (const d of cleanDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        /* best effort */
      }
    }
    cleanDirs = [];
  });

  function newTempDir(): string {
    const d = emptyDestination();
    cleanDirs.push(d);
    return d;
  }

  // SC-e15s02-P0-02: Restore drill verifies without mutating live state (AC-08)
  it("same-root replace preserves the backup used as its source", () => {
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-same-root-source",
      payloadHash: packetPayloadHash({ sameRoot: "1" }),
    });
    const result = restoreProject(fix.ownerCap, {
      commandId: "replace-same-root-source",
      sourcePath: backup.backupPath,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ sameRoot: "replace" }),
    });
    assert.equal(result.valid, true);
    assert.equal(
      existsSync(join(backup.backupPath, "ganesh-project-packet.json")),
      true,
    );
    assert.throws(
      () => createBranch(fix.handle, { name: "must-reopen-after-replace" }),
      (error: unknown) =>
        error instanceof ProjectStoreError && error.code === "project-locked",
    );
  });

  // SC-e15s02-P0-01 (contract): Schema version, packet kind, and payload conflicts enforced
  it("contract: unsupported schema version, invalid packet kind, and payload conflicts rejected", () => {
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-contract",
      payloadHash: "hash-initial",
    });

    // Backup retry with different payloadHash throws payload-conflict
    assert.throws(
      () =>
        backupProject(fix.handle, fix.ownerCap, {
          commandId: "backup-contract",
          payloadHash: "hash-different",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );

    // Unsupported schema version rejection
    const badSchemaDir = newTempDir();
    const manifestPath = join(backup.backupPath, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const badSchemaManifest = { ...manifest, schemaVersion: 99 };
    writeFileSync(
      join(badSchemaDir, "ganesh-project-packet.json"),
      JSON.stringify(badSchemaManifest, null, 2),
    );

    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-bad-schema",
          sourcePath: badSchemaDir,
          destinationPath: newTempDir(),
          mode: "materialize",
          payloadHash: "hash",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "unsupported-schema",
    );

    // Invalid packet kind rejection
    const badKindDir = newTempDir();
    const badKindManifest = { ...manifest, kind: "unknown-kind" };
    writeFileSync(
      join(badKindDir, "ganesh-project-packet.json"),
      JSON.stringify(badKindManifest, null, 2),
    );

    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-bad-kind",
          sourcePath: badKindDir,
          destinationPath: newTempDir(),
          mode: "materialize",
          payloadHash: "hash",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "invalid-packet-kind",
    );

    // Replace idempotency and payload conflict
    const replaceDest = newTempDir();
    restoreProject(fix.ownerCap, {
      commandId: "restore-mat-for-rep",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "materialize",
      payloadHash: "hash-rep",
    });

    // First replace
    const rep1 = restoreProject(fix.ownerCap, {
      commandId: "cmd-rep-idemp",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "replace",
      payloadHash: "hash-rep-1",
    });
    assert.equal(rep1.valid, true);

    // Retry with identical payload returns idempotent result
    const rep2 = restoreProject(fix.ownerCap, {
      commandId: "cmd-rep-idemp",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "replace",
      payloadHash: "hash-rep-1",
    });
    assert.equal(rep2.valid, true);

    // Retry with conflicting payload throws payload-conflict
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "cmd-rep-idemp",
          sourcePath: backup.backupPath,
          destinationPath: replaceDest,
          mode: "replace",
          payloadHash: "hash-conflict",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );
  });

  it("replace is transactional across DB and artifacts: rolls back both when artifact swap fails", () => {
    const initialArt = registerPublicArtifact(
      fix.handle,
      "doc-orig",
      "v1",
      "original surviving content",
    );
    const origArtifactFile = initialArt.storagePath!;
    assert.equal(existsSync(origArtifactFile), true);

    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-art-rollback",
      payloadHash: packetPayloadHash({ cmd: "art-rollback" }),
    });

    const destDbPath = join(fix.root, ".ganesh", "project.sqlite");
    const origDbBytes = readFileSync(destDbPath);

    // Create a bad packet that fails during transactional stage validate/swap
    const badPacketDir = newTempDir();
    const manifestPath = join(backup.backupPath, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    // Add an artifact that escapes containment
    const badManifest = {
      ...manifest,
      files: [
        ...manifest.files,
        { relativePath: "artifacts/../../escaped.txt", sha256: "fake" },
      ],
    };
    writeFileSync(
      join(badPacketDir, "ganesh-project-packet.json"),
      JSON.stringify(badManifest, null, 2),
    );

    assert.throws(() => {
      restoreProject(fix.ownerCap, {
        commandId: "replace-art-fail",
        sourcePath: badPacketDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: "dummy",
      });
    });

    // Verify both DB and artifacts are completely unchanged
    const currentDbBytes = readFileSync(destDbPath);
    assert.deepEqual(
      currentDbBytes,
      origDbBytes,
      "database bytes must be identical after rollback",
    );
    assert.equal(
      existsSync(origArtifactFile),
      true,
      "original artifact file must be untouched after rollback",
    );
    assert.equal(
      readFileSync(origArtifactFile, "utf-8"),
      "original surviving content",
    );
  });
});
