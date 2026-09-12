// story: e15s03 — Crash, Disk-Full, Corruption and Concurrent-Launch Hardening
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, readFileSync, rmSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";
import {
  openProject,
  createProject,
  registerArtifactVersion,
  inspectArtifactVersion,
  recoverProject,
  ProjectStoreError
} from "../../src/index.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  emptyDestination,
  type PortabilityFixture
} from "../support/portability-fixtures.js";

describe("E15s03 crash, disk-full, corruption, and concurrent-launch hardening", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-crash-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  // SC-e15s03-P0-01: Crash recovers to a complete state (AC-17)
  it("e15s03 crash interrupted write before finalize leaves previous complete state (AC-17)", () => {
    const v1 = registerPublicArtifact(fix.handle, "crash-doc", "v1", "initial complete content");
    assert.equal(inspectArtifactVersion(fix.handle, v1.id).contentStatus, "available");

    // Injected crash before finalize
    assert.throws(
      () => {
        registerArtifactVersion(fix.handle, {
          logicalId: "crash-doc",
          version: "v2",
          versionId: "crash-doc-v2",
          content: "half-baked content",
          failAt: "before-finalize"
        });
      },
      (error: unknown) => error instanceof ProjectStoreError && error.code === "registration-failed"
    );

    // Reopen and recoverProject
    const recovery = recoverProject(fix.root);
    assert.equal(recovery.status, "ready");

    // Reopening exposes only complete state
    const reopened = openProject(fix.root);
    try {
      assert.equal(inspectArtifactVersion(reopened, v1.id).contentStatus, "available");
      assert.throws(
        () => inspectArtifactVersion(reopened, "crash-doc-v2"),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "artifact-not-found"
      );
    } finally {
      reopened.close();
    }
  });

  it("e15s03 crash half-registered artifact cleaned up and never treated as current", () => {
    assert.throws(
      () => {
        registerArtifactVersion(fix.handle, {
          logicalId: "half-doc",
          version: "v1",
          versionId: "half-doc-v1",
          content: "will fail after finalize",
          failAt: "after-finalize-before-register"
        });
      },
      (error: unknown) => error instanceof ProjectStoreError && error.code === "registration-failed"
    );

    const recovery = recoverProject(fix.root);
    assert.equal(recovery.status, "ready");

    const reopened = openProject(fix.root);
    try {
      assert.throws(
        () => inspectArtifactVersion(reopened, "half-doc-v1"),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "artifact-not-found"
      );
    } finally {
      reopened.close();
    }
  });

  // SC-e15s03-P0-02: Disk-full does not commit a new current
  it("e15s03 disk-full aborts with ENOSPC and leaves no new current reference", () => {
    let thrownError: unknown;
    try {
      registerArtifactVersion(fix.handle, {
        logicalId: "enospc-doc",
        version: "v1",
        versionId: "enospc-doc-v1",
        content: "content on full disk",
        failAt: "disk-full"
      });
    } catch (error) {
      thrownError = error;
    }

    assert.ok(thrownError, "should throw on disk-full");
    assert.equal((thrownError as Record<string, unknown>).code, "ENOSPC");

    // Verify no new artifact version was recorded
    assert.throws(
      () => inspectArtifactVersion(fix.handle, "enospc-doc-v1"),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "artifact-not-found"
    );

    // Verify failed recovery checkpoint is inspectable
    const checkpoint = fix.handle.db.prepare(
      "SELECT id, operation, stage, status, details FROM recovery_checkpoints WHERE operation = 'artifact-registration' AND status = 'failed' ORDER BY created_at DESC LIMIT 1"
    ).get() as Record<string, unknown> | undefined;

    assert.ok(checkpoint, "a failed recovery checkpoint must be inspectable");
    assert.equal(checkpoint.status, "failed");
    assert.ok(String(checkpoint.details).includes("ENOSPC"));
  });

  // SC-e15s03-P0-03: Foreign live pid is blocked, reentry allowed
  it("e15s03 same-process reentry lock allows multiple open handles", () => {
    const handle2 = openProject(fix.root);
    try {
      assert.equal(handle2.writable, true);
      assert.equal(handle2.status, "ready");
    } finally {
      handle2.close();
    }
  });

  it("e15s03 foreign live pid write lock denies second process writable open", () => {
    const freshRoot = emptyDestination();
    try {
      const freshHandle = createProject({ rootPath: freshRoot, ownerId: "owner-fresh" });
      freshHandle.close(); // Closed so activeLocks is clean

      const lockFilePath = join(freshRoot, ".ganesh", "write.lock");
      // Write PID of parent process which is alive and not process.pid
      const foreignLivePid = process.ppid;
      writeFileSync(lockFilePath, String(foreignLivePid), "utf-8");

      // Second writable open should be denied
      assert.throws(
        () => openProject(freshRoot),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "project-locked"
      );

      // Read-only open should still succeed
      const roHandle = openProject(freshRoot, { readOnly: true });
      try {
        assert.equal(roHandle.writable, false);
      } finally {
        roHandle.close();
      }
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it("e15s03 dead pid lock is stolen by next writable open", () => {
    const freshRoot = emptyDestination();
    try {
      const freshHandle = createProject({ rootPath: freshRoot, ownerId: "owner-fresh" });
      freshHandle.close(); // Closed so activeLocks is clean

      const lockFilePath = join(freshRoot, ".ganesh", "write.lock");
      // Write dead PID (e.g. 9999999)
      writeFileSync(lockFilePath, "9999999", "utf-8");

      // Open should steal the lock and succeed
      const handle = openProject(freshRoot);
      try {
        assert.equal(handle.writable, true);
        const content = readFileSync(lockFilePath, "utf-8").trim();
        assert.equal(content, String(process.pid));
      } finally {
        handle.close();
      }
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it("e15s03 concurrent processes racing for write lock: exactly one succeeds, others get project-locked", async () => {
    const freshRoot = emptyDestination();
    try {
      const freshHandle = createProject({ rootPath: freshRoot, ownerId: "owner-race" });
      freshHandle.close(); // Ensure activeLocks is clear

      const barrierDir = join(freshRoot, "barrier");
      mkdirSync(barrierDir, { recursive: true });

      // Spawn 3 concurrent node processes synchronized at a barrier
      const script = `
        import { acquireProjectWriteLock } from "./dist/src/project/project-lock.js";
        import { ProjectStoreError } from "./dist/src/project/project-types.js";
        import { existsSync, writeFileSync, readdirSync } from "node:fs";
        import { join } from "node:path";

        const rootPath = process.argv[1];
        const barrierDir = process.argv[2];
        const pid = process.pid;

        // 1. Signal ready
        writeFileSync(join(barrierDir, "ready-" + pid), "");

        // 2. Synchronize before acquisition: wait for start gate
        const startGate = join(barrierDir, "start.gate");
        while (!existsSync(startGate)) {
          await new Promise((r) => setTimeout(r, 10));
        }

        // 3. Race for write lock simultaneously
        try {
          const lock = acquireProjectWriteLock(rootPath);
          writeFileSync(join(barrierDir, "winner-" + pid), "");

          // Hold winning lock until all other contenders have completed their attempt
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const entries = readdirSync(barrierDir);
            const losers = entries.filter((e) => e.startsWith("locked-"));
            if (losers.length >= 2) {
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }

          lock.release();
          process.exit(0);
        } catch (err) {
          if (err instanceof ProjectStoreError && err.code === "project-locked") {
            writeFileSync(join(barrierDir, "locked-" + pid), "");
            process.exit(42);
          }
          writeFileSync(join(barrierDir, "error-" + pid), String(err));
          process.exit(1);
        }
      `;

      const runners = Array.from({ length: 3 }, () => {
        return new Promise<number>((resolve) => {
          const child = spawn(process.argv[0], ["--input-type=module", "-e", script, freshRoot, barrierDir]);
          child.on("close", (code) => resolve(code ?? 1));
        });
      });

      // Wait until all 3 children are alive and ready before opening the start gate
      const readyDeadline = Date.now() + 10000;
      while (Date.now() < readyDeadline) {
        const readyCount = readdirSync(barrierDir).filter((e) => e.startsWith("ready-")).length;
        if (readyCount >= 3) {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      // Open start gate to release all 3 contenders simultaneously
      writeFileSync(join(barrierDir, "start.gate"), "");

      const exitCodes = await Promise.all(runners);
      const successes = exitCodes.filter((c) => c === 0).length;
      const locked = exitCodes.filter((c) => c === 42).length;

      assert.equal(successes, 1, "exactly one concurrent process should acquire the lock");
      assert.equal(locked, 2, "other processes should receive project-locked exit code");
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  it("e15s03 concurrent createProject preserves winner's store and rejects loser without store deletion", async () => {
    const freshRoot = join(tmpdir(), `ganesh-concur-create-${Date.now()}`);
    mkdirSync(freshRoot, { recursive: true });

    try {
      const barrierDir = join(freshRoot, "barrier");
      mkdirSync(barrierDir, { recursive: true });

      const script = `
        import { createProject } from "./dist/src/project/project-store.js";
        import { ProjectStoreError } from "./dist/src/project/project-types.js";
        import { existsSync, writeFileSync, readdirSync } from "node:fs";
        import { join } from "node:path";

        const rootPath = process.argv[1];
        const barrierDir = process.argv[2];
        const pid = process.pid;

        // 1. Signal ready
        writeFileSync(join(barrierDir, "ready-" + pid), "");

        // 2. Synchronize before acquisition: wait for start gate
        const startGate = join(barrierDir, "start.gate");
        while (!existsSync(startGate)) {
          await new Promise((r) => setTimeout(r, 10));
        }

        // 3. Race to create project
        try {
          const handle = createProject({ rootPath, ownerId: "owner-race-" + pid });
          writeFileSync(join(barrierDir, "winner-" + pid), "");

          // Hold winning project open until loser completes
          const deadline = Date.now() + 10000;
          while (Date.now() < deadline) {
            const entries = readdirSync(barrierDir);
            if (entries.some((e) => e.startsWith("rejected-") || e.startsWith("locked-"))) {
              break;
            }
            await new Promise((r) => setTimeout(r, 10));
          }

          handle.close();
          process.exit(0);
        } catch (err) {
          if (err instanceof ProjectStoreError && (err.code === "project-exists" || err.code === "project-locked" || err.code === "lock-timeout")) {
            writeFileSync(join(barrierDir, (err.code === "project-exists" ? "rejected-" : "locked-") + pid), "");
            process.exit(42);
          }
          writeFileSync(join(barrierDir, "error-" + pid), String(err));
          process.exit(1);
        }
      `;

      const runners = Array.from({ length: 2 }, () => {
        return new Promise<number>((resolve) => {
          const child = spawn(process.argv[0], ["--input-type=module", "-e", script, freshRoot, barrierDir]);
          child.on("close", (code) => resolve(code ?? 1));
        });
      });

      // Wait until both children are ready
      const readyDeadline = Date.now() + 10000;
      while (Date.now() < readyDeadline) {
        const readyCount = readdirSync(barrierDir).filter((e) => e.startsWith("ready-")).length;
        if (readyCount >= 2) {
          break;
        }
        await new Promise((r) => setTimeout(r, 10));
      }

      // Release both children simultaneously
      writeFileSync(join(barrierDir, "start.gate"), "");

      const exitCodes = await Promise.all(runners);
      const successes = exitCodes.filter((c) => c === 0).length;
      const rejected = exitCodes.filter((c) => c === 42).length;

      assert.equal(successes, 1, "exactly one creator should succeed");
      assert.equal(rejected, 1, "losing creator should be rejected with project-exists or lock error");

      // Verify the winner's store and database were NEVER deleted by the losing creator's error cleanup
      assert.equal(existsSync(join(freshRoot, ".ganesh", "project.sqlite")), true, "winner's database must survive intact");
      const reopened = openProject(freshRoot);
      try {
        assert.equal(reopened.status, "ready", "winner's project must be readable and ready");
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(freshRoot, { recursive: true, force: true });
    }
  });

  // SC-e15s03-P1-04: Corruption and pending ops stay honest
  it("e15s03 corrupt artifact reports contentStatus corrupt without rewriting hash", () => {
    const art = registerPublicArtifact(fix.handle, "corruptible-doc", "v1", "pristine content");
    assert.equal(inspectArtifactVersion(fix.handle, art.id).contentStatus, "available");

    // Corrupt the file by flipping bytes
    const storagePath = art.storagePath!;
    writeFileSync(storagePath, "tampered content");

    // Inspect artifact reports corrupt
    const inspection = inspectArtifactVersion(fix.handle, art.id);
    assert.equal(inspection.contentStatus, "corrupt");
    // Stored hash must remain unchanged
    assert.equal(inspection.contentHash, art.contentHash);

    // recoverProject keeps honest corruption reporting
    const recovery = recoverProject(fix.root);
    const corruptReport = recovery.artifactStatuses.find(s => s.id === art.id);
    assert.ok(corruptReport, "corrupted artifact must be listed in recovery statuses");
    assert.equal(corruptReport.contentStatus, "corrupt");
  });

  it("e15s03 pending lifecycle operations stay pending across recoverProject regression", () => {
    // Insert a pending lifecycle operation
    const opId = "lifecycle-op-pending-test";
    fix.handle.db.prepare(
      "INSERT INTO lifecycle_operations (id, operation_type, branch_id, input_snapshot, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run(opId, "remote-search", "main", "{}", "pending", new Date().toISOString(), new Date().toISOString());

    // Run recoverProject
    const recovery = recoverProject(fix.root);
    assert.ok(recovery.uncertainOperationIds?.includes(opId), "uncertain operations must include pending lifecycle op");

    // Verify row status was NOT mutated
    const row = fix.handle.db.prepare(
      "SELECT status FROM lifecycle_operations WHERE id = ?"
    ).get(opId) as Record<string, unknown> | undefined;
    assert.equal(row?.status, "pending", "lifecycle row status must remain pending");
  });
});
