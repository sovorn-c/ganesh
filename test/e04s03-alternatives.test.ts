// story: e04s03
// scenario: SC-e04s03-P0-01, SC-e04s03-P0-02, SC-e04s03-P0-03, SC-e04s03-P1-04
import assert from "node:assert/strict";
import test from "node:test";
import {
  adoptBranchAlternative,
  compareBranchReferences,
  createBranch,
  createDecisionPacket,
  createOwnerCapability,
  listAlternativeImpact,
  listBranchReferences,
  updateBranchReference
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

test("e04s03 keeps alternatives isolated with branch snapshot regression coverage", () => {
  const fixture = projectFixture();
  try {
    const original = artifact(fixture.handle, "question", "v1", "original");
    const alternative = artifact(fixture.handle, "question", "v2", "alternative");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: original.id, expectedVersion: 0, commandId: "alternative-main"
    });
    const branch = createBranch(fixture.handle, { name: "alternative", branchId: "alternative" });
    updateBranchReference(fixture.handle, {
      branchId: branch.id, logicalId: "question", artifactVersionId: alternative.id, expectedVersion: 0, commandId: "alternative-edit"
    });
    assert.equal(listBranchReferences(fixture.handle, "main")[0].artifactVersionId, original.id);
    const comparison = compareBranchReferences(fixture.handle, "alternative", "main");
    assert.deepEqual(comparison.differences, [{
      logicalId: "question", sourceArtifactVersionId: alternative.id, destinationArtifactVersionId: original.id
    }]);
  } finally {
    disposeFixture(fixture);
  }
});

test("e04s03 adopts one reviewed exact alternative and marks transitive impacts", () => {
  const fixture = projectFixture();
  try {
    const sourceV1 = artifact(fixture.handle, "source", "v1", "old source");
    const sourceV2 = artifact(fixture.handle, "source", "v2", "new source");
    const analysis = artifact(fixture.handle, "analysis", "v1", "analysis", [{ versionId: sourceV1.id }]);
    const report = artifact(fixture.handle, "report", "v1", "report", [{ versionId: analysis.id }]);
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "source", artifactVersionId: sourceV1.id, expectedVersion: 0, commandId: "impact-source"
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "analysis", artifactVersionId: analysis.id, expectedVersion: 1, commandId: "impact-analysis"
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "report", artifactVersionId: report.id, expectedVersion: 2, commandId: "impact-report"
    });
    const branch = createBranch(fixture.handle, { name: "review-alternative", branchId: "review-alternative" });
    updateBranchReference(fixture.handle, {
      branchId: branch.id, logicalId: "source", artifactVersionId: sourceV2.id, expectedVersion: 0, commandId: "review-source"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Adopt corrected source",
      branchId: branch.id,
      candidateVersionIds: [sourceV2.id],
      dependencyVersionIds: [sourceV2.id]
    });
    const adoption = adoptBranchAlternative(fixture.handle, {
      packetId: packet.id,
      sourceBranchId: branch.id,
      destinationBranchId: "main",
      expectedDestinationRevision: 3,
      selectedCandidateVersionIds: [sourceV2.id],
      commandId: "adopt-corrected-source",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(adoption.status, "accepted");
    assert.equal(adoption.revision, 4);
    assert.equal(listBranchReferences(fixture.handle, "main").find((item) => item.logicalId === "source")?.artifactVersionId, sourceV2.id);
    assert.ok(adoption.impactedDependents.includes(analysis.id));
    assert.ok(adoption.impactedDependents.includes(report.id));
    assert.ok(listAlternativeImpact(fixture.handle, "main").some((item) => item.dependentVersionId === report.id && item.reviewStatus === "required"));

    assert.equal(adoptBranchAlternative(fixture.handle, {
      packetId: packet.id,
      sourceBranchId: branch.id,
      destinationBranchId: "main",
      expectedDestinationRevision: 3,
      selectedCandidateVersionIds: [sourceV2.id],
      commandId: "adopt-corrected-source",
      capability: createOwnerCapability("owner-test")
    }).status, "duplicate");
  } finally {
    disposeFixture(fixture);
  }
});

test("e04s03 rejects concurrent stale adoption without changing destination history", () => {
  const fixture = projectFixture();
  try {
    const first = artifact(fixture.handle, "question", "v1", "first");
    const second = artifact(fixture.handle, "question", "v2", "second");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 0, commandId: "adopt-stale-main"
    });
    const branch = createBranch(fixture.handle, { name: "adopt-stale-alt", branchId: "adopt-stale-alt" });
    updateBranchReference(fixture.handle, {
      branchId: branch.id, logicalId: "question", artifactVersionId: second.id, expectedVersion: 0, commandId: "adopt-stale-alt"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Stale adoption", branchId: branch.id, candidateVersionIds: [second.id]
    });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 1, commandId: "adopt-stale-destination-change"
    });
    const stale = adoptBranchAlternative(fixture.handle, {
      packetId: packet.id,
      sourceBranchId: branch.id,
      destinationBranchId: "main",
      expectedDestinationRevision: 1,
      selectedCandidateVersionIds: [second.id],
      commandId: "stale-adoption",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(stale.status, "stale");
    assert.equal(listBranchReferences(fixture.handle, "main").find((item) => item.logicalId === "question")?.artifactVersionId, first.id);
  } finally {
    disposeFixture(fixture);
  }
});