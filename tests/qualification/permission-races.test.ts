// story: e17s02
import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
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

    // Execute concurrent overlapping operations: revoke permission concurrently while restore is scheduled
    const concurrentRevoke = async () => {
      withdrawDataUse(fix.handle, grant.id, "revoked-prior-to-restore", fix.ownerId);
    };

    const concurrentRestore = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return restoreProject(fix.ownerCap, {
        commandId: `replace-restore-cmd-${fix.handle.project.id}`,
        sourcePath: backupDir,
        destinationPath: fix.root,
        mode: "replace",
        payloadHash: packetPayloadHash({ dest: fix.root })
      });
    };

    const [, replaceResult] = await Promise.all([concurrentRevoke(), concurrentRestore()]);
    assert.equal(replaceResult.valid, true);

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
  });

  // SC-e17s02-P0-02: classify-during-export
  it("e17s02 permission-race classify-during-export ensures restricted material is omitted (SC-e17s02-P0-02)", async () => {
    const art1 = registerPublicArtifact(fix.handle, "doc-pub", "v1", "public summary");
    const art2 = registerPublicArtifact(fix.handle, "doc-secret", "v1", "confidential participant notes");

    const exportDir = newTempDir();

    // Execute concurrent overlapping operations: classify art2 as restricted while export is being prepared
    const concurrentClassify = async () => {
      classifyInput(fix.handle, art2.id, {
        sensitivity: "restricted",
        basis: "participant-confidentiality"
      });
    };

    const concurrentExport = async () => {
      await new Promise((resolve) => setImmediate(resolve));
      return exportProject(fix.handle, fix.ownerCap, {
        commandId: `export-classify-race-${fix.handle.project.id}`,
        destinationPath: exportDir,
        destination: "external-cloud",
        purpose: "remote-review",
        payloadHash: packetPayloadHash({ dest: exportDir })
      });
    };

    const [, result] = await Promise.all([concurrentClassify(), concurrentExport()]);

    // Export completed with manifest and omitted the restricted material
    assert.ok(result.manifest);
    assert.ok(result.manifest.files.length > 0);
    const omittedIds = (result.manifest.omissions ?? []).map((o) => o.artifactVersionId);
    assert.ok(omittedIds.includes(art2.id), "restricted artifact must be omitted from external export");
    const exportedPaths = result.manifest.files.map((f) => f.relativePath);
    assert.ok(!exportedPaths.some((p) => p.includes("doc-secret")), "restricted content bytes must not be exported");
  });
});
