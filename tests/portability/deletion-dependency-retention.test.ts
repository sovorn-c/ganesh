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

describe("Controlled deletion dependency retention", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-deletion-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  it("controlled deletion removes artifacts linked only through dependencies while preserving tombstones and disclosures", () => {
    // Register parent artifact
    const artParent = registerPublicArtifact(
      fix.handle,
      "doc-parent-dep",
      "v1",
      "sensitive parent content",
    );
    assert.equal(existsSync(artParent.storagePath!), true);

    // Register child artifact linked ONLY through dependencies
    const artChild = registerArtifactVersion(fix.handle, {
      logicalId: "doc-child-dep",
      version: "v1",
      versionId: "doc-child-dep-v1",
      content: "derived child content from parent",
      dependencies: [{ versionId: artParent.id, relation: "depends-on" }],
    });
    assert.equal(existsSync(artChild.storagePath!), true);

    // Record an external disclosure for the child artifact
    classifyAndGrant(
      fix.handle,
      artParent.id,
      "external-partner",
      "cross-validation",
    );
    classifyAndGrant(
      fix.handle,
      artChild.id,
      "external-partner",
      "cross-validation",
    );
    const dRes = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-partner",
      purpose: "cross-validation",
      sourceVersions: [artChild.id],
    });
    assert.equal(dRes.status, "allow");

    // Delete the parent artifact
    const res = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artParent.id,
      reason: "erasure request for parent",
      commandId: "del-parent-dep-cascade",
      payloadHash: packetPayloadHash({ art: artParent.id }),
    });

    // Both parent and child storage files must be unlinked
    assert.equal(
      existsSync(artParent.storagePath!),
      false,
      "parent artifact storage file must be unlinked",
    );
    assert.equal(
      existsSync(artChild.storagePath!),
      false,
      "child dependency artifact storage file must be unlinked",
    );

    // Both parent and child must have evidence tombstones
    const tombParent = getEvidenceTombstone(
      fix.handle,
      fix.ownerCap,
      artParent.id,
    );
    const tombChild = getEvidenceTombstone(
      fix.handle,
      fix.ownerCap,
      artChild.id,
    );
    assert.ok(tombParent, "parent tombstone must exist");
    assert.ok(tombChild, "child tombstone must exist");

    // Both parent and child report unavailable
    assert.equal(
      inspectArtifactVersion(fix.handle, artParent.id).contentStatus,
      "unavailable",
    );
    assert.equal(
      inspectArtifactVersion(fix.handle, artChild.id).contentStatus,
      "unavailable",
    );

    // Child disclosure must be reported as not recalled
    assert.ok(
      res.notRecalledDisclosures.length > 0,
      "disclosures on cascaded artifacts must be reported as not recalled",
    );
    assert.ok(
      res.notRecalledDisclosures.some(
        (d) => d.destination === "external-partner",
      ),
    );
  });

  it("deletion with overlapping artifact IDs preserves unrelated derived content, disclosures, and caches", () => {
    // 1. Create two artifacts where one ID is a prefix/substring of the other: "art-a" and "art-aa"
    const artShort = registerArtifactVersion(fix.handle, {
      logicalId: "overlap-short",
      version: "v1",
      versionId: "art-a",
      content: "short id content for a",
    });
    const artLong = registerArtifactVersion(fix.handle, {
      logicalId: "overlap-long",
      version: "v1",
      versionId: "art-aa",
      content: "longer id content for aa",
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
      dependencies: [{ versionId: artShort.id, relation: "derived-from" }],
    });
    const derivedRecShort = deriveMaterial(
      fix.handle,
      [artShort.id],
      "summarize",
      "main",
    );
    fix.handle.db
      .prepare(
        "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?",
      )
      .run(derivedShort.id, derivedRecShort.id);

    // derivedLong derived from ["art-aa"]
    const derivedLong = registerArtifactVersion(fix.handle, {
      logicalId: "derived-long",
      version: "v1",
      versionId: "derived-long-v1",
      content: "derived from art-aa",
      dependencies: [{ versionId: artLong.id, relation: "derived-from" }],
    });
    const derivedRecLong = deriveMaterial(
      fix.handle,
      [artLong.id],
      "summarize",
      "main",
    );
    fix.handle.db
      .prepare(
        "UPDATE derived_materials SET candidate_version_id = ? WHERE id = ?",
      )
      .run(derivedLong.id, derivedRecLong.id);

    assert.equal(existsSync(derivedShort.storagePath!), true);
    assert.equal(existsSync(derivedLong.storagePath!), true);

    // 3. Create external disclosures:
    classifyAndGrant(fix.handle, artShort.id, "external-cloud", "ai-training");
    classifyAndGrant(fix.handle, artLong.id, "external-cloud", "ai-training");

    const disclShort = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "ai-training",
      sourceVersions: [artShort.id],
    });
    const disclLong = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "ai-training",
      sourceVersions: [artLong.id],
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
      payloadHash: packetPayloadHash({ art: artShort.id }),
    });

    // 6. Assert artShort ("art-a") and its derived material & cache are unlinked:
    assert.equal(
      existsSync(artShort.storagePath!),
      false,
      "art-a must be unlinked",
    );
    assert.equal(
      existsSync(derivedShort.storagePath!),
      false,
      "derived material for art-a must be unlinked",
    );
    assert.equal(existsSync(shortCache), false, "art-a.cache must be unlinked");

    // 7. Assert artLong ("art-aa") and its derived material & cache SURVIVE:
    assert.equal(
      existsSync(artLong.storagePath!),
      true,
      "unrelated art-aa must NOT be unlinked",
    );
    assert.equal(
      existsSync(derivedLong.storagePath!),
      true,
      "derived material for art-aa must NOT be unlinked",
    );
    assert.equal(
      existsSync(longCache),
      true,
      "art-aa.cache must NOT be unlinked",
    );

    // 8. Assert not-recalled disclosures:
    const reportedDisclIds = delResult.notRecalledDisclosures.map(
      (d) => d.disclosureId,
    );
    assert.ok(
      reportedDisclIds.includes(disclShort.id),
      "disclosure for art-a must be reported as not-recalled",
    );
    assert.ok(
      !reportedDisclIds.includes(disclLong.id),
      "disclosure for art-aa must NOT be reported as not-recalled",
    );
  });
});
