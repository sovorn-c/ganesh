// story: e17s02
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  exportProject,
  restoreProject,
  openProject,
  queueRun,
  dispatchRun,
  classifyInput,
  type ProjectHandle,
  type SpecialistSessionPort
} from "../../src/index.js";
import {
  withdrawDataUse
} from "../../src/policy/policy-store.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  emptyDestination,
  type PortabilityFixture
} from "../support/portability-fixtures.js";
import { contract } from "../support/work-fixtures.js";
import { _clearPortabilityRegistryForTests } from "../../src/portability/restore-store.js";

describe("e17s02 permission-race behavioral tests", () => {
  let fix: PortabilityFixture;
  let cleanDirs: string[] = [];

  beforeEach(() => {
    _clearPortabilityRegistryForTests();
    fix = portabilityFixture("owner-race-test");
  });

  afterEach(() => {
    _clearPortabilityRegistryForTests();
    disposePortabilityFixture(fix);
    for (const d of cleanDirs) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
    cleanDirs = [];
  });

  function newTempDir(): string {
    const d = emptyDestination();
    cleanDirs.push(d);
    return d;
  }

  // SC-e17s02-P0-02: withdraw-during-dispatch
  it("e17s02 permission-race withdraw-during-dispatch leaves surviving state matching current policy (SC-e17s02-P0-02)", async () => {
    const art = registerPublicArtifact(fix.handle, "doc-race", "v1", "sensitive research source");
    const grant = classifyAndGrant(fix.handle, art.id, "local", "research-work");

    const authorized = contract(fix.handle, fix.ownerCap, [art.id]);
    const queued = queueRun(fix.handle, fix.ownerCap, {
      contractId: authorized.id,
      commandId: "cmd-run-race",
      inputVersionIds: [art.id]
    });

    let releaseSession!: () => void;
    const sessionInFlight = new Promise<void>((resolve) => {
      releaseSession = resolve;
    });
    let sessionStarted = false;

    const sessionPort: SpecialistSessionPort = {
      start: async () => {
        sessionStarted = true;
        await sessionInFlight;
        return { status: "ok" };
      }
    };

    // Begin in-flight dispatch
    const dispatchPromise = dispatchRun(fix.handle, fix.ownerCap, queued.id, sessionPort);

    // Overlapping concurrent operation: wait until dispatch is active, then withdraw permission concurrently
    const withdrawPromise = (async () => {
      while (!sessionStarted) {
        await new Promise((resolve) => setImmediate(resolve));
      }
      // Concurrently withdraw data use while dispatch is in flight
      withdrawDataUse(fix.handle, grant.id, "permission-withdrawn-during-race", fix.ownerId);
      releaseSession();
    })();

    await Promise.all([dispatchPromise, withdrawPromise]);

    // Verify surviving state matches policy: grant is withdrawn
    const livePerm = fix.handle.db
      .prepare("SELECT status FROM policy_permissions WHERE id = ?")
      .get(grant.id) as { status: string } | undefined;
    assert.ok(livePerm);
    assert.equal(livePerm.status, "withdrawn");

    // Attempting a new queueRun with withdrawn permission fails or cannot be queued
    assert.throws(() => {
      queueRun(fix.handle, fix.ownerCap, {
        contractId: authorized.id,
        commandId: "cmd-run-race-denied",
        inputVersionIds: [art.id]
      });
    });
  });

  // SC-e17s02-P0-02: revoke-during-restore
  it("e17s02 permission-race revoke-during-restore prevents revoked grants from reviving (SC-e17s02-P0-02)", async () => {
    const art = registerPublicArtifact(fix.handle, "doc-restore-race", "v1", "backup data");
    const grant = classifyAndGrant(fix.handle, art.id, "external-cloud", "ai-training");

    // Export a backup packet while the grant was active
    const backupDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: `export-backup-${fix.handle.project.id}`,
      destinationPath: backupDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: backupDir })
    });

    let restoreBarrierTriggered = false;
    let revokeExecutedDuringRestore = false;

    // Real overlap barrier: when replaceRestore opens the live database to read terminal grants,
    // intercept the prepare call and execute withdrawDataUse mid-flight before live grants are returned
    const origPrepareRestore = DatabaseSync.prototype.prepare;
    try {
      DatabaseSync.prototype.prepare = function (sql: string) {
        if (
          !restoreBarrierTriggered &&
          typeof sql === "string" &&
          sql.includes("SELECT id, input_version_id, destination, purpose, status FROM policy_permissions")
        ) {
          restoreBarrierTriggered = true;
          // Concurrent revoke races mid-flight while restore is actively executing
          withdrawDataUse(fix.handle, grant.id, "revoked-during-restore-barrier", fix.ownerId);
          revokeExecutedDuringRestore = true;
        }
        return origPrepareRestore.call(this, sql);
      };

      const replaceResult = restoreProject(fix.ownerCap, {
        commandId: `replace-restore-cmd-${fix.handle.project.id}`,
        sourcePath: backupDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: packetPayloadHash({ dest: fix.root })
      });

      assert.equal(replaceResult.valid, true);
      assert.equal(restoreBarrierTriggered, true, "restore barrier must be triggered during active restore");
      assert.equal(revokeExecutedDuringRestore, true, "revoke must execute concurrently during active restore");

      // Surviving live state MUST keep the grant withdrawn (monotonic grant retention)
      const reopened = openProject(fix.root);
      try {
        const restoredPerm = reopened.db
          .prepare("SELECT status FROM policy_permissions WHERE id = ?")
          .get(grant.id) as { status: string } | undefined;
        assert.ok(restoredPerm);
        assert.equal(restoredPerm.status, "withdrawn");
      } finally {
        reopened.close();
      }
    } finally {
      DatabaseSync.prototype.prepare = origPrepareRestore;
    }
  });

  // SC-e17s02-P0-02: classify-during-export
  it("e17s02 permission-race classify-during-export ensures restricted material is omitted (SC-e17s02-P0-02)", async () => {
    const art1 = registerPublicArtifact(fix.handle, "doc-pub", "v1", "public summary");
    const art2 = registerPublicArtifact(fix.handle, "doc-secret", "v1", "confidential participant notes");

    const exportDir = newTempDir();

    let exportBarrierTriggered = false;
    let classifyExecutedDuringExport = false;

    // Real overlap barrier: when exportProject prepares to query artifact_versions to evaluate disclosure,
    // intercept the prepare call and execute classifyInput mid-flight before rows are returned
    const origPrepareExport = DatabaseSync.prototype.prepare;
    try {
      DatabaseSync.prototype.prepare = function (sql: string) {
        if (
          !exportBarrierTriggered &&
          typeof sql === "string" &&
          sql.includes("FROM artifact_versions ORDER BY logical_id")
        ) {
          exportBarrierTriggered = true;
          // Concurrent classification races mid-flight while export is actively executing
          classifyInput(fix.handle, art2.id, {
            sensitivity: "restricted",
            basis: "participant-confidentiality"
          });
          classifyExecutedDuringExport = true;
        }
        return origPrepareExport.call(this, sql);
      };

      const result = exportProject(fix.handle, fix.ownerCap, {
        commandId: `export-classify-race-${fix.handle.project.id}`,
        destinationPath: exportDir,
        destination: "external-cloud",
        purpose: "remote-review",
        payloadHash: packetPayloadHash({ dest: exportDir })
      });

      assert.equal(exportBarrierTriggered, true, "export barrier must be triggered during active export");
      assert.equal(classifyExecutedDuringExport, true, "classification must execute concurrently during active export");

      // Export completed with manifest and omitted the restricted material
      assert.ok(result.manifest);
      assert.ok(result.manifest.files.length > 0);
      const omittedIds = (result.manifest.omissions ?? []).map((o) => o.artifactVersionId);
      assert.ok(omittedIds.includes(art2.id), "restricted artifact must be omitted from external export");
      const exportedPaths = result.manifest.files.map((f) => f.relativePath);
      assert.ok(!exportedPaths.some((p) => p.includes("doc-secret")), "restricted content bytes must not be exported");
    } finally {
      DatabaseSync.prototype.prepare = origPrepareExport;
    }
  });
});
