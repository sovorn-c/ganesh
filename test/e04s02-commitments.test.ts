// story: e04s02
// scenario: SC-e04s02-P0-01, SC-e04s02-P0-02, SC-e04s02-P1-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  archiveDecision,
  assessReadiness,
  createBranch,
  createDecisionPacket,
  createOwnerCapability,
  getDecisionPacket,
  listCommitmentHistory,
  listCommitments,
  listReadiness,
  recordOwnerDecision,
  reopenDecision,
  reviseDecisionPacket,
  supersedeDecision,
  updateBranchReference,
  classifyInput,
  grantDataUse,
  withdrawDataUse
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

function owner() {
  return createOwnerCapability("owner-test");
}

test("e04s02 filters commitment history by branch", () => {
  const fixture = projectFixture();
  try {
    const candidate = artifact(fixture.handle, "branch-question", "v1", "question");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "branch-question", artifactVersionId: candidate.id, expectedVersion: 0, commandId: "branch-history-ref"
    });
    const alternate = createBranch(fixture.handle, { branchId: "alt", name: "alternate" });
    const mainPacket = createDecisionPacket(fixture.handle, {
      question: "Main question", branchId: "main", candidateVersionIds: [candidate.id]
    });
    recordOwnerDecision(fixture.handle, {
      packetId: mainPacket.id, disposition: "approved", selectedCandidateVersionIds: [candidate.id], commandId: "branch-history-main", capability: owner()
    });
    const alternatePacket = createDecisionPacket(fixture.handle, {
      question: "Alternate question", branchId: alternate.id, candidateVersionIds: [candidate.id]
    });
    recordOwnerDecision(fixture.handle, {
      packetId: alternatePacket.id, disposition: "approved", selectedCandidateVersionIds: [candidate.id], commandId: "branch-history-alt", capability: owner()
    });

    const alternateHistory = listCommitmentHistory(fixture.handle, { branchId: alternate.id });
    assert.ok(alternateHistory.length > 0);
    assert.ok(alternateHistory.every((item) => item.packetId === alternatePacket.id));
    assert.equal(alternateHistory.some((item) => item.packetId === mainPacket.id), false);
  } finally {
    disposeFixture(fixture);
  }
});

test("e04s02 preserves lifecycle history inspection across revision, reopen, archive, and supersession", () => {
  const fixture = projectFixture();
  try {
    const first = artifact(fixture.handle, "question", "v1", "first");
    const replacement = artifact(fixture.handle, "question", "v2", "replacement");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 0, commandId: "lifecycle-first"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Question",
      branchId: "main",
      candidateVersionIds: [first.id]
    });
    const deferred = recordOwnerDecision(fixture.handle, {
      packetId: packet.id,
      disposition: "deferred",
      selectedCandidateVersionIds: [first.id],
      commandId: "lifecycle-defer",
      capability: owner()
    });
    assert.equal(deferred.status, "deferred");
    assert.equal(reopenDecision(fixture.handle, {
      packetId: packet.id, commandId: "lifecycle-reopen", capability: owner()
    }).status, "reopened");
    assert.equal(archiveDecision(fixture.handle, {
      packetId: packet.id, commandId: "lifecycle-archive", capability: owner()
    }).status, "archived");
    assert.equal(getDecisionPacket(fixture.handle, packet.id)?.status, "archived");

    const revised = reviseDecisionPacket(fixture.handle, {
      priorPacketId: packet.id,
      question: "Question revised",
      branchId: "main",
      candidateVersionIds: [replacement.id],
      rationale: "Owner requested one exact revision."
    });
    assert.equal(revised.parentPacketId, packet.id);
    assert.equal(revised.packetVersion, 2);
    assert.equal(supersedeDecision(fixture.handle, {
      packetId: packet.id,
      replacementPacketId: revised.id,
      commandId: "lifecycle-supersede",
      capability: owner()
    }).status, "superseded");
    assert.equal(getDecisionPacket(fixture.handle, packet.id)?.status, "superseded");
    assert.equal(listCommitmentHistory(fixture.handle, { packetId: packet.id }).length >= 3, true);
    assert.equal(listCommitmentHistory(fixture.handle, { packetId: revised.id }).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});

test("e04s02 separates historical approval from current readiness and persists causes", () => {
  const fixture = projectFixture();
  try {
    const source = artifact(fixture.handle, "source", "v1", "source one");
    const sourceReplacement = artifact(fixture.handle, "source", "v2", "source two");
    const candidate = artifact(fixture.handle, "analysis", "v1", "analysis", [{ versionId: source.id }]);
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "source", artifactVersionId: source.id, expectedVersion: 0, commandId: "ready-source"
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "analysis", artifactVersionId: candidate.id, expectedVersion: 1, commandId: "ready-analysis"
    });
    for (const id of [source.id, candidate.id]) {
      classifyInput(fixture.handle, id, { sensitivity: "confidential", basis: "synthetic fixture" });
      grantDataUse(fixture.handle, {
        inputVersion: id, destination: "local-worker", purpose: "analysis", authority: "owner-test"
      });
    }
    const packet = createDecisionPacket(fixture.handle, {
      question: "Adopt analysis",
      branchId: "main",
      candidateVersionIds: [candidate.id],
      dependencyVersionIds: [source.id]
    });
    const decision = recordOwnerDecision(fixture.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [candidate.id],
      dependencyVersionIds: [source.id],
      commandId: "ready-approve",
      capability: owner()
    });
    assert.ok(decision.commitmentId);
    const ready = assessReadiness(fixture.handle, {
      commitmentId: decision.commitmentId,
      destination: "local-worker",
      purpose: "analysis",
      commandId: "readiness-ready"
    });
    assert.equal(ready.status, "ready");

    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "source", artifactVersionId: sourceReplacement.id, expectedVersion: 2, commandId: "ready-source-change"
    });
    const needsReview = assessReadiness(fixture.handle, {
      commitmentId: decision.commitmentId,
      destination: "local-worker",
      purpose: "analysis",
      commandId: "readiness-impact"
    });
    assert.equal(needsReview.status, "needs-review");
    assert.ok(needsReview.causes.some((cause) => /branch|dependency|impact/i.test(cause)));

  } finally {
    disposeFixture(fixture);
  }
});

test("e04s02 readiness records remain inspectable after policy withdrawal regression", () => {
  const fixture = projectFixture();
  try {
    const candidate = artifact(fixture.handle, "protocol", "v1", "protocol");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "protocol", artifactVersionId: candidate.id, expectedVersion: 0, commandId: "history-protocol"
    });
    classifyInput(fixture.handle, candidate.id, { sensitivity: "confidential", basis: "synthetic" });
    const grant = grantDataUse(fixture.handle, {
      inputVersion: candidate.id, destination: "local-worker", purpose: "review", authority: "owner-test"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Review protocol", branchId: "main", candidateVersionIds: [candidate.id]
    });
    const decision = recordOwnerDecision(fixture.handle, {
      packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [candidate.id], commandId: "history-approve", capability: owner()
    });
    assert.ok(decision.commitmentId);
    assert.equal(assessReadiness(fixture.handle, {
      commitmentId: decision.commitmentId, destination: "local-worker", purpose: "review", commandId: "history-ready"
    }).status, "ready");
    withdrawDataUse(fixture.handle, grant.id, "withdrawn for test", "owner-test");
    const blocked = assessReadiness(fixture.handle, {
      commitmentId: decision.commitmentId, destination: "local-worker", purpose: "review", commandId: "history-blocked"
    });
    assert.equal(blocked.status, "blocked");
    assert.ok(listReadiness(fixture.handle, { commitmentId: decision.commitmentId }).length >= 2);
    assert.equal(archiveDecision(fixture.handle, {
      packetId: packet.id, commandId: "history-archive", capability: owner()
    }).status, "archived");
    assert.equal(listCommitments(fixture.handle)[0]?.status, "archived");
    assert.ok(listCommitmentHistory(fixture.handle, { commitmentId: decision.commitmentId }).length >= 3);
  } finally {
    disposeFixture(fixture);
  }
});