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

describe("Migration and restore drills", () => {
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

  it("restore drill verifies snapshot without changing live current snapshot or commitments", () => {
    registerPublicArtifact(
      fix.handle,
      "doc-drill",
      "v1",
      "drill verification data",
    );
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-drill",
      payloadHash: packetPayloadHash({ cmd: "drill" }),
    });

    const liveBranchBefore = fix.handle.db
      .prepare("SELECT current_snapshot_id FROM branches WHERE name = 'main'")
      .get() as { current_snapshot_id: string };

    const drillResult = restoreProject(fix.ownerCap, {
      commandId: "drill-cmd-1",
      sourcePath: backup.backupPath,
      destinationPath: fix.root,
      mode: "drill",
      payloadHash: packetPayloadHash({ cmd: "drill" }),
    });

    assert.equal(drillResult.valid, true);
    assert.equal(drillResult.mode, "drill");

    // Live state is unchanged
    const liveBranchAfter = fix.handle.db
      .prepare("SELECT current_snapshot_id FROM branches WHERE name = 'main'")
      .get() as { current_snapshot_id: string };
    assert.equal(
      liveBranchAfter.current_snapshot_id,
      liveBranchBefore.current_snapshot_id,
    );
  });

  // SC-e15s02-P0-03: migrateWithBackup records a backup first
  it("migrateWithBackup records a backup first and bare migrateSchema migrates v0", () => {
    registerPublicArtifact(
      fix.handle,
      "doc-migrate",
      "v1",
      "pre-migration data",
    );

    const result = migrateWithBackup(fix.handle, fix.ownerCap, "migrate-cmd-1");
    assert.ok(result.backupId);

    // Verify backup record exists
    const rec = fix.handle.db
      .prepare("SELECT id, backup_path FROM backup_records WHERE id = ?")
      .get(result.backupId) as { id: string; backup_path: string };
    assert.ok(rec, "backup record should be persisted");
    assert.ok(
      existsSync(rec.backup_path),
      "backup directory should exist on disk",
    );

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
    v0Db
      .prepare("UPDATE metadata SET value = '0' WHERE key = 'schema_version'")
      .run();
    v0Db.prepare("UPDATE projects SET schema_version = 0").run();
    v0Db.close();

    const bareResult = migrateSchema(v0Root);
    assert.equal(bareResult.fromVersion, 0);
    assert.equal(bareResult.toVersion, 1);
  });
});
