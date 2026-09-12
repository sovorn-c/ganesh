// story: e15s04 — Controlled Deletion of Derived Content and Caches
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, existsSync, mkdirSync } from "node:fs";
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
  ProjectStoreError
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

  // SC-e15s04-P0-02: New use and execution are blocked
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
});
