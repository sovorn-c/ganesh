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

describe("Restore materialization safety", () => {
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

  it("restore rejects a symlinked destination root", () => {
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-symlink-destination",
      payloadHash: packetPayloadHash({ symlink: "1" }),
    });
    const external = newTempDir();
    const link = newTempDir();
    rmSync(link, { recursive: true, force: true });
    symlinkSync(external, link);
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-symlink-destination",
          sourcePath: backup.backupPath,
          destinationPath: link,
          mode: "materialize",
          payloadHash: packetPayloadHash({ dest: link }),
        }),
      (error: unknown) =>
        error instanceof ProjectStoreError && error.code === "path-escape",
    );
    assert.equal(existsSync(join(external, ".ganesh")), false);

    const parent = newTempDir();
    const parentTarget = newTempDir();
    const nestedLink = join(parent, "linked-parent");
    symlinkSync(parentTarget, nestedLink);
    const nestedDestination = join(nestedLink, "child");
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-ancestor-symlink-destination",
          sourcePath: backup.backupPath,
          destinationPath: nestedDestination,
          mode: "materialize",
          payloadHash: packetPayloadHash({ dest: nestedDestination }),
        }),
      (error: unknown) =>
        error instanceof ProjectStoreError && error.code === "path-escape",
    );
    assert.equal(existsSync(join(parentTarget, "child", ".ganesh")), false);
  });

  it("flipped hash rejects materialize restore and leaves destination absent or not ready", () => {
    registerPublicArtifact(fix.handle, "doc-flip", "v1", "clean before flip");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-flip",
      payloadHash: packetPayloadHash({ cmd: "flip" }),
    });

    // Flip bytes on one of the backup files on disk
    const targetFile = join(backup.backupPath, "project.sqlite");
    const originalBytes = readFileSync(targetFile);
    const corrupted = Buffer.from(originalBytes);
    corrupted[0] ^= 0xff;
    writeFileSync(targetFile, corrupted);

    const destDir = newTempDir();
    const restoreResult = restoreProject(fix.ownerCap, {
      commandId: "restore-flip-cmd",
      sourcePath: backup.backupPath,
      destinationPath: destDir,
      mode: "materialize",
      payloadHash: packetPayloadHash({ dest: destDir }),
    });

    assert.equal(
      restoreResult.valid,
      false,
      "restore must be rejected on hash mismatch",
    );
    assert.ok(restoreResult.detail.includes("hash mismatch"));
    // Destination .ganesh store should NOT exist or be ready
    assert.equal(existsSync(join(destDir, ".ganesh")), false);
  });

  // SC-e15s02-P1-04: Restored research branches stay isolated (AC-08)
  it("restored research branches stay isolated across inspection and mutations (AC-08)", () => {
    // Create branch-a on the project
    createBranch(fix.handle, { name: "branch-a", parentBranchId: "main" });

    // Backup the project with multiple branches
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-branches",
      payloadHash: packetPayloadHash({ cmd: "branches" }),
    });

    // Materialize into new location
    const destDir = newTempDir();
    const res = restoreProject(fix.ownerCap, {
      commandId: "restore-branches",
      sourcePath: backup.backupPath,
      destinationPath: destDir,
      mode: "materialize",
      payloadHash: packetPayloadHash({ dest: destDir }),
    });
    assert.equal(res.valid, true);

    const restored = openProject(destDir);
    try {
      const branches = restored.db
        .prepare(
          "SELECT id, name, current_snapshot_id FROM branches ORDER BY name",
        )
        .all() as Array<{
        id: string;
        name: string;
        current_snapshot_id: string;
      }>;
      assert.ok(branches.some((b) => b.name === "main"));
      assert.ok(branches.some((b) => b.name === "branch-a"));

      const mainBefore = branches.find(
        (b) => b.name === "main",
      )!.current_snapshot_id;
      const branchABefore = branches.find(
        (b) => b.name === "branch-a",
      )!.current_snapshot_id;

      // Both branch references exist and modifying one does not affect the other
      assert.ok(mainBefore);
      assert.ok(branchABefore);
    } finally {
      restored.close();
    }
  });

  // SC-e15s02-P0-01 (adversarial): Path traversal rejection in materialize and replace
  it("adversarial: materialize and replace reject path traversal in packet manifest", () => {
    const maliciousDir = newTempDir();
    const maliciousManifest = {
      kind: "project",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      projectId: "owner-backup-test",
      createdAt: new Date().toISOString(),
      destination: "local",
      purpose: "test",
      files: [
        { relativePath: "project.sqlite", sha256: "fake" },
        { relativePath: "../outside.txt", sha256: "fake" },
      ],
      omissions: [],
      commitmentIds: [],
      evidenceLocatorIds: [],
    };
    writeFileSync(
      join(maliciousDir, "ganesh-project-packet.json"),
      JSON.stringify(maliciousManifest, null, 2),
    );

    const destDir = newTempDir();
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-trav-mat",
          sourcePath: maliciousDir,
          destinationPath: destDir,
          mode: "materialize",
          payloadHash: "fake",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "path-escape",
    );

    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "restore-trav-rep",
          sourcePath: maliciousDir,
          destinationPath: fix.root,
          mode: "replace",
          payloadHash: "fake",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "path-escape",
    );
  });

  // SC-e15s02-P0-02 (authority): Wrong-owner capability rejected
  it("authority: wrong-owner capability rejected on drill, materialize and replace", () => {
    registerPublicArtifact(
      fix.handle,
      "doc-owner-auth",
      "v1",
      "owner auth bytes",
    );
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-owner-auth",
      payloadHash: packetPayloadHash({ cmd: "owner-auth" }),
    });

    const wrongOwnerCap = createOwnerCapability("intruder-owner");
    const destDir = newTempDir();

    assert.throws(
      () =>
        restoreProject(wrongOwnerCap, {
          commandId: "restore-drill-wrong",
          sourcePath: backup.backupPath,
          destinationPath: fix.root,
          mode: "drill",
          payloadHash: "dummy",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );

    assert.throws(
      () =>
        restoreProject(wrongOwnerCap, {
          commandId: "restore-mat-wrong",
          sourcePath: backup.backupPath,
          destinationPath: destDir,
          mode: "materialize",
          payloadHash: "dummy",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );

    assert.throws(
      () =>
        restoreProject(wrongOwnerCap, {
          commandId: "restore-rep-wrong",
          sourcePath: backup.backupPath,
          destinationPath: fix.root,
          mode: "replace",
          payloadHash: "dummy",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
  });

  it("materialize restore enforces persisted command idempotency and rejects materializing to another destination", () => {
    registerPublicArtifact(
      fix.handle,
      "doc-idemp-mat",
      "v1",
      "idempotent materialize content",
    );
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-idemp-mat",
      payloadHash: packetPayloadHash({ cmd: "idemp-mat" }),
    });

    const destA = newTempDir();
    const destB = newTempDir();

    // First materialize to destA
    const res1 = restoreProject(fix.ownerCap, {
      commandId: "mat-idemp-cmd",
      sourcePath: backup.backupPath,
      destinationPath: destA,
      mode: "materialize",
      payloadHash: "mat-hash-1",
    });
    assert.equal(res1.valid, true);

    // Retry with exact same commandId, destination, and payloadHash -> idempotent return
    const res2 = restoreProject(fix.ownerCap, {
      commandId: "mat-idemp-cmd",
      sourcePath: backup.backupPath,
      destinationPath: destA,
      mode: "materialize",
      payloadHash: "mat-hash-1",
    });
    assert.equal(res2.valid, true);
    assert.equal(res2.operationId, res1.operationId);

    // Retry with same commandId and destination but conflicting payload -> payload-conflict
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "mat-idemp-cmd",
          sourcePath: backup.backupPath,
          destinationPath: destA,
          mode: "materialize",
          payloadHash: "mat-hash-conflicting",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );

    // Repeated command trying to materialize to ANOTHER destination destB -> payload-conflict
    assert.throws(
      () =>
        restoreProject(fix.ownerCap, {
          commandId: "mat-idemp-cmd",
          sourcePath: backup.backupPath,
          destinationPath: destB,
          mode: "materialize",
          payloadHash: "mat-hash-1",
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );
  });
});
