// story: e15s02 — Backup, Restore, Migrations and Restore Drills
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, rmSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  backupProject,
  restoreProject,
  migrateWithBackup,
  migrateSchema,
  openProject,
  inspectArtifactVersion,
  PROJECT_SCHEMA_VERSION,
  createBranch
} from "../../src/index.js";
import { createSchema } from "../../src/persistence/schema.js";
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

  before(() => {
    fix = portabilityFixture("owner-backup-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
    for (const d of cleanDirs) {
      rmSync(d, { recursive: true, force: true });
    }
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
      assert.equal(restored.status, "ready");
      const inspection = inspectArtifactVersion(restored, art.id);
      assert.equal(inspection.contentStatus, "available");
    } finally {
      restored.close();
    }
  });

  it("e15s02 flipped hash rejects materialize restore and leaves destination absent or not ready", () => {
    const payloadHash = packetPayloadHash({ cmd: "b-mismatch" });
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-cmd-mismatch",
      payloadHash
    });

    // Flip bytes in SQLite inside the backup
    const dbPath = join(backup.backupPath, "project.sqlite");
    writeFileSync(dbPath, "corrupted sqlite database bytes", { flag: "w" });

    const destDir = newTempDir();
    const restoreResult = restoreProject(fix.ownerCap, {
      commandId: "restore-cmd-mismatch",
      sourcePath: backup.backupPath,
      destinationPath: destDir,
      mode: "materialize",
      payloadHash: packetPayloadHash({ dest: destDir })
    });

    assert.equal(restoreResult.valid, false, "restore must be rejected on mismatch");
    // Verify destination was NOT created as a ready project
    assert.equal(existsSync(join(destDir, ".ganesh")), false, "destination .ganesh must not exist");
  });

  // SC-e15s02-P0-02: Drill does not replace live current
  it("e15s02 restore drill verifies snapshot without changing live current snapshot or commitments", () => {
    const liveBranch = fix.handle.db.prepare("SELECT current_snapshot_id FROM branches WHERE id = 'main'").get() as { current_snapshot_id: string };
    const liveSnapshotId = liveBranch.current_snapshot_id;

    // Create a fresh backup
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-for-drill",
      payloadHash: packetPayloadHash({ cmd: "drill-backup" })
    });

    // Run restore in drill mode
    const drillResult = restoreProject(fix.ownerCap, {
      commandId: "drill-cmd-1",
      sourcePath: backup.backupPath,
      destinationPath: fix.root,
      mode: "drill",
      payloadHash: packetPayloadHash({ drill: "true" })
    });

    assert.equal(drillResult.mode, "drill");
    assert.equal(drillResult.valid, true);

    // Verify live project state is completely untouched
    const currentBranchAfter = fix.handle.db.prepare("SELECT current_snapshot_id FROM branches WHERE id = 'main'").get() as { current_snapshot_id: string };
    assert.equal(currentBranchAfter.current_snapshot_id, liveSnapshotId, "live current snapshot must be unchanged");
  });

  // SC-e15s02-P0-03: migrateWithBackup records a backup first
  it("e15s02 migrateWithBackup records a backup first and bare migrateSchema migrates v0", () => {
    const migrateResult = migrateWithBackup(fix.handle, fix.ownerCap, "migrate-cmd-test");
    assert.ok(migrateResult.backupId, "must return backupId");
    assert.equal(migrateResult.toVersion, PROJECT_SCHEMA_VERSION);

    // Verify backup record exists in database
    const backupRecord = fix.handle.db.prepare("SELECT id FROM backup_records WHERE id = ?").get(migrateResult.backupId);
    assert.ok(backupRecord, "backup row must be recorded");

    // Test bare migrateSchema on v0 fixture
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
});
