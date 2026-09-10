// story: e02s02
// scenario: SC-e02s02-P0-01, SC-e02s02-P0-02, SC-e02s02-P1-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  createBranch,
  getBranch,
  listBranchReferences,
  listHistory,
  listImpacts,
  openProject,
  promoteBranch,
  recordSharedSourceCorrection,
  updateBranchReference
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("branch snapshot history and isolation", () => {
  const fixture = projectFixture();
  try {
    const v1 = artifact(fixture.handle, "question", "v1", "first question");
    const v2 = artifact(fixture.handle, "question", "v2", "second question");
    assert.equal(updateBranchReference(fixture.handle, {
      branchId: "main",
      logicalId: "question",
      artifactVersionId: v1.id,
      expectedVersion: 0,
      commandId: "main-question-v1"
    }).status, "accepted");
    const candidate = createBranch(fixture.handle, { name: "candidate", branchId: "candidate" });
    assert.equal(updateBranchReference(fixture.handle, {
      branchId: candidate.id,
      logicalId: "question",
      artifactVersionId: v2.id,
      expectedVersion: 0,
      commandId: "candidate-question-v2"
    }).status, "accepted");
    assert.deepEqual(listBranchReferences(fixture.handle, "main"), [{ logicalId: "question", artifactVersionId: v1.id }]);
    assert.deepEqual(listBranchReferences(fixture.handle, "candidate"), [{ logicalId: "question", artifactVersionId: v2.id }]);
    const history = listHistory(fixture.handle, "candidate");
    assert.ok(history.some((entry) => entry.operation === "branch-created"));
    assert.ok(history.some((entry) => entry.operation === "reference-updated"));
  } finally {
    disposeFixture(fixture);
  }
});

test("concurrent stale writer and duplicate command protection", () => {
  const fixture = projectFixture();
  const second = openProject(fixture.root);
  try {
    const v1 = artifact(fixture.handle, "method", "v1", "method one");
    const v2 = artifact(fixture.handle, "method", "v2", "method two");
    const accepted = updateBranchReference(fixture.handle, {
      branchId: "main",
      logicalId: "method",
      artifactVersionId: v1.id,
      expectedVersion: 0,
      commandId: "concurrent-method"
    });
    assert.equal(accepted.status, "accepted");
    const stale = updateBranchReference(second, {
      branchId: "main",
      logicalId: "method",
      artifactVersionId: v2.id,
      expectedVersion: 0,
      commandId: "stale-method"
    });
    assert.equal(stale.status, "stale");
    assert.equal(updateBranchReference(fixture.handle, {
      branchId: "main",
      logicalId: "method",
      artifactVersionId: v1.id,
      expectedVersion: 0,
      commandId: "concurrent-method"
    }).status, "duplicate");
    assert.equal(updateBranchReference(fixture.handle, {
      branchId: "main",
      logicalId: "method",
      artifactVersionId: v2.id,
      expectedVersion: 0,
      commandId: "concurrent-method"
    }).status, "rejected");
    assert.equal(getBranch(second, "main").revision, 1);
    assert.equal(listHistory(fixture.handle, "main").filter((entry) => entry.operation === "reference-updated").length, 1);
  } finally {
    second.close();
    disposeFixture(fixture);
  }
});

test("promotion isolates candidates and records dependency impact", () => {
  const fixture = projectFixture();
  try {
    const sourceV1 = artifact(fixture.handle, "source", "v1", "source old");
    const sourceV2 = artifact(fixture.handle, "source", "v2", "source corrected");
    const dependent = artifact(fixture.handle, "analysis", "v1", "analysis", [{ versionId: sourceV1.id, relation: "derived-from" }]);
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "source", artifactVersionId: sourceV1.id, expectedVersion: 0, commandId: "main-source" });
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "analysis", artifactVersionId: dependent.id, expectedVersion: 1, commandId: "main-analysis" });
    createBranch(fixture.handle, { name: "experiment", branchId: "experiment" });
    updateBranchReference(fixture.handle, { branchId: "experiment", logicalId: "source", artifactVersionId: sourceV2.id, expectedVersion: 0, commandId: "experiment-source" });
    const promotion = promoteBranch(fixture.handle, {
      sourceBranchId: "experiment",
      destinationBranchId: "main",
      expectedVersion: 2,
      commandId: "promote-experiment",
      logicalIds: ["source"]
    });
    assert.equal(promotion.status, "accepted");
    assert.deepEqual(promotion.changed, [{ logicalId: "source", artifactVersionId: sourceV2.id }]);
    assert.ok(promotion.impactedDependents.includes(dependent.id));
    assert.equal(listBranchReferences(fixture.handle, "main").find((item) => item.logicalId === "source")?.artifactVersionId, sourceV2.id);
    assert.equal(listBranchReferences(fixture.handle, "experiment").find((item) => item.logicalId === "source")?.artifactVersionId, sourceV2.id);
    assert.ok(listImpacts(fixture.handle, "main").some((impact) => impact.dependentVersionId === dependent.id));
  } finally {
    disposeFixture(fixture);
  }
});

test("shared source correction preserves branch snapshots", () => {
  const fixture = projectFixture();
  try {
    const source = artifact(fixture.handle, "source", "v1", "source");
    const analysis = artifact(fixture.handle, "analysis", "v1", "analysis", [{ versionId: source.id }]);
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "source", artifactVersionId: source.id, expectedVersion: 0, commandId: "shared-source" });
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "analysis", artifactVersionId: analysis.id, expectedVersion: 1, commandId: "shared-analysis" });
    createBranch(fixture.handle, { name: "review", branchId: "review" });
    const before = getBranch(fixture.handle, "review").currentSnapshotId;
    const impacts = recordSharedSourceCorrection(fixture.handle, { sourceVersionId: source.id, notice: "source was corrected upstream", commandId: "source-correction" });
    assert.ok(impacts.some((impact) => impact.branchId === "main" && impact.dependentVersionId === analysis.id));
    assert.ok(impacts.some((impact) => impact.branchId === "review" && impact.dependentVersionId === analysis.id));
    assert.equal(getBranch(fixture.handle, "review").currentSnapshotId, before);
    assert.equal(listHistory(fixture.handle, "review").filter((entry) => entry.operation === "reference-updated").length, 0);
  } finally {
    disposeFixture(fixture);
  }
});
