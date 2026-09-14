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

describe("Controlled deletion authority and disclosure", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-deletion-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  it("external disclosures are reported as recall-not-promised without claiming provider deletion", () => {
    const art3 = registerPublicArtifact(
      fix.handle,
      "disclosed-doc",
      "v1",
      "shared bytes",
    );
    classifyAndGrant(fix.handle, art3.id, "external-cloud", "cloud-analysis");

    // Record an external disclosure
    const disc = requestDisclosure(fix.handle, {
      operation: "export",
      destination: "external-cloud",
      purpose: "cloud-analysis",
      sourceVersions: [art3.id],
    });
    assert.equal(disc.status, "allow");

    // Delete the artifact
    const result = deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art3.id,
      reason: "security review cleanup",
      commandId: "del-cmd-discl",
      payloadHash: packetPayloadHash({ art: art3.id }),
    });

    assert.ok(result.notRecalledDisclosures.length > 0);
    for (const d of result.notRecalledDisclosures) {
      assert.equal(d.status, "recall-not-promised");
    }
  });

  // SC-e15s04-P1-04: Workers cannot delete and decision history remains
  it("worker caller denied deletion authority", () => {
    const art4 = registerPublicArtifact(
      fix.handle,
      "doc-worker-deny",
      "v1",
      "worker content",
    );

    assert.throws(
      () => {
        deleteArtifactContent(fix.handle, fix.workerCap, {
          artifactVersionId: art4.id,
          reason: "attempt by worker",
          commandId: "del-worker-cmd",
          payloadHash: "abc",
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
  });

  it("forged owner denied deletion authority", () => {
    const art5 = registerPublicArtifact(
      fix.handle,
      "doc-forged-deny",
      "v1",
      "forged content",
    );

    assert.throws(
      () => {
        deleteArtifactContent(
          fix.handle,
          { role: "owner", ownerId: fix.ownerId } as unknown,
          {
            artifactVersionId: art5.id,
            reason: "attempt by forged",
            commandId: "del-forged-cmd",
            payloadHash: "abc",
          },
        );
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
  });
});
