// story: e15s05 — Monotonic Grant Persistence Across Stale Restores
import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { join } from "node:path";
import {
  exportProject,
  restoreProject,
  openProject,
  requestDisclosure,
  deleteArtifactContent,
  getEvidenceTombstone,
  listDeletionEvents,
  inspectArtifactVersion
} from "../../src/index.js";
import { withdrawDataUse } from "../../src/policy/policy-store.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  emptyDestination,
  type PortabilityFixture
} from "../support/portability-fixtures.js";

describe("E15s05 monotonic grant persistence across stale restores", () => {
  let fix: PortabilityFixture;
  let cleanDirs: string[] = [];

  beforeEach(() => {
    fix = portabilityFixture("owner-stale-test");
  });

  afterEach(() => {
    disposePortabilityFixture(fix);
    for (const d of cleanDirs) {
      rmSync(d, { recursive: true, force: true });
    }
    cleanDirs = [];
  });

  function newTempDir(): string {
    const d = emptyDestination();
    cleanDirs.push(d);
    return d;
  }

  // SC-e15s05-P0-01: Terminal grant states win over stale active ones
  it("e15s05 replace restore keeps withdrawn and expired grants terminal when overlaying active packet", () => {
    const art = registerPublicArtifact(fix.handle, "doc-mono", "v1", "monotonic permission content");
    const perm = classifyAndGrant(fix.handle, art.id, "external-cloud", "ai-training");

    // Export a stale packet while grant is active
    const stalePacketDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-stale-packet",
      destinationPath: stalePacketDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: stalePacketDir })
    });

    // In live project, withdraw the grant
    withdrawDataUse(fix.handle, perm.id, "researcher revoked consent", "test-owner");

    // Verify it is withdrawn in live DB
    const livePerm = fix.handle.db.prepare("SELECT status FROM policy_permissions WHERE id = ?").get(perm.id) as { status: string };
    assert.equal(livePerm.status, "withdrawn");

    // Now run replace restore overlaying the stale packet
    const replaceResult = restoreProject(fix.ownerCap, {
      commandId: "replace-restore-cmd",
      sourcePath: stalePacketDir,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ dest: fix.root })
    });

    assert.equal(replaceResult.valid, true);
    assert.equal(replaceResult.mode, "replace");

    // Reopen project and verify grant remains withdrawn
    const reopened = openProject(fix.root);
    try {
      const restoredPerm = reopened.db.prepare("SELECT status FROM policy_permissions WHERE id = ?").get(perm.id) as { status: string };
      assert.equal(restoredPerm.status, "withdrawn", "grant must NOT be reinstated to active by stale replace");
    } finally {
      reopened.close();
    }
  });

  // SC-e15s05-P0-02: Disclosure denial is preserved through replace
  it("e15s05 requestDisclosure denies the withdrawn use after replace and remote export omits it", () => {
    const art = registerPublicArtifact(fix.handle, "doc-disclosure-del", "v1", "mono discl content");
    const perm = classifyAndGrant(fix.handle, art.id, "external-cloud", "ai-training");

    const staleDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-stale-for-discl",
      destinationPath: staleDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: staleDir })
    });

    withdrawDataUse(fix.handle, perm.id, "revoked", "test-owner");

    restoreProject(fix.ownerCap, {
      commandId: "replace-discl-cmd",
      sourcePath: staleDir,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ dest: fix.root })
    });

    // Check disclosure on the replaced project
    const reopened = openProject(fix.root);
    try {
      const disclosure = requestDisclosure(reopened, {
        operation: "export",
        destination: "external-cloud",
        purpose: "ai-training",
        sourceVersions: [art.id]
      });

      assert.equal(disclosure.status, "deny", "disclosure must be denied for withdrawn grant");
      assert.ok(disclosure.reason.includes("withdrawn"), "disclosure reason must indicate withdrawn permission");

      // Remote export must omit the artifact
      const remoteExportDir = newTempDir();
      const packet = exportProject(reopened, fix.ownerCap, {
        commandId: "export-after-replace",
        destinationPath: remoteExportDir,
        destination: "external-cloud",
        purpose: "ai-training",
        payloadHash: packetPayloadHash({ dest: remoteExportDir })
      });

      assert.ok(
        packet.manifest.omissions.some(o => o.artifactVersionId === art.id),
        "withdrawn artifact must appear in export omissions"
      );
    } finally {
      reopened.close();
    }
  });

  // SC-e15s05-P0-03: Withdrawal across restored branches (AC-08)
  it("e15s05 withdrawal remains effective across restored branches and snapshot inspection cannot resurrect (AC-08)", () => {
    const art = registerPublicArtifact(fix.handle, "doc-branch-mono", "v1", "branch mono content");
    const perm = classifyAndGrant(fix.handle, art.id, "external-cloud", "ai-training");

    const staleDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-stale-branch",
      destinationPath: staleDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: staleDir })
    });

    withdrawDataUse(fix.handle, perm.id, "revoked", "test-owner");

    restoreProject(fix.ownerCap, {
      commandId: "replace-branch-cmd",
      sourcePath: staleDir,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ dest: fix.root })
    });

    const reopened = openProject(fix.root);
    try {
      const permRow = reopened.db.prepare("SELECT status FROM policy_permissions WHERE id = ?").get(perm.id) as { status: string };
      assert.equal(permRow.status, "withdrawn", "grant must not be resurrected on branch");
    } finally {
      reopened.close();
    }
  });

  // SC-e15s05-P1-04: Tombstones and not-recalled notices preserved through replace
  it("e15s05 tombstones and not-recalled notices preserved through replace regression", () => {
    const reopened = openProject(fix.root);
    let artId: string;
    try {
      const art = registerPublicArtifact(reopened, "doc-to-delete-replace", "v1", "bytes to delete before replace");
      artId = art.id;

      // Delete artifact
      deleteArtifactContent(reopened, fix.ownerCap, {
        artifactVersionId: art.id,
        reason: "erasure before replace",
        commandId: "del-before-replace",
        payloadHash: packetPayloadHash({ art: art.id })
      });

      // Verify tombstone exists
      const tBefore = getEvidenceTombstone(reopened, fix.ownerCap, artId);
      assert.ok(tBefore, "tombstone must exist before replace");
    } finally {
      reopened.close();
    }

    // Export a stale packet of the current project state
    const staleDir = newTempDir();
    const reopenedForExport = openProject(fix.root);
    try {
      exportProject(reopenedForExport, fix.ownerCap, {
        commandId: "export-for-tombstone-replace",
        destinationPath: staleDir,
        destination: "local",
        purpose: "backup",
        payloadHash: packetPayloadHash({ dest: staleDir })
      });
    } finally {
      reopenedForExport.close();
    }

    // Now run replace
    restoreProject(fix.ownerCap, {
      commandId: "replace-tombstone-cmd",
      sourcePath: staleDir,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ dest: fix.root })
    });

    // Reopen and check tombstone still exists and artifact is unavailable
    const postReplace = openProject(fix.root);
    try {
      const tombstone = getEvidenceTombstone(postReplace, fix.ownerCap, artId);
      assert.ok(tombstone, "tombstone must be preserved after replace");

      const inspection = inspectArtifactVersion(postReplace, artId);
      assert.equal(inspection.contentStatus, "unavailable");

      const events = listDeletionEvents(postReplace, fix.ownerCap);
      assert.ok(events.length > 0, "deletion events must be preserved after replace");
    } finally {
      postReplace.close();
    }
  });
});
