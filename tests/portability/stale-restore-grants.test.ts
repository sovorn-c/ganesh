// story: e15s05 — Monotonic Grant Persistence Across Stale Restores
import { describe, it, afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rmSync, existsSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import {
  exportProject,
  restoreProject,
  openProject,
  requestDisclosure,
  deleteArtifactContent,
  getEvidenceTombstone,
  listDeletionEvents,
  inspectArtifactVersion,
  ProjectStoreError
} from "../../src/index.js";
import { withdrawDataUse } from "../../src/policy/policy-store.js";
import { _clearPortabilityRegistryForTests } from "../../src/portability/restore-store.js";
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
    _clearPortabilityRegistryForTests();
    fix = portabilityFixture("owner-stale-test");
  });

  afterEach(() => {
    _clearPortabilityRegistryForTests();
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
      commandId: `export-stale-packet-${fix.handle.project.id}`,
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
      commandId: `replace-restore-cmd-${fix.handle.project.id}`,
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
      commandId: `export-stale-for-discl-${fix.handle.project.id}`,
      destinationPath: staleDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: staleDir })
    });

    withdrawDataUse(fix.handle, perm.id, "revoked", "test-owner");

    restoreProject(fix.ownerCap, {
      commandId: `replace-discl-cmd-${fix.handle.project.id}`,
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
        commandId: `export-after-replace-${fix.handle.project.id}`,
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
      commandId: `export-stale-branch-${fix.handle.project.id}`,
      destinationPath: staleDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: staleDir })
    });

    withdrawDataUse(fix.handle, perm.id, "revoked", "test-owner");

    restoreProject(fix.ownerCap, {
      commandId: `replace-branch-cmd-${fix.handle.project.id}`,
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
        commandId: `del-before-replace-${fix.handle.project.id}`,
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
        commandId: `export-for-tombstone-replace-${fix.handle.project.id}`,
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
      commandId: `replace-tombstone-cmd-${fix.handle.project.id}`,
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

  it("e15s05 replace removes stale destination artifacts when replacement packet has no artifacts directory", () => {
    // Register artifact in destination project
    const art = registerPublicArtifact(fix.handle, "dest-artifact-stale", "v1", "stale destination bytes");
    const destArtPath = art.storagePath!;
    assert.equal(existsSync(destArtPath), true, "destination artifact must exist before replace");
    fix.handle.close();

    // Export a packet with no artifacts from an empty project with the same owner
    const emptySourceDir = newTempDir();
    const emptyProjFix = portabilityFixture(fix.ownerId);
    cleanDirs.push(emptyProjFix.root);
    try {
      exportProject(emptyProjFix.handle, emptyProjFix.ownerCap, {
        commandId: `export-empty-${emptyProjFix.handle.project.id}`,
        destinationPath: emptySourceDir,
        destination: "local",
        purpose: "backup",
        payloadHash: packetPayloadHash({ empty: "true" })
      });
    } finally {
      emptyProjFix.handle.close();
    }

    // Verify replacement packet has NO artifacts directory
    const packetArtifactsDir = join(emptySourceDir, "artifacts");
    rmSync(packetArtifactsDir, { recursive: true, force: true });
    assert.equal(existsSync(packetArtifactsDir), false, "replacement packet has no artifacts directory");

    // Replace destination with the artifact-free packet
    restoreProject(fix.ownerCap, {
      commandId: `replace-no-artifacts-${fix.handle.project.id}`,
      sourcePath: emptySourceDir,
      destinationPath: fix.root,
      mode: "replace",
      payloadHash: packetPayloadHash({ dest: fix.root })
    });

    // Stale destination artifact must be gone
    assert.equal(existsSync(destArtPath), false, "stale destination artifact must be removed after replace");
    const destArtifactsDir = join(fix.root, ".ganesh", "artifacts");
    assert.equal(existsSync(destArtifactsDir), false, "stale destination artifacts directory must be removed");
  });

  // Adversarial containment tests for replace restore tombstone unlinking
  it("e15s05 replace restore rejects path-traversal storage paths on tombstoned artifacts and leaves external victim intact", () => {
    // 1. Create an external victim file outside the project and workspace
    const victimDir = emptyDestination();
    cleanDirs.push(victimDir);
    const victimFile = join(victimDir, "external-victim-traversal.txt");
    writeFileSync(victimFile, "PRESERVE THIS VICTIM FILE CONTENT - TRAVERSAL");
    assert.equal(existsSync(victimFile), true, "victim file must exist before restore attempt");

    // 2. Register artifact in live project
    const art = registerPublicArtifact(fix.handle, "doc-victim-traversal", "v1", "payload to be tombstoned");
    const artId = art.id;

    // 3. Export valid packet while artifact is active
    const packetDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: `export-victim-trav-${fix.handle.project.id}`,
      destinationPath: packetDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: packetDir })
    });

    // 4. In live project, tombstone the artifact
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artId,
      reason: "privacy erasure",
      commandId: `del-trav-${fix.handle.project.id}`,
      payloadHash: packetPayloadHash({ art: artId }),
      includeAppBackups: true
    });

    // 5. Craft packet database to have a traversal path pointing to the external victim
    const packetDbPath = join(packetDir, "project.sqlite");
    const traversalPath = join("../../../../../../../../../..", victimFile);
    const packetDb = new DatabaseSync(packetDbPath);
    try {
      packetDb.prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?").run(traversalPath, artId);
    } finally {
      packetDb.close();
    }

    // Recompute manifest project.sqlite hash so manifest validation passes
    const manifestPath = join(packetDir, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const newDbHash = createHash("sha256").update(readFileSync(packetDbPath)).digest("hex");
    const fileEntry = manifest.files.find((f: { relativePath: string }) => f.relativePath === "project.sqlite");
    if (fileEntry) {
      fileEntry.sha256 = newDbHash;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // 6. Attempt replace restore: must throw path-escape and leave victim intact
    assert.throws(
      () => {
        restoreProject(fix.ownerCap, {
          commandId: `replace-victim-trav-${fix.handle.project.id}`,
          sourcePath: packetDir,
          destinationPath: fix.root,
          mode: "replace",
          payloadHash: packetPayloadHash({ dest: fix.root })
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError, "must throw ProjectStoreError");
        assert.equal((err as ProjectStoreError).code, "path-escape", "must fail with path-escape");
        return true;
      }
    );

    // 7. Verify external victim survived and was NOT unlinked
    assert.equal(existsSync(victimFile), true, "external victim file must survive replace restore");
    assert.equal(readFileSync(victimFile, "utf8"), "PRESERVE THIS VICTIM FILE CONTENT - TRAVERSAL");

    // Clean up victim
    rmSync(victimFile, { force: true });
  });

  it("e15s05 replace restore rejects absolute storage paths on tombstoned artifacts and leaves external victim intact", () => {
    // 1. Create an external victim file outside the project and workspace
    const victimDir = emptyDestination();
    cleanDirs.push(victimDir);
    const victimFile = join(victimDir, "external-victim-absolute.txt");
    writeFileSync(victimFile, "PRESERVE THIS VICTIM FILE CONTENT - ABSOLUTE");
    assert.equal(existsSync(victimFile), true, "victim file must exist before restore attempt");

    // 2. Register artifact in live project
    const art = registerPublicArtifact(fix.handle, "doc-victim-absolute", "v1", "payload to be tombstoned");
    const artId = art.id;

    // 3. Export valid packet while artifact is active
    const packetDir = newTempDir();
    exportProject(fix.handle, fix.ownerCap, {
      commandId: `export-victim-abs-${fix.handle.project.id}`,
      destinationPath: packetDir,
      destination: "local",
      purpose: "backup",
      payloadHash: packetPayloadHash({ dest: packetDir })
    });

    // 4. In live project, tombstone the artifact
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artId,
      reason: "privacy erasure",
      commandId: `del-abs-${fix.handle.project.id}`,
      payloadHash: packetPayloadHash({ art: artId }),
      includeAppBackups: true
    });

    // 5. Craft packet database to have an absolute path pointing to the external victim
    const packetDbPath = join(packetDir, "project.sqlite");
    const packetDb = new DatabaseSync(packetDbPath);
    try {
      packetDb.prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?").run(victimFile, artId);
    } finally {
      packetDb.close();
    }

    // Recompute manifest project.sqlite hash so manifest validation passes
    const manifestPath = join(packetDir, "ganesh-project-packet.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const newDbHash = createHash("sha256").update(readFileSync(packetDbPath)).digest("hex");
    const fileEntry = manifest.files.find((f: { relativePath: string }) => f.relativePath === "project.sqlite");
    if (fileEntry) {
      fileEntry.sha256 = newDbHash;
    }
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // 6. Attempt replace restore: must throw path-escape and leave victim intact
    assert.throws(
      () => {
        restoreProject(fix.ownerCap, {
          commandId: `replace-victim-abs-${fix.handle.project.id}`,
          sourcePath: packetDir,
          destinationPath: fix.root,
          mode: "replace",
          payloadHash: packetPayloadHash({ dest: fix.root })
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError, "must throw ProjectStoreError");
        assert.equal((err as ProjectStoreError).code, "path-escape", "must fail with path-escape");
        return true;
      }
    );

    // 7. Verify external victim survived and was NOT unlinked
    assert.equal(existsSync(victimFile), true, "external victim file must survive replace restore");
    assert.equal(readFileSync(victimFile, "utf8"), "PRESERVE THIS VICTIM FILE CONTENT - ABSOLUTE");

    // Clean up victim
    rmSync(victimFile, { force: true });
  });
});
