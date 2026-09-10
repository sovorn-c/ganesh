// story: e04s01
// scenario: SC-e04s01-P0-01, SC-e04s01-P0-02, SC-e04s01-P1-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  createDecisionPacket,
  getDecisionPacket,
  listDecisionHistory,
  recordOwnerDecision,
  updateBranchReference,
  createOwnerCapability,
  ProjectStoreError
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("publishes exact packets, blocks forged authority, and redacts regression data", () => {
  const fixture = projectFixture();
  try {
    const dependency = artifact(fixture.handle, "method", "v1", "synthetic method");
    const candidate = artifact(fixture.handle, "question", "v1", "synthetic question", [{ versionId: dependency.id }]);
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "method", artifactVersionId: dependency.id, expectedVersion: 0, commandId: "packet-method"
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: candidate.id, expectedVersion: 1, commandId: "packet-question"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Select the synthetic question",
      branchId: "main",
      candidateVersionIds: [candidate.id],
      dependencyVersionIds: [dependency.id],
      reviewReferences: ["review-1"],
      permittedActions: ["approved", "rejected", "deferred"]
    });
    assert.equal(packet.packetVersion, 1);
    assert.equal(packet.branchRevision, 2);
    assert.deepEqual(packet.candidateVersionIds, [candidate.id]);
    assert.deepEqual(packet.dependencyVersionIds, [dependency.id]);
    const inspected = getDecisionPacket(fixture.handle, packet.id);
    assert.deepEqual(inspected, packet);
    assert.equal(recordOwnerDecision(fixture.handle, {
      packetId: packet.id, branchId: "wrong-branch", disposition: "approved",
      selectedCandidateVersionIds: [candidate.id], commandId: "wrong-branch-command",
      capability: createOwnerCapability("owner-test")
    }).status, "rejected");
    assert.equal(listDecisionHistory(fixture.handle, { packetId: packet.id }).length, 0);

    const result = recordOwnerDecision(fixture.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [candidate.id],
      dependencyVersionIds: [dependency.id],
      rationale: "The exact synthetic option is suitable.",
      commandId: "owner-approve-packet",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(result.status, "approved");
    assert.ok(result.commitmentId);
    assert.equal(listDecisionHistory(fixture.handle, { packetId: packet.id }).length, 1);
    assert.ok(!JSON.stringify(result).includes("synthetic question"));

    assert.throws(
      () => recordOwnerDecision(fixture.handle, {
        packetId: packet.id,
        disposition: "approved",
        selectedCandidateVersionIds: [candidate.id],
        dependencyVersionIds: [dependency.id],
        rationale: "forged",
        commandId: "forged-command",
        capability: { role: "owner", ownerId: "owner-test" }
      }),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
    );
  } finally {
    disposeFixture(fixture);
  }
});

test("rejects stale and duplicate owner actions without partial transaction state", () => {
  const fixture = projectFixture();
  try {
    const first = artifact(fixture.handle, "question", "v1", "first");
    const second = artifact(fixture.handle, "question", "v2", "second");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 0, commandId: "stale-first"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Choose a question",
      branchId: "main",
      candidateVersionIds: [first.id]
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: second.id, expectedVersion: 1, commandId: "stale-second"
    });
    const stale = recordOwnerDecision(fixture.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [first.id],
      commandId: "stale-owner-action",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(stale.status, "stale");
    assert.equal(listDecisionHistory(fixture.handle, { packetId: packet.id }).length, 0);

    const fresh = createDecisionPacket(fixture.handle, {
      question: "Choose a question again",
      branchId: "main",
      candidateVersionIds: [second.id]
    });
    const approved = recordOwnerDecision(fixture.handle, {
      packetId: fresh.id,
      disposition: "approved",
      selectedCandidateVersionIds: [second.id],
      commandId: "idempotent-owner-action",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(approved.status, "approved");
    assert.equal(recordOwnerDecision(fixture.handle, {
      packetId: fresh.id,
      disposition: "approved",
      selectedCandidateVersionIds: [second.id],
      commandId: "idempotent-owner-action",
      capability: createOwnerCapability("owner-test")
    }).status, "duplicate");
    assert.equal(recordOwnerDecision(fixture.handle, {
      packetId: fresh.id,
      disposition: "rejected",
      selectedCandidateVersionIds: [second.id],
      commandId: "idempotent-owner-action",
      capability: createOwnerCapability("owner-test")
    }).status, "rejected");

    const deferred = recordOwnerDecision(fixture.handle, {
      packetId: fresh.id,
      disposition: "deferred",
      selectedCandidateVersionIds: [second.id],
      commandId: "defer-owner-action",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(deferred.status, "deferred");
  } finally {
    disposeFixture(fixture);
  }
});