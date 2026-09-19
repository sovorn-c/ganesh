import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import {
  openProject,
  assertWritable,
  backupProject,
  ProjectStoreError,
  runProductLifecycle
} from "../../src/index.js";
import { buildPackageArtifact } from "../../src/distribution/package-artifact.js";
import { createTempPrefix } from "../support/distribution-fixtures.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact
} from "../support/portability-fixtures.js";
import { _clearPortabilityRegistryForTests } from "../../src/portability/restore-store.js";

test("e18s03 SC-e18s03-P0-01 upgrade packed CLI and reopen project with schema supported and research-data intact", async () => {
  const tempPrefix = createTempPrefix("dist-upgrade-prefix-");
  const fix = portabilityFixture("owner-upgrade-test");

  try {
    registerPublicArtifact(
      fix.handle,
      "dataset-v1",
      "1.0",
      "Important research data content that must stay intact across CLI upgrades."
    );

    const packResult = await buildPackageArtifact(process.cwd(), { destination: tempPrefix.dir });
    assert.equal(packResult.status, "pass");

    // Close project handle before lifecycle upgrade
    fix.handle.close();

    const report = await runProductLifecycle({
      action: "upgrade",
      prefix: tempPrefix.dir,
      projectFolder: fix.root,
      tarballPath: packResult.tarballPath
    });

    assert.equal(report.status, "pass");
    assert.equal(report.schemaStatus, "supported");
    assert.equal(report.artifactHashMatches, true);
    assert.equal(report.projectPreserved, true);
    assert.equal(report.reopened, true);

    const reopenedHandle = openProject(fix.root);
    assert.equal(reopenedHandle.status, "ready");
    assert.equal(reopenedHandle.writable, true);
    assertWritable(reopenedHandle);
    reopenedHandle.close();
  } finally {
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
});

test("e18s03 SC-e18s03-P0-02 uninstall removes product from prefix and preserves .ganesh without deletion not-e15", async () => {
  const tempPrefix = createTempPrefix("dist-uninstall-prefix-");
  const fix = portabilityFixture("owner-uninstall-test");

  try {
    registerPublicArtifact(
      fix.handle,
      "study-notes",
      "1.0",
      "Research notes that must never be deleted by product uninstall."
    );

    const packResult = await buildPackageArtifact(process.cwd(), { destination: tempPrefix.dir });
    assert.equal(packResult.status, "pass");

    // Install package into prefix first
    const installRes = spawnSync(
      "npm",
      ["install", packResult.tarballPath, "--prefix", tempPrefix.dir, "--no-audit", "--no-fund"],
      { cwd: tempPrefix.dir, encoding: "utf8" }
    );
    assert.equal(installRes.status, 0);

    const installedPackageDir = path.join(tempPrefix.dir, "node_modules", "ganesh");
    assert.ok(fs.existsSync(installedPackageDir));

    fix.handle.close();

    const report = await runProductLifecycle({
      action: "uninstall",
      prefix: tempPrefix.dir,
      projectFolder: fix.root
    });

    assert.equal(report.status, "pass");
    assert.equal(report.uninstalledFromPrefix, true);
    assert.equal(report.projectPreserved, true);
    assert.equal(report.artifactsPreserved, true);
    assert.equal(report.e15DeletionRecorded, false);

    assert.equal(fs.existsSync(installedPackageDir), false);
    assert.equal(fs.existsSync(path.join(tempPrefix.dir, "bin", "ganesh")), false);

    const dbPath = path.join(fix.root, ".ganesh", "project.sqlite");
    assert.ok(fs.existsSync(dbPath));
    const artifactsDir = path.join(fix.root, ".ganesh", "artifacts");
    assert.ok(fs.existsSync(artifactsDir));

    const checkDb = new DatabaseSync(dbPath, { readOnly: true });
    try {
      const tombstones = checkDb.prepare("SELECT count(*) as c FROM evidence_tombstones").get() as { c: number };
      assert.equal(tombstones.c, 0);
      const deletions = checkDb.prepare("SELECT count(*) as c FROM deletion_events").get() as { c: number };
      assert.equal(deletions.c, 0);
    } finally {
      checkDb.close();
    }
  } finally {
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
});

test("e18s03 SC-e18s03-P0-03 rollback uses E15 backup restore without second engine", async () => {
  _clearPortabilityRegistryForTests();
  const tempPrefix = createTempPrefix("dist-rollback-prefix-");
  const fix = portabilityFixture("owner-rollback-test");

  try {
    registerPublicArtifact(
      fix.handle,
      "rollback-evidence",
      "1.0",
      "Evidence preserved before rollback."
    );

    const packResult = await buildPackageArtifact(process.cwd(), { destination: tempPrefix.dir });
    assert.equal(packResult.status, "pass");

    const snapshot = backupProject(fix.handle, fix.ownerCap, {
      commandId: "cmd-rollback-backup-01",
      payloadHash: "hash-01"
    });
    assert.ok(fs.existsSync(snapshot.backupPath));

    fix.handle.close();

    const report = await runProductLifecycle({
      action: "rollback-check",
      prefix: tempPrefix.dir,
      projectFolder: fix.root,
      backupPath: snapshot.backupPath,
      previousTarballPath: packResult.tarballPath,
      ownerCapability: fix.ownerCap,
      commandId: "cmd-rollback-restore-01"
    });

    assert.equal(report.status, "pass");
    assert.equal(report.rollbackEngine, "e15");
    assert.equal(report.reopened, true);

    const reopenedHandle = openProject(fix.root);
    assert.equal(reopenedHandle.status, "ready");
    assert.equal(reopenedHandle.writable, true);
    reopenedHandle.close();
  } finally {
    _clearPortabilityRegistryForTests();
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
});

test("e18s03 SC-e18s03-P1-04 unknown-future schema stays honest and blocks migration or mutation", async () => {
  const tempPrefix = createTempPrefix("dist-future-prefix-");
  const fix = portabilityFixture("owner-future-test");

  try {
    fix.handle.close();

    const dbPath = path.join(fix.root, ".ganesh", "project.sqlite");
    const modDb = new DatabaseSync(dbPath);
    try {
      modDb.exec("PRAGMA user_version = 99;");
      modDb.prepare("UPDATE projects SET schema_version = 99").run();
      modDb.prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES ('schema_version', '99')").run();
    } finally {
      modDb.close();
    }

    const futureHandle = openProject(fix.root);
    assert.equal(futureHandle.status, "unknown-future");
    assert.equal(futureHandle.writable, false);

    assert.throws(
      () => {
        assertWritable(futureHandle);
      },
      (err: unknown) => {
        return err instanceof ProjectStoreError && err.code === "read-only";
      }
    );

    futureHandle.close();

    const packResult = await buildPackageArtifact(process.cwd(), { destination: tempPrefix.dir });
    const installRes = spawnSync(
      "npm",
      ["install", packResult.tarballPath, "--prefix", tempPrefix.dir, "--no-audit", "--no-fund"],
      { cwd: tempPrefix.dir, encoding: "utf8" }
    );
    assert.equal(installRes.status, 0);

    const cliPath = path.join(tempPrefix.dir, "node_modules", "ganesh", "dist", "src", "cli.js");
    const launchResult = spawnSync(process.execPath, [cliPath, "--print-launch", fix.root], {
      cwd: tempPrefix.dir,
      encoding: "utf8"
    });

    assert.notEqual(launchResult.status, 0);
    const combinedOutput = `${launchResult.stdout ?? ""}${launchResult.stderr ?? ""}`;
    assert.ok(combinedOutput.includes("unknown-future") || combinedOutput.includes("invalid-project"));
  } finally {
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore cleanup
    }
  }
});

test("e18s03 rejects unsafe lifecycle prefix", async () => {
  await assert.rejects(
    async () => {
      await runProductLifecycle({
        action: "upgrade",
        prefix: "/",
        projectFolder: "/tmp"
      });
    },
    /isolated prefix/i
  );
});

test("e18s03 rejects lifecycle prefix symlinked to /usr (CWE-59)", async () => {
  const tempPrefix = createTempPrefix("lifecycle-symlink-");
  try {
    const symlinkPath = path.join(tempPrefix.dir, "symlink-usr");
    try {
      fs.symlinkSync("/usr", symlinkPath);
    } catch {
      return;
    }
    await assert.rejects(
      async () => {
        await runProductLifecycle({
          action: "upgrade",
          prefix: symlinkPath,
          projectFolder: "/tmp"
        });
      },
      /isolated prefix|rejected (unsafe|system) prefix/i
    );
  } finally {
    tempPrefix.cleanup();
  }
});

test("e18s03 upgrade fails when tarballPath is missing or nonexistent", async () => {
  const tempPrefix = createTempPrefix("lifecycle-missing-tarball-");
  const fix = portabilityFixture("owner-upgrade-fail-test");
  try {
    fix.handle.close();
    // Case 1: missing tarballPath
    const report = await runProductLifecycle({
      action: "upgrade",
      prefix: tempPrefix.dir,
      projectFolder: fix.root
      // No tarballPath supplied!
    });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons?.some((r) => r.includes("tarballPath")),
      "must record missing tarballPath failure"
    );

    // Case 2: nonexistent tarballPath
    const reportNonexistent = await runProductLifecycle({
      action: "upgrade",
      prefix: tempPrefix.dir,
      projectFolder: fix.root,
      tarballPath: path.join(tempPrefix.dir, "nonexistent-tarball.tgz")
    });
    assert.equal(reportNonexistent.status, "fail");
    assert.ok(
      reportNonexistent.reasons?.some((r) => r.includes("tarballPath") || r.includes("nonexistent")),
      "must record nonexistent tarballPath failure"
    );
  } finally {
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

test("e18s03 rollback fails when backupPath or ownerCapability is missing", async () => {
  const tempPrefix = createTempPrefix("lifecycle-rollback-fail-test-");
  const fix = portabilityFixture("owner-rollback-fail-test");
  try {
    fix.handle.close();
    // Case 1: no backupPath
    const reportNoBackup = await runProductLifecycle({
      action: "rollback-check",
      prefix: tempPrefix.dir,
      projectFolder: fix.root,
      ownerCapability: fix.ownerCap
    });
    assert.equal(reportNoBackup.status, "fail");
    assert.ok(
      reportNoBackup.reasons?.some((r) => r.includes("backupPath")),
      "must record missing backupPath failure"
    );

    // Case 2: no ownerCapability
    const reportNoCap = await runProductLifecycle({
      action: "rollback-check",
      prefix: tempPrefix.dir,
      projectFolder: fix.root,
      backupPath: "/tmp/nonexistent-backup.json"
    });
    assert.equal(reportNoCap.status, "fail");
    assert.ok(
      reportNoCap.reasons?.some((r) => r.includes("ownerCapability") || r.includes("backupPath")),
      "must record missing ownerCapability failure"
    );
  } finally {
    tempPrefix.cleanup();
    try {
      fs.rmSync(fix.root, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});
