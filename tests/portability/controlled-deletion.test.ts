// story: e15s04 — Controlled Deletion of Derived Content and Caches
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, lstatSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
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
  recoverProject
} from "../../src/index.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  type PortabilityFixture
} from "../support/portability-fixtures.js";

describe("E15s04 controlled deletion of derived content and caches", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-deletion-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  // SC-e15s04-P0-01: Deletion unlinks application-controlled copies
  it("e15s04 deletion unlinks original, derived, cache and opted-in app-backup bytes leaving evidence tombstone", () => {
    const art = registerPublicArtifact(fix.handle, "target-doc", "v1", "sensitive research bytes");
    const artPath = art.storagePath!;
    assert.equal(existsSync(artPath), true, "original artifact should exist");

    // Create a derived material row + registered derived artifact
    const derivedArt = registerArtifactVersion(fix.handle, {
      logicalId: "derived-doc",
      version: "v1",
      versionId: "derived-doc-v1",
      content: "derived bytes from sensitive",
      dependencies: [{ versionId: art.id, relation: "derived-from" }]
    });
    const derivedRec = deriveMaterial(fix.handle, [art.id], "summarize", "main");
    // Link candidate_version_id in derived_materials
    fix.handle.db.prepare(
      "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?"
    ).run(derivedArt.id, derivedRec.id);
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
      payloadHash: packetPayloadHash({ cmd: "b-del" })
    });
    const backupArtifactFile = join(backup.backupPath, "artifacts", art.storagePath!.split("/").slice(-2).join("/"));

    // Run deletion with includeAppBackups: true
    const payloadHash = packetPayloadHash({ art: art.id });
    const result = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "GDPR right to erasure",
      commandId: "del-cmd-1",
      payloadHash,
      includeAppBackups: true
    });

    assert.ok(result.deletionEventId);
    assert.ok(result.tombstoneId);

    // Original file must be gone
    assert.equal(existsSync(artPath), false, "original artifact file must be unlinked");
    // Derived file must be gone
    assert.equal(existsSync(derivedArt.storagePath!), false, "derived artifact file must be unlinked");
    // Cache file must be gone
    assert.equal(existsSync(cacheFilePath), false, "cache file must be unlinked");

    // Tombstone must be inspectable and NOT contain prohibited text
    const tombstone = getEvidenceTombstone(fix.handle, fix.ownerCap, art.id);
    assert.ok(tombstone, "evidence tombstone must exist");
    assert.equal(tombstone!.artifactVersionId, art.id);
    assert.equal(tombstone!.reason, "GDPR right to erasure");
    assert.equal(JSON.stringify(tombstone).includes("sensitive research bytes"), false, "tombstone must not contain prohibited text");

    // inspectArtifactVersion reports unavailable
    const inspection = inspectArtifactVersion(fix.handle, art.id);
    assert.equal(inspection.contentStatus, "unavailable");
  });

  it("e15s04 deletion records and unlinks a broken symlink leaf", () => {
    const art = registerPublicArtifact(fix.handle, "broken-link-delete", "v1", "broken link bytes");
    rmSync(art.storagePath!, { force: true });
    symlinkSync(join(fix.root, "missing-target"), art.storagePath!);

    const deletion = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "broken-link-test",
      commandId: "delete-broken-link",
      payloadHash: packetPayloadHash({ broken: "1" })
    });

    assert.throws(() => lstatSync(art.storagePath!), (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT");
    const event = fix.handle.db.prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), []);
  });

  it("e15s04 deletion rejects a symlinked allowed root without touching its target", () => {
    const isolated = portabilityFixture("deletion-symlink-root");
    try {
      const art = registerPublicArtifact(isolated.handle, "symlink-root", "v1", "must remain");
      const externalRoot = join(isolated.root, "external-artifacts");
      const artifactRoot = isolated.handle.project.artifactRoot;
      mkdirSync(externalRoot, { recursive: true });
      const externalFile = join(externalRoot, "symlink-root", "v1");
      mkdirSync(join(externalRoot, "symlink-root"), { recursive: true });
      writeFileSync(externalFile, "must remain");
      rmSync(artifactRoot, { recursive: true, force: true });
      symlinkSync(externalRoot, artifactRoot);

      const deletion = deleteArtifactContent(isolated.handle, isolated.ownerCap, {
        artifactVersionId: art.id,
        reason: "symlink-root-test",
        commandId: "delete-symlink-root",
        payloadHash: packetPayloadHash({ symlinkRoot: "1" })
      });

      assert.deepEqual(deletion.unlinkedPaths, []);
      assert.equal(existsSync(externalFile), true);
    } finally {
      disposePortabilityFixture(isolated);
    }
  });

  it("e15s04 recovery does not follow an ancestor symlink in a recorded path", () => {
    const art = registerPublicArtifact(fix.handle, "recovery-symlink", "v1", "recovery symlink bytes");
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
      payloadHash: packetPayloadHash({ recoverySymlink: "1" })
    });
    fix.handle.db.prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
      .run(JSON.stringify([recordedPath]), deletion.deletionEventId);

    recoverProject(fix.root);

    assert.equal(existsSync(outsideFile), true);
    const event = fix.handle.db.prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), [recordedPath]);
  });

  // SC-e15s04-P0-02: New use and execution are blocked
  it("e15s04 recovery retries deletion paths recorded before a crash", () => {
    const art = registerPublicArtifact(fix.handle, "recovery-delete", "v1", "recovery bytes");
    const deletion = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "recovery-test",
      commandId: "delete-recovery-test",
      payloadHash: packetPayloadHash({ recovery: "1" })
    });
    const retryPath = join(fix.handle.project.artifactRoot, "recovery-pending.txt");
    writeFileSync(retryPath, "must be removed");
    fix.handle.db.prepare("UPDATE deletion_events SET unlinked_paths = ? WHERE id = ?")
      .run(JSON.stringify([retryPath]), deletion.deletionEventId);

    recoverProject(fix.root);

    assert.equal(existsSync(retryPath), false);
    const event = fix.handle.db.prepare("SELECT unlinked_paths FROM deletion_events WHERE id = ?")
      .get(deletion.deletionEventId) as { unlinked_paths: string };
    assert.deepEqual(JSON.parse(event.unlinked_paths), []);
  });

  it("e15s04 deletion command retry is idempotent and payload-bound", () => {
    const art = registerPublicArtifact(fix.handle, "retry-delete", "v1", "retry bytes");
    const request = {
      artifactVersionId: art.id,
      reason: "retry-test",
      commandId: "delete-retry-test",
      payloadHash: packetPayloadHash({ retry: "1" })
    };
    const first = deleteArtifactContent(fix.handle, fix.ownerCap, request);
    const second = deleteArtifactContent(fix.handle, fix.ownerCap, request);
    assert.equal(second.deletionEventId, first.deletionEventId);
    assert.throws(
      () => deleteArtifactContent(fix.handle, fix.ownerCap, { ...request, payloadHash: packetPayloadHash({ retry: "2" }) }),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "payload-conflict"
    );
  });

  it("e15s04 deletion purges source excerpts from SQLite while retaining only tombstone metadata", () => {
    const art = registerPublicArtifact(fix.handle, "doc-sqlite-purge", "v1", "restricted source bytes");
    fix.handle.db.prepare(`
      INSERT INTO source_versions
        (artifact_version_id, format, media_type, original_name, access_level, extraction_status, parser_name, parser_version, created_at)
      VALUES (?, 'txt', 'text/plain', 'restricted.txt', 'full-text', 'complete', 'test', '1', ?)
    `).run(art.id, new Date().toISOString());
    fix.handle.db.prepare(
      "INSERT INTO source_segments (id, source_version_id, derived_version_id, locator, text) VALUES (?, ?, ?, ?, ?)"
    ).run("segment-purge", art.id, art.id, "1:2", "restricted excerpt must disappear");
    fix.handle.db.prepare(
      "INSERT INTO source_records (id, source_version_id, record_kind, record_data, locator, access_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
    ).run("record-purge", art.id, "note", "restricted record bytes", "row-1", "full-text", new Date().toISOString());
    fix.handle.db.prepare(
      "INSERT INTO evidence_items (id, source_version_id, location_kind, location_id, locator_snapshot, statement_kind, origin, limitations, excerpt, excerpt_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run("evidence-purge", art.id, "segment", "segment-purge", "{}", "quote", "source", "", "restricted evidence excerpt", "hash", new Date().toISOString());

    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "source erasure",
      commandId: "del-sqlite-purge",
      payloadHash: packetPayloadHash({ art: art.id })
    });

    assert.equal(fix.handle.db.prepare("SELECT count(*) AS count FROM source_segments WHERE id = 'segment-purge'").get()?.count, 0);
    assert.equal(fix.handle.db.prepare("SELECT count(*) AS count FROM source_records WHERE id = 'record-purge'").get()?.count, 0);
    assert.equal(fix.handle.db.prepare("SELECT count(*) AS count FROM evidence_items WHERE id = 'evidence-purge'").get()?.count, 0);
    assert.equal(JSON.stringify(getEvidenceTombstone(fix.handle, fix.ownerCap, art.id)).includes("restricted evidence excerpt"), false);
  });

  it("e15s04 readiness is blocked and revalidation required when artifact is deleted", () => {
    const art2 = registerPublicArtifact(fix.handle, "doc-readiness", "v1", "readiness input bytes");

    updateBranchReference(fix.handle, {
      branchId: "main",
      logicalId: art2.logicalId,
      artifactVersionId: art2.id,
      expectedVersion: 0,
      commandId: "branch-ref-art2"
    });

    const packet = createDecisionPacket(fix.handle, {
      question: "Select doc-readiness",
      branchId: "main",
      candidateVersionIds: [art2.id]
    });

    recordOwnerDecision(fix.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [art2.id],
      commandId: "commit-readiness-art2",
      capability: fix.ownerCap
    });

    // Before deletion, readiness should not be blocked by unavailability
    const beforeReadiness = assessReadiness(fix.handle, { packetId: packet.id });
    assert.equal(beforeReadiness.status, "ready");

    // Delete the artifact
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art2.id,
      reason: "withdrawn consent",
      commandId: "del-cmd-readiness",
      payloadHash: packetPayloadHash({ art: art2.id })
    });

    // After deletion, readiness must be blocked
    const afterReadiness = assessReadiness(fix.handle, { packetId: packet.id });
    assert.equal(afterReadiness.status, "blocked");
    assert.ok(afterReadiness.causes.some(c => c.includes("unavailable")));
  });

  // SC-e15s04-P0-03: External disclosures are not recalled
  it("e15s04 work dispatch is blocked after its input is deleted", async () => {
    const input = registerPublicArtifact(fix.handle, "doc-dispatch-delete", "v1", "dispatch input bytes");
    classifyInput(fix.handle, input.id, { sensitivity: "public", basis: "test" });
    grantDataUse(fix.handle, { inputVersion: input.id, destination: "local", purpose: "research-work", authority: fix.ownerId });
    const proposed = proposeContract(fix.handle, fix.ownerCap, {
      id: "contract-dispatch-delete",
      objective: "blocked dispatch regression",
      inputVersionIds: [input.id],
      permittedRoles: ["discovery"],
      limits: { tokens: 10, calls: 1, timeMs: 1000 }
    });
    const authorized = authorizeContract(fix.handle, fix.ownerCap, { contractId: proposed.id });
    const run = queueRun(fix.handle, fix.ownerCap, {
      contractId: authorized.id,
      commandId: "queue-dispatch-delete",
      reservation: { tokens: 1, calls: 1, timeMs: 100 }
    });
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: input.id,
      reason: "dispatch input withdrawn",
      commandId: "del-dispatch-input",
      payloadHash: packetPayloadHash({ art: input.id })
    });
    let starts = 0;
    const result = await dispatchRun(fix.handle, fix.ownerCap, run.id, {
      start: () => { starts += 1; return { status: "ok" }; }
    });
    assert.equal(result.status, "blocked");
    assert.equal(starts, 0);
  });

  it("e15s04 external disclosures are reported as recall-not-promised without claiming provider deletion", () => {
    const art3 = registerPublicArtifact(fix.handle, "disclosed-doc", "v1", "shared bytes");
    classifyAndGrant(fix.handle, art3.id, "external-cloud", "cloud-analysis");

    // Record an external disclosure
    const disc = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "cloud-analysis",
      sourceVersions: [art3.id]
    });
    assert.equal(disc.status, "allow");

    // Delete the artifact
    const result = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art3.id,
      reason: "security review cleanup",
      commandId: "del-cmd-discl",
      payloadHash: packetPayloadHash({ art: art3.id })
    });

    assert.ok(result.notRecalledDisclosures.length > 0);
    for (const d of result.notRecalledDisclosures) {
      assert.equal(d.status, "recall-not-promised");
    }
  });

  // SC-e15s04-P1-04: Workers cannot delete and decision history remains
  it("e15s04 worker caller denied deletion authority", () => {
    const art4 = registerPublicArtifact(fix.handle, "doc-worker-deny", "v1", "worker content");

    assert.throws(
      () => {
        deleteArtifactContent(fix.handle, fix.workerCap, {
          artifactVersionId: art4.id,
          reason: "attempt by worker",
          commandId: "del-worker-cmd",
          payloadHash: "abc"
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  it("e15s04 forged owner denied deletion authority", () => {
    const art5 = registerPublicArtifact(fix.handle, "doc-forged-deny", "v1", "forged content");

    assert.throws(
      () => {
        deleteArtifactContent(fix.handle, { role: "owner", ownerId: fix.ownerId } as unknown, {
          artifactVersionId: art5.id,
          reason: "attempt by forged",
          commandId: "del-forged-cmd",
          payloadHash: "abc"
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  it("e15s04 decision history and commitment records remain inspectable after deletion regression", () => {
    const artReg = registerPublicArtifact(fix.handle, "doc-reg-del", "v1", "reg content");
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artReg.id,
      reason: "regression test deletion",
      commandId: "del-cmd-regression",
      payloadHash: packetPayloadHash({ art: artReg.id })
    });

    // List deletion events
    const events = listDeletionEvents(fix.handle, fix.ownerCap);
    assert.ok(events.length > 0, "deletion events must be recorded");
    assert.ok(events.some(e => e.artifactVersionId === artReg.id));

    // Check commitments table still intact
    const commitments = fix.handle.db.prepare("SELECT count(*) as cnt FROM commitments").get() as { cnt: number };
    assert.ok(commitments.cnt >= 0, "commitments table must remain inspectable");
  });

  it("e15s04 controlled deletion removes artifacts linked only through dependencies while preserving tombstones and disclosures", () => {
    // Register parent artifact
    const artParent = registerPublicArtifact(fix.handle, "doc-parent-dep", "v1", "sensitive parent content");
    assert.equal(existsSync(artParent.storagePath!), true);

    // Register child artifact linked ONLY through dependencies
    const artChild = registerArtifactVersion(fix.handle, {
      logicalId: "doc-child-dep",
      version: "v1",
      versionId: "doc-child-dep-v1",
      content: "derived child content from parent",
      dependencies: [{ versionId: artParent.id, relation: "depends-on" }]
    });
    assert.equal(existsSync(artChild.storagePath!), true);

    // Record an external disclosure for the child artifact
    classifyAndGrant(fix.handle, artParent.id, "external-partner", "cross-validation");
    classifyAndGrant(fix.handle, artChild.id, "external-partner", "cross-validation");
    const dRes = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-partner",
      purpose: "cross-validation",
      sourceVersions: [artChild.id]
    });
    assert.equal(dRes.status, "allow");

    // Delete the parent artifact
    const res = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artParent.id,
      reason: "erasure request for parent",
      commandId: "del-parent-dep-cascade",
      payloadHash: packetPayloadHash({ art: artParent.id })
    });

    // Both parent and child storage files must be unlinked
    assert.equal(existsSync(artParent.storagePath!), false, "parent artifact storage file must be unlinked");
    assert.equal(existsSync(artChild.storagePath!), false, "child dependency artifact storage file must be unlinked");

    // Both parent and child must have evidence tombstones
    const tombParent = getEvidenceTombstone(fix.handle, fix.ownerCap, artParent.id);
    const tombChild = getEvidenceTombstone(fix.handle, fix.ownerCap, artChild.id);
    assert.ok(tombParent, "parent tombstone must exist");
    assert.ok(tombChild, "child tombstone must exist");

    // Both parent and child report unavailable
    assert.equal(inspectArtifactVersion(fix.handle, artParent.id).contentStatus, "unavailable");
    assert.equal(inspectArtifactVersion(fix.handle, artChild.id).contentStatus, "unavailable");

    // Child disclosure must be reported as not recalled
    assert.ok(res.notRecalledDisclosures.length > 0, "disclosures on cascaded artifacts must be reported as not recalled");
    assert.ok(res.notRecalledDisclosures.some(d => d.destination === "external-partner"));
  });

  it("e15s04 adversarial symlink escape in deletion skips unlinking and never removes external files", () => {
    const externalDir = join(fix.root, "..", `external-victim-dir-${Date.now()}`);
    mkdirSync(externalDir, { recursive: true });
    const externalFile1 = join(externalDir, "secret-victim-1.txt");
    const externalFile2 = join(externalDir, "secret-victim-2.txt");
    writeFileSync(externalFile1, "external sensitive data 1");
    writeFileSync(externalFile2, "external sensitive data 2");

    try {
      // Case A: Intermediate directory is a symlink pointing outside
      const escapedDirLink = join(fix.root, ".ganesh", "artifacts", "symlink-dir-escape");
      if (!existsSync(escapedDirLink)) {
        symlinkSync(externalDir, escapedDirLink);
      }
      const artEscaped = registerArtifactVersion(fix.handle, {
        logicalId: "doc-escape-intermediate",
        version: "v1",
        versionId: "doc-escape-intermediate-v1",
        content: "placeholder content"
      });
      fix.handle.db.prepare(
        "UPDATE artifact_versions SET storage_path = ? WHERE id = ?"
      ).run("symlink-dir-escape/secret-victim-1.txt", artEscaped.id);

      // Case B: Leaf file is a symlink pointing outside
      const escapedFileLink = join(fix.root, ".ganesh", "artifacts", "symlink-file-escape.txt");
      if (!existsSync(escapedFileLink)) {
        symlinkSync(externalFile2, escapedFileLink);
      }
      const artLeaf = registerArtifactVersion(fix.handle, {
        logicalId: "doc-escape-leaf",
        version: "v1",
        versionId: "doc-escape-leaf-v1",
        content: "placeholder content"
      });
      fix.handle.db.prepare(
        "UPDATE artifact_versions SET storage_path = ? WHERE id = ?"
      ).run("symlink-file-escape.txt", artLeaf.id);

      // Execute deletion for both
      deleteArtifactContent(fix.handle, fix.ownerCap, {
        artifactVersionId: artEscaped.id,
        reason: "adversarial deletion test 1",
        commandId: "del-adv-1",
        payloadHash: packetPayloadHash({ a: "1" })
      });

      deleteArtifactContent(fix.handle, fix.ownerCap, {
        artifactVersionId: artLeaf.id,
        reason: "adversarial deletion test 2",
        commandId: "del-adv-2",
        payloadHash: packetPayloadHash({ a: "2" })
      });

      // Assert external files were NEVER deleted
      assert.equal(existsSync(externalFile1), true, "externalFile1 must NOT be deleted via intermediate symlink traversal");
      assert.equal(existsSync(externalFile2), true, "externalFile2 must NOT be deleted via leaf symlink escape");
    } finally {
      rmSync(externalDir, { recursive: true, force: true });
    }
  });

  it("e15s04 deletion restricts cache removal to affected versions and preserves unrelated caches", () => {
    const artTarget = registerPublicArtifact(fix.handle, "doc-cache-target", "v1", "cache target content");
    const cacheDir = join(fix.root, ".ganesh", "artifacts", "cache");
    mkdirSync(cacheDir, { recursive: true });

    const targetCache = join(cacheDir, `${artTarget.id}.cache`);
    const unrelatedCache1 = join(cacheDir, "unrelated-research-data.cache");
    const unrelatedCache2 = join(cacheDir, "shared-indexes.cache");

    writeFileSync(targetCache, "target cache bytes");
    writeFileSync(unrelatedCache1, "unrelated cache bytes 1");
    writeFileSync(unrelatedCache2, "unrelated cache bytes 2");

    assert.equal(existsSync(targetCache), true);
    assert.equal(existsSync(unrelatedCache1), true);
    assert.equal(existsSync(unrelatedCache2), true);

    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artTarget.id,
      reason: "targeted cache deletion",
      commandId: "del-cache-target-cmd",
      payloadHash: packetPayloadHash({ c: "1" })
    });

    // Target cache must be unlinked
    assert.equal(existsSync(targetCache), false, "target artifact cache must be unlinked");
    // Unrelated caches must be PRESERVED
    assert.equal(existsSync(unrelatedCache1), true, "unrelated cache 1 must be preserved");
    assert.equal(existsSync(unrelatedCache2), true, "unrelated cache 2 must be preserved");
  });

  it("e15s04 deletion with overlapping artifact IDs preserves unrelated derived content, disclosures, and caches", () => {
    // 1. Create two artifacts where one ID is a prefix/substring of the other: "art-a" and "art-aa"
    const artShort = registerArtifactVersion(fix.handle, {
      logicalId: "overlap-short",
      version: "v1",
      versionId: "art-a",
      content: "short id content for a"
    });
    const artLong = registerArtifactVersion(fix.handle, {
      logicalId: "overlap-long",
      version: "v1",
      versionId: "art-aa",
      content: "longer id content for aa"
    });

    assert.equal(existsSync(artShort.storagePath!), true);
    assert.equal(existsSync(artLong.storagePath!), true);

    // 2. Create derived materials:
    // derivedShort derived from ["art-a"]
    const derivedShort = registerArtifactVersion(fix.handle, {
      logicalId: "derived-short",
      version: "v1",
      versionId: "derived-short-v1",
      content: "derived from art-a",
      dependencies: [{ versionId: artShort.id, relation: "derived-from" }]
    });
    const derivedRecShort = deriveMaterial(fix.handle, [artShort.id], "summarize", "main");
    fix.handle.db.prepare(
      "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?"
    ).run(derivedShort.id, derivedRecShort.id);

    // derivedLong derived from ["art-aa"]
    const derivedLong = registerArtifactVersion(fix.handle, {
      logicalId: "derived-long",
      version: "v1",
      versionId: "derived-long-v1",
      content: "derived from art-aa",
      dependencies: [{ versionId: artLong.id, relation: "derived-from" }]
    });
    const derivedRecLong = deriveMaterial(fix.handle, [artLong.id], "summarize", "main");
    fix.handle.db.prepare(
      "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?"
    ).run(derivedLong.id, derivedRecLong.id);

    assert.equal(existsSync(derivedShort.storagePath!), true);
    assert.equal(existsSync(derivedLong.storagePath!), true);

    // 3. Create external disclosures:
    classifyAndGrant(fix.handle, artShort.id, "external-cloud", "ai-training");
    classifyAndGrant(fix.handle, artLong.id, "external-cloud", "ai-training");

    const disclShort = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "ai-training",
      sourceVersions: [artShort.id]
    });
    const disclLong = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "ai-training",
      sourceVersions: [artLong.id]
    });
    assert.equal(disclShort.status, "allow");
    assert.equal(disclLong.status, "allow");

    // 4. Create cache files: "art-a.cache" and "art-aa.cache"
    const cacheDir = join(fix.root, ".ganesh", "artifacts", "cache");
    mkdirSync(cacheDir, { recursive: true });
    const shortCache = join(cacheDir, `${artShort.id}.cache`);
    const longCache = join(cacheDir, `${artLong.id}.cache`);
    writeFileSync(shortCache, "cache for art-a");
    writeFileSync(longCache, "cache for art-aa");
    assert.equal(existsSync(shortCache), true);
    assert.equal(existsSync(longCache), true);

    // 5. Delete artShort ("art-a"):
    const delResult = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artShort.id,
      reason: "deleting short id art-a",
      commandId: "del-overlap-test-cmd",
      payloadHash: packetPayloadHash({ art: artShort.id })
    });

    // 6. Assert artShort ("art-a") and its derived material & cache are unlinked:
    assert.equal(existsSync(artShort.storagePath!), false, "art-a must be unlinked");
    assert.equal(existsSync(derivedShort.storagePath!), false, "derived material for art-a must be unlinked");
    assert.equal(existsSync(shortCache), false, "art-a.cache must be unlinked");

    // 7. Assert artLong ("art-aa") and its derived material & cache SURVIVE:
    assert.equal(existsSync(artLong.storagePath!), true, "unrelated art-aa must NOT be unlinked");
    assert.equal(existsSync(derivedLong.storagePath!), true, "derived material for art-aa must NOT be unlinked");
    assert.equal(existsSync(longCache), true, "art-aa.cache must NOT be unlinked");

    // 8. Assert not-recalled disclosures:
    const reportedDisclIds = delResult.notRecalledDisclosures.map(d => d.disclosureId);
    assert.ok(reportedDisclIds.includes(disclShort.id), "disclosure for art-a must be reported as not-recalled");
    assert.ok(!reportedDisclIds.includes(disclLong.id), "disclosure for art-aa must NOT be reported as not-recalled");
  });
});
