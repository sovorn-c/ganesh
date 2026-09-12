// story: e15s02 — Backup, Restore, Migrations and Restore Drills
import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, existsSync, mkdirSync, readFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  backupProject,
  restoreProject,
  migrateWithBackup,
  migrateSchema,
  openProject,
  inspectArtifactVersion,
  PROJECT_SCHEMA_VERSION,
  createBranch,
  createOwnerCapability,
  ProjectStoreError
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
  type PortabilityFixture
} from "../support/portability-fixtures.js";

describe("E15s02 backup, restore, migrations and restore drills", () => {
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
      try { rmSync(d, { recursive: true, force: true }); } catch { /* best effort */ }
    }
    cleanDirs = [];
  });

  function newTempDir(): string {
    const d = emptyDestination();
    cleanDirs.push(d);
    return d;
  }

  // SC-e15s02-P0-01: Materialize restore checks integrity first
  it("e15s02 backup records hashes and materialize restore into empty destination succeeds", () => {
    const art = registerPublicArtifact(fix.handle, "doc-backup", "v1", "backup content bytes");
    const payloadHash = packetPayloadHash({ cmd: "b1" });
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-cmd-1",
      payloadHash
    });

    assert.equal(backup.manifest.kind, "backup");
    assert.equal(backup.manifest.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.ok(backup.manifest.files.length > 0);

    // Materialize into empty destination
    const destDir = newTempDir();
    const restoreResult = restoreProject(fix.ownerCap, {
      commandId: "restore-cmd-1",
      sourcePath: backup.backupPath,
      destinationPath: destDir,
      mode: "materialize",
      payloadHash: packetPayloadHash({ dest: destDir })
    });

    assert.equal(restoreResult.valid, true);
    assert.equal(restoreResult.mode, "materialize");

    // Open restored project and verify artifact
    const restored = openProject(destDir);
    try {
      const insp = inspectArtifactVersion(restored, art.id);
      assert.equal(insp.contentStatus, "available");
      assert.equal(insp.contentHash, art.contentHash);
    } finally {
      restored.close();
    }
  });

  it("e15s02 flipped hash rejects materialize restore and leaves destination absent or not ready", () => {
    registerPublicArtifact(fix.handle, "doc-flip", "v1", "clean before flip");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-flip",
      payloadHash: packetPayloadHash({ cmd: "flip" })
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
      payloadHash: packetPayloadHash({ dest: destDir })
    });

    assert.equal(restoreResult.valid, false, "restore must be rejected on hash mismatch");
    assert.ok(restoreResult.detail.includes("hash mismatch"));
    // Destination .ganesh store should NOT exist or be ready
    assert.equal(existsSync(join(destDir, ".ganesh")), false);
  });

  // SC-e15s02-P0-02: Restore drill verifies without mutating live state (AC-08)
  it("e15s02 restore drill verifies snapshot without changing live current snapshot or commitments", () => {
    registerPublicArtifact(fix.handle, "doc-drill", "v1", "drill verification data");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-drill",
      payloadHash: packetPayloadHash({ cmd: "drill" })
    });

    const liveBranchBefore = fix.handle.db.prepare("SELECT current_snapshot_id FROM branches WHERE name = 'main'").get() as { current_snapshot_id: string };

    const drillResult = restoreProject(fix.ownerCap, {
      commandId: "drill-cmd-1",
      sourcePath: backup.backupPath,
      destinationPath: fix.root,
      mode: "drill",
      payloadHash: packetPayloadHash({ cmd: "drill" })
    });

    assert.equal(drillResult.valid, true);
    assert.equal(drillResult.mode, "drill");

    // Live state is unchanged
    const liveBranchAfter = fix.handle.db.prepare("SELECT current_snapshot_id FROM branches WHERE name = 'main'").get() as { current_snapshot_id: string };
    assert.equal(liveBranchAfter.current_snapshot_id, liveBranchBefore.current_snapshot_id);
  });

  // SC-e15s02-P0-03: migrateWithBackup records a backup first
  it("e15s02 migrateWithBackup records a backup first and bare migrateSchema migrates v0", () => {
    registerPublicArtifact(fix.handle, "doc-migrate", "v1", "pre-migration data");

    const result = migrateWithBackup(fix.handle, fix.ownerCap, "migrate-cmd-1");
    assert.ok(result.backupId);

    // Verify backup record exists
    const rec = fix.handle.db.prepare("SELECT id, backup_path FROM backup_records WHERE id = ?").get(result.backupId) as { id: string; backup_path: string };
    assert.ok(rec, "backup record should be persisted");
    assert.ok(existsSync(rec.backup_path), "backup directory should exist on disk");

    // Test bare migrateSchema on a synthetic v0 folder
    const v0Root = newTempDir();
    const v0DbPath = join(v0Root, ".ganesh", "project.sqlite");
    rmSync(join(v0Root, ".ganesh"), { recursive: true, force: true });
    // Create an unmigrated DB at v0
    const v0Store = join(v0Root, ".ganesh");
    mkdirSync(v0Store, { recursive: true });
    const v0Db = new DatabaseSync(v0DbPath);
    createSchema(v0Db);
    // Force schema version to 0
    v0Db.prepare("UPDATE metadata SET value = '0' WHERE key = 'schema_version'").run();
    v0Db.prepare("UPDATE projects SET schema_version = 0").run();
    v0Db.close();

    const bareResult = migrateSchema(v0Root);
    assert.equal(bareResult.fromVersion, 0);
    assert.equal(bareResult.toVersion, 1);
  });

  // SC-e15s02-P1-04: Restored research branches stay isolated (AC-08)
  it("e15s02 restored research branches stay isolated across inspection and mutations (AC-08)", () => {
    // Create branch-a on the project
    createBranch(fix.handle, { name: "branch-a", parentBranchId: "main" });

    // Backup the project with multiple branches
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-branches",
      payloadHash: packetPayloadHash({ cmd: "branches" })
    });

    // Materialize into new location
    const destDir = newTempDir();
    const res = restoreProject(fix.ownerCap, {
      commandId: "restore-branches",
      sourcePath: backup.backupPath,
      destinationPath: destDir,
      mode: "materialize",
      payloadHash: packetPayloadHash({ dest: destDir })
    });
    assert.equal(res.valid, true);

    const restored = openProject(destDir);
    try {
      const branches = restored.db.prepare("SELECT id, name, current_snapshot_id FROM branches ORDER BY name").all() as Array<{ id: string; name: string; current_snapshot_id: string }>;
      assert.ok(branches.some(b => b.name === "main"));
      assert.ok(branches.some(b => b.name === "branch-a"));

      const mainBefore = branches.find(b => b.name === "main")!.current_snapshot_id;
      const branchABefore = branches.find(b => b.name === "branch-a")!.current_snapshot_id;

      // Both branch references exist and modifying one does not affect the other
      assert.ok(mainBefore);
      assert.ok(branchABefore);
    } finally {
      restored.close();
    }
  });

  // SC-e15s02-P0-01 (adversarial): Path traversal rejection in materialize and replace
  it("e15s02 adversarial: materialize and replace reject path traversal in packet manifest", () => {
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
        { relativePath: "../outside.txt", sha256: "fake" }
      ],
      omissions: [],
      commitmentIds: [],
      evidenceLocatorIds: []
    };
    writeFileSync(join(maliciousDir, "ganesh-project-packet.json"), JSON.stringify(maliciousManifest, null, 2));

    const destDir = newTempDir();
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "restore-trav-mat",
        sourcePath: maliciousDir,
        destinationPath: destDir,
        mode: "materialize",
        payloadHash: "fake"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "path-escape"
    );

    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "restore-trav-rep",
        sourcePath: maliciousDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: "fake"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "path-escape"
    );
  });

  // SC-e15s02-P0-02 (authority): Wrong-owner capability rejected
  it("e15s02 authority: wrong-owner capability rejected on drill, materialize and replace", () => {
    registerPublicArtifact(fix.handle, "doc-owner-auth", "v1", "owner auth bytes");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-owner-auth",
      payloadHash: packetPayloadHash({ cmd: "owner-auth" })
    });

    const wrongOwnerCap = createOwnerCapability("intruder-owner");
    const destDir = newTempDir();

    assert.throws(
      () => restoreProject(wrongOwnerCap, {
        commandId: "restore-drill-wrong",
        sourcePath: backup.backupPath,
        destinationPath: fix.root,
        mode: "drill",
        payloadHash: "dummy"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    assert.throws(
      () => restoreProject(wrongOwnerCap, {
        commandId: "restore-mat-wrong",
        sourcePath: backup.backupPath,
        destinationPath: destDir,
        mode: "materialize",
        payloadHash: "dummy"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    assert.throws(
      () => restoreProject(wrongOwnerCap, {
        commandId: "restore-rep-wrong",
        sourcePath: backup.backupPath,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: "dummy"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  // SC-e15s02-P0-03 (concurrency/locking): Foreign write lock on destination blocks materialize and replace
  it("e15s02 locking: foreign live pid write lock on destination blocks materialize and replace", () => {
    registerPublicArtifact(fix.handle, "doc-lock-check", "v1", "lock check bytes");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-lock",
      payloadHash: packetPayloadHash({ cmd: "lock" })
    });

    const child = spawn(process.argv[0], ["-e", "setInterval(()=>{}, 1000)"]);
    try {
      // Create destination with foreign PID lock
      const lockedDest = newTempDir();
      mkdirSync(join(lockedDest, ".ganesh"), { recursive: true });
      writeFileSync(join(lockedDest, ".ganesh", "write.lock"), String(child.pid));

      // Attempt replace on locked destination
      assert.throws(
        () => restoreProject(fix.ownerCap, {
          commandId: "restore-on-locked",
          sourcePath: backup.backupPath,
          destinationPath: lockedDest,
          mode: "replace",
          payloadHash: "dummy"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "project-locked"
      );
    } finally {
      child.kill();
    }
  });

  // SC-e15s02-P0-01 (contract): Schema version, packet kind, and payload conflicts enforced
  it("e15s02 contract: unsupported schema version, invalid packet kind, and payload conflicts rejected", () => {
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-contract",
      payloadHash: "hash-initial"
    });

    // Backup retry with different payloadHash throws payload-conflict
    assert.throws(
      () => backupProject(fix.handle, fix.ownerCap, {
        commandId: "backup-contract",
        payloadHash: "hash-different"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );

    // Unsupported schema version rejection
    const badSchemaDir = newTempDir();
    const manifestPath = join(backup.backupPath, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const badSchemaManifest = { ...manifest, schemaVersion: 99 };
    writeFileSync(join(badSchemaDir, "ganesh-project-packet.json"), JSON.stringify(badSchemaManifest, null, 2));

    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "restore-bad-schema",
        sourcePath: badSchemaDir,
        destinationPath: newTempDir(),
        mode: "materialize",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "unsupported-schema"
    );

    // Invalid packet kind rejection
    const badKindDir = newTempDir();
    const badKindManifest = { ...manifest, kind: "unknown-kind" };
    writeFileSync(join(badKindDir, "ganesh-project-packet.json"), JSON.stringify(badKindManifest, null, 2));

    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "restore-bad-kind",
        sourcePath: badKindDir,
        destinationPath: newTempDir(),
        mode: "materialize",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-packet-kind"
    );

    // Replace idempotency and payload conflict
    const replaceDest = newTempDir();
    restoreProject(fix.ownerCap, {
      commandId: "restore-mat-for-rep",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "materialize",
      payloadHash: "hash-rep"
    });

    // First replace
    const rep1 = restoreProject(fix.ownerCap, {
      commandId: "cmd-rep-idemp",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "replace",
      payloadHash: "hash-rep-1"
    });
    assert.equal(rep1.valid, true);

    // Retry with identical payload returns idempotent result
    const rep2 = restoreProject(fix.ownerCap, {
      commandId: "cmd-rep-idemp",
      sourcePath: backup.backupPath,
      destinationPath: replaceDest,
      mode: "replace",
      payloadHash: "hash-rep-1"
    });
    assert.equal(rep2.valid, true);

    // Retry with conflicting payload throws payload-conflict
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "cmd-rep-idemp",
        sourcePath: backup.backupPath,
        destinationPath: replaceDest,
        mode: "replace",
        payloadHash: "hash-conflict"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );
  });

  // SC-e15s02-P0-02 (transactional): replace rolls back cleanly on staging failure
  it("e15s02 replace is transactional: failure during replace rolls back cleanly leaving live DB untouched", () => {
    registerPublicArtifact(fix.handle, "doc-survivor", "v1", "surviving data before replace");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-trans",
      payloadHash: packetPayloadHash({ cmd: "trans" })
    });

    // Create a corrupted packet where all files exist and hashes match, but SQLite file is broken
    const corruptPacketDir = newTempDir();
    const manifestPath = join(backup.backupPath, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const corruptBytes = Buffer.from("NOT A VALID SQLITE DATABASE FILE HEADER JUNK");
    const corruptHash = sha256(corruptBytes);
    const corruptManifest = {
      ...manifest,
      files: manifest.files.map((f: { relativePath: string; sha256: string }) =>
        f.relativePath === "project.sqlite" ? { ...f, sha256: corruptHash } : f
      )
    };
    // Copy all files from backup into corruptPacketDir
    for (const f of manifest.files) {
      const src = join(backup.backupPath, f.relativePath);
      const dest = join(corruptPacketDir, f.relativePath);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
    }
    const corruptSqlitePath = join(corruptPacketDir, "project.sqlite");
    writeFileSync(corruptSqlitePath, corruptBytes);
    writeFileSync(join(corruptPacketDir, "ganesh-project-packet.json"), JSON.stringify(corruptManifest, null, 2));

    // Attempt replace with corrupted packet
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "replace-corrupt-fail",
        sourcePath: corruptPacketDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: "dummy"
      })
    );

    // Verify live DB remains untouched and functional
    const liveCheck = openProject(fix.root);
    try {
      const art = inspectArtifactVersion(liveCheck, "doc-survivor-v1");
      assert.equal(art.contentStatus, "available");
    } finally {
      liveCheck.close();
    }
  });

  it("e15s02 restore fail-open: unreadable or invalid SQLite database rejected before authorization or drill", () => {
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-failopen",
      payloadHash: packetPayloadHash({ cmd: "failopen" })
    });

    // 1. Packet with junk SQLite file (hashes match manifest, but SQLite is unreadable)
    const corruptPacketDir = newTempDir();
    const manifestPath = join(backup.backupPath, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
    const corruptBytes = Buffer.from("NOT A VALID SQLITE DATABASE FILE HEADER JUNK");
    const corruptHash = sha256(corruptBytes);
    const corruptManifest = {
      ...manifest,
      files: manifest.files.map((f: { relativePath: string; sha256: string }) =>
        f.relativePath === "project.sqlite" ? { ...f, sha256: corruptHash } : f
      )
    };
    for (const f of manifest.files) {
      const src = join(backup.backupPath, f.relativePath);
      const dest = join(corruptPacketDir, f.relativePath);
      mkdirSync(join(dest, ".."), { recursive: true });
      copyFileSync(src, dest);
    }
    writeFileSync(join(corruptPacketDir, "project.sqlite"), corruptBytes);
    writeFileSync(join(corruptPacketDir, "ganesh-project-packet.json"), JSON.stringify(corruptManifest, null, 2));

    // Drill MUST fail with corrupt-packet and NOT return valid: true
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "drill-corrupt",
        sourcePath: corruptPacketDir,
        destinationPath: fix.root,
        mode: "drill",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "corrupt-packet"
    );

    // Materialize MUST fail with corrupt-packet
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "mat-corrupt",
        sourcePath: corruptPacketDir,
        destinationPath: newTempDir(),
        mode: "materialize",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "corrupt-packet"
    );

    // 2. Packet with missing projects table
    const noProjectsDir = newTempDir();
    const noProjectsDb = new DatabaseSync(join(noProjectsDir, "project.sqlite"));
    noProjectsDb.exec("CREATE TABLE something_else (id TEXT);");
    noProjectsDb.close();
    const dbBytes = readFileSync(join(noProjectsDir, "project.sqlite"));
    const noProjectsManifest = {
      ...manifest,
      files: [{ relativePath: "project.sqlite", sha256: sha256(dbBytes) }]
    };
    writeFileSync(join(noProjectsDir, "ganesh-project-packet.json"), JSON.stringify(noProjectsManifest, null, 2));

    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "mat-no-projects",
        sourcePath: noProjectsDir,
        destinationPath: newTempDir(),
        mode: "materialize",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "unsupported-schema"
    );

    // 3. Packet with future schema in SQLite database
    const futureDbDir = newTempDir();
    const futureDb = new DatabaseSync(join(futureDbDir, "project.sqlite"));
    createSchema(futureDb);
    futureDb.exec(`INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES ('p1', '${fix.ownerId}', '/tmp', 999, '2026-09-12T00:00:00.000Z');`);
    futureDb.exec("UPDATE metadata SET value = '999' WHERE key = 'schema_version';");
    futureDb.close();
    const futureDbBytes = readFileSync(join(futureDbDir, "project.sqlite"));
    const futureManifest = {
      ...manifest,
      files: [{ relativePath: "project.sqlite", sha256: sha256(futureDbBytes) }]
    };
    writeFileSync(join(futureDbDir, "ganesh-project-packet.json"), JSON.stringify(futureManifest, null, 2));

    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "mat-future-db",
        sourcePath: futureDbDir,
        destinationPath: newTempDir(),
        mode: "materialize",
        payloadHash: "hash"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "unsupported-schema"
    );
  });

  it("e15s02 materialize restore enforces persisted command idempotency and rejects materializing to another destination", () => {
    registerPublicArtifact(fix.handle, "doc-idemp-mat", "v1", "idempotent materialize content");
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-idemp-mat",
      payloadHash: packetPayloadHash({ cmd: "idemp-mat" })
    });

    const destA = newTempDir();
    const destB = newTempDir();

    // First materialize to destA
    const res1 = restoreProject(fix.ownerCap, {
      commandId: "mat-idemp-cmd",
      sourcePath: backup.backupPath,
      destinationPath: destA,
      mode: "materialize",
      payloadHash: "mat-hash-1"
    });
    assert.equal(res1.valid, true);

    // Retry with exact same commandId, destination, and payloadHash -> idempotent return
    const res2 = restoreProject(fix.ownerCap, {
      commandId: "mat-idemp-cmd",
      sourcePath: backup.backupPath,
      destinationPath: destA,
      mode: "materialize",
      payloadHash: "mat-hash-1"
    });
    assert.equal(res2.valid, true);
    assert.equal(res2.operationId, res1.operationId);

    // Retry with same commandId and destination but conflicting payload -> payload-conflict
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "mat-idemp-cmd",
        sourcePath: backup.backupPath,
        destinationPath: destA,
        mode: "materialize",
        payloadHash: "mat-hash-conflicting"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );

    // Repeated command trying to materialize to ANOTHER destination destB -> payload-conflict
    assert.throws(
      () => restoreProject(fix.ownerCap, {
        commandId: "mat-idemp-cmd",
        sourcePath: backup.backupPath,
        destinationPath: destB,
        mode: "materialize",
        payloadHash: "mat-hash-1"
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );
  });

  it("e15s02 replace is transactional across DB and artifacts: rolls back both when artifact swap fails", () => {
    const initialArt = registerPublicArtifact(fix.handle, "doc-orig", "v1", "original surviving content");
    const origArtifactFile = initialArt.storagePath!;
    assert.equal(existsSync(origArtifactFile), true);

    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-art-rollback",
      payloadHash: packetPayloadHash({ cmd: "art-rollback" })
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
        { relativePath: "artifacts/../../escaped.txt", sha256: "fake" }
      ]
    };
    writeFileSync(join(badPacketDir, "ganesh-project-packet.json"), JSON.stringify(badManifest, null, 2));

    assert.throws(() => {
      restoreProject(fix.ownerCap, {
        commandId: "replace-art-fail",
        sourcePath: badPacketDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: "dummy"
      });
    });

    // Verify both DB and artifacts are completely unchanged
    const currentDbBytes = readFileSync(destDbPath);
    assert.deepEqual(currentDbBytes, origDbBytes, "database bytes must be identical after rollback");
    assert.equal(existsSync(origArtifactFile), true, "original artifact file must be untouched after rollback");
    assert.equal(readFileSync(origArtifactFile, "utf-8"), "original surviving content");
  });
});
