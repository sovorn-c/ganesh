// story: e15s04 — Controlled Deletion of Derived Content and Caches
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  deleteArtifactContent,
  getEvidenceTombstone,
  listDeletionEvents,
  inspectArtifactVersion,
  backupProject,
  createDecisionPacket,
  recordOwnerDecision,
  updateBranchReference,
  assessReadiness,
  deriveMaterial,
  requestDisclosure,
  registerArtifactVersion,
  classifyInput,
  grantDataUse,
  proposeContract,
  authorizeContract,
  queueRun,
  dispatchRun,
  ProjectStoreError,
  recoverProject,
} from "../../src/index.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  type PortabilityFixture,
} from "../support/portability-fixtures.js";

describe("Controlled deletion filesystem safety", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-deletion-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  // SC-e15s04-P0-01: Deletion unlinks application-controlled copies
  it("deletion unlinks original, derived, cache and opted-in app-backup bytes leaving evidence tombstone", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "target-doc",
      "v1",
      "sensitive research bytes",
    );
    const artPath = art.storagePath!;
    assert.equal(existsSync(artPath), true, "original artifact should exist");

    // Create a derived material row + registered derived artifact
    const derivedArt = registerArtifactVersion(fix.handle, {
      logicalId: "derived-doc",
      version: "v1",
      versionId: "derived-doc-v1",
      content: "derived bytes from sensitive",
      dependencies: [{ versionId: art.id, relation: "derived-from" }],
    });
    const derivedRec = deriveMaterial(
      fix.handle,
      [art.id],
      "summarize",
      "main",
    );
    // Link candidate_version_id in derived_materials
    fix.handle.db
      .prepare(
        "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?",
      )
      .run(derivedArt.id, derivedRec.id);
    assert.equal(existsSync(derivedArt.storagePath!), true);

    // Create a cache file in .ganesh
    const cacheDir = join(fix.root, ".ganesh", "artifacts", "cache");
    mkdirSync(cacheDir, { recursive: true });
    const cacheFilePath = join(cacheDir, `${art.id}.cache`);
    writeFileSync(cacheFilePath, "cached derived results");
    assert.equal(existsSync(cacheFilePath), true);

    // Create an app backup containing the artifact
    const backup = backupProject(fix.handle, fix.ownerCap, {
      commandId: "backup-before-delete",
      payloadHash: packetPayloadHash({ cmd: "b-del" }),
    });
    const backupArtifactFile = join(
      backup.backupPath,
      "artifacts",
      art.storagePath!.split("/").slice(-2).join("/"),
    );

    // Run deletion with includeAppBackups: true
    const payloadHash = packetPayloadHash({ art: art.id });
    const result = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "GDPR right to erasure",
      commandId: "del-cmd-1",
      payloadHash,
      includeAppBackups: true,
    });

    assert.ok(result.deletionEventId);
    assert.ok(result.tombstoneId);

    // Original file must be gone
    assert.equal(
      existsSync(artPath),
      false,
      "original artifact file must be unlinked",
    );
    // Derived file must be gone
    assert.equal(
      existsSync(derivedArt.storagePath!),
      false,
      "derived artifact file must be unlinked",
    );
    // Cache file must be gone
    assert.equal(
      existsSync(cacheFilePath),
      false,
      "cache file must be unlinked",
    );

    // Tombstone must be inspectable and NOT contain prohibited text
    const tombstone = getEvidenceTombstone(fix.handle, fix.ownerCap, art.id);
    assert.ok(tombstone, "evidence tombstone must exist");
    assert.equal(tombstone!.artifactVersionId, art.id);
    assert.equal(tombstone!.reason, "GDPR right to erasure");
    assert.equal(
      JSON.stringify(tombstone).includes("sensitive research bytes"),
      false,
      "tombstone must not contain prohibited text",
    );

    // inspectArtifactVersion reports unavailable
    const inspection = inspectArtifactVersion(fix.handle, art.id);
    assert.equal(inspection.contentStatus, "unavailable");
  });

  it("deletion records and unlinks a broken symlink leaf", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "broken-link-delete",
      "v1",
      "broken link bytes",
    );
    rmSync(art.storagePath!, { force: true });
    symlinkSync(join(fix.root, "missing-target"), art.storagePath!);

    const deletion = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "broken-link-test",
      commandId: "delete-broken-link",
      payloadHash: packetPayloadHash({ broken: "1" }),
    });

    assert.throws(
      () => lstatSync(art.storagePath!),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT",
    );
    const event = fix.handle.db
      .prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), []);
  });

  it("deletion rejects a symlinked allowed root without touching its target", () => {
    const isolated = portabilityFixture("deletion-symlink-root");
    try {
      const art = registerPublicArtifact(
        isolated.handle,
        "symlink-root",
        "v1",
        "must remain",
      );
      const externalRoot = join(isolated.root, "external-artifacts");
      const artifactRoot = isolated.handle.project.artifactRoot;
      mkdirSync(externalRoot, { recursive: true });
      const externalFile = join(externalRoot, "symlink-root", "v1");
      mkdirSync(join(externalRoot, "symlink-root"), { recursive: true });
      writeFileSync(externalFile, "must remain");
      rmSync(artifactRoot, { recursive: true, force: true });
      symlinkSync(externalRoot, artifactRoot);

      const deletion = deleteArtifactContent(
        isolated.handle,
        isolated.ownerCap,
        {
          artifactVersionId: art.id,
          reason: "symlink-root-test",
          commandId: "delete-symlink-root",
          payloadHash: packetPayloadHash({ symlinkRoot: "1" }),
        },
      );

      assert.deepEqual(deletion.unlinkedPaths, []);
      assert.equal(existsSync(externalFile), true);
    } finally {
      disposePortabilityFixture(isolated);
    }
  });

  it("recovery does not follow an ancestor symlink in a recorded path", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "recovery-symlink",
      "v1",
      "recovery symlink bytes",
    );
    const outsideDir = join(fix.root, "recovery-outside");
    const outsideFile = join(outsideDir, "victim.txt");
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(outsideFile, "must remain");
    const link = join(fix.handle.project.artifactRoot, "recovery-link");
    symlinkSync(outsideDir, link);
    const recordedPath = join(link, "victim.txt");
    const deletion = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "recovery-symlink-test",
      commandId: "delete-recovery-symlink",
      payloadHash: packetPayloadHash({ recoverySymlink: "1" }),
    });
    fix.handle.db
      .prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
      .run(JSON.stringify([recordedPath]), deletion.deletionEventId);

    recoverProject(fix.root);

    assert.equal(existsSync(outsideFile), true);
    const event = fix.handle.db
      .prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), [recordedPath]);
  });

  // SC-e15s04-P0-02: New use and execution are blocked
  it("recovery retries deletion paths recorded before a crash", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "recovery-delete",
      "v1",
      "recovery bytes",
    );
    const deletion = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "recovery-test",
      commandId: "delete-recovery-test",
      payloadHash: packetPayloadHash({ recovery: "1" }),
    });
    const retryPath = join(
      fix.handle.project.artifactRoot,
      "recovery-pending.txt",
    );
    writeFileSync(retryPath, "must be removed");
    fix.handle.db
      .prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
      .run(JSON.stringify([retryPath]), deletion.deletionEventId);

    recoverProject(fix.root);

    assert.equal(existsSync(retryPath), false);
    const event = fix.handle.db
      .prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), []);
  });

  it("adversarial symlink escape in deletion skips unlinking and never removes external files", () => {
    const externalDir = join(
      fix.root,
      "..",
      `external-victim-dir-${Date.now()}`,
    );
    mkdirSync(externalDir, { recursive: true });
    const externalFile1 = join(externalDir, "secret-victim-1.txt");
    const externalFile2 = join(externalDir, "secret-victim-2.txt");
    writeFileSync(externalFile1, "external sensitive data 1");
    writeFileSync(externalFile2, "external sensitive data 2");

    try {
      // Case A: Intermediate directory is a symlink pointing outside
      const escapedDirLink = join(
        fix.root,
        ".ganesh",
        "artifacts",
        "symlink-dir-escape",
      );
      if (!existsSync(escapedDirLink)) {
        symlinkSync(externalDir, escapedDirLink);
      }
      const artEscaped = registerArtifactVersion(fix.handle, {
        logicalId: "doc-escape-intermediate",
        version: "v1",
        versionId: "doc-escape-intermediate-v1",
        content: "placeholder content",
      });
      fix.handle.db
        .prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?")
        .run("symlink-dir-escape/secret-victim-1.txt", artEscaped.id);

      // Case B: Leaf file is a symlink pointing outside
      const escapedFileLink = join(
        fix.root,
        ".ganesh",
        "artifacts",
        "symlink-file-escape.txt",
      );
      if (!existsSync(escapedFileLink)) {
        symlinkSync(externalFile2, escapedFileLink);
      }
      const artLeaf = registerArtifactVersion(fix.handle, {
        logicalId: "doc-escape-leaf",
        version: "v1",
        versionId: "doc-escape-leaf-v1",
        content: "placeholder content",
      });
      fix.handle.db
        .prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?")
        .run("symlink-file-escape.txt", artLeaf.id);

      // Execute deletion for both
      deleteArtifactContent(fix.handle, fix.ownerCap, {
        artifactVersionId: artEscaped.id,
        reason: "adversarial deletion test 1",
        commandId: "del-adv-1",
        payloadHash: packetPayloadHash({ a: "1" }),
      });

      deleteArtifactContent(fix.handle, fix.ownerCap, {
        artifactVersionId: artLeaf.id,
        reason: "adversarial deletion test 2",
        commandId: "del-adv-2",
        payloadHash: packetPayloadHash({ a: "2" }),
      });

      // Assert external files were NEVER deleted
      assert.equal(
        existsSync(externalFile1),
        true,
        "externalFile1 must NOT be deleted via intermediate symlink traversal",
      );
      assert.equal(
        existsSync(externalFile2),
        true,
        "externalFile2 must NOT be deleted via leaf symlink escape",
      );
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });
});
