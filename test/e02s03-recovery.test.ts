// story: e02s03
// scenario: SC-e02s03-P0-01, SC-e02s03-P1-02, SC-e02s03-P1-03
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import {
  getBranch,
  inspectSnapshot,
  listArtifactVersions,
  listBranchReferences,
  openProject,
  recoverProject,
  registerArtifactVersion,
  schemaStatus,
  updateBranchReference
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

test("e02s03 schema status distinguishes supported migration and future", () => {
  const fixture = projectFixture();
  try {
    assert.equal(schemaStatus(fixture.handle).status, "supported");
    fixture.handle.db.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run("0");
    fixture.handle.db.prepare("UPDATE projects SET schema_version = 0").run();
    fixture.handle.close();
    const migration = openProject(fixture.root);
    try {
      assert.equal(migration.status, "migration-required");
      assert.equal(schemaStatus(migration).status, "migration-required");
      assert.deepEqual(schemaStatus(migration).allowedOperations, ["inspect", "export-metadata"]);
    } finally {
      migration.close();
    }

    const futureHandle = new DatabaseSync(join(fixture.root, ".ganesh", "project.sqlite"));
    futureHandle.prepare("UPDATE metadata SET value = ? WHERE key = 'schema_version'").run("99");
    futureHandle.prepare("UPDATE projects SET schema_version = 99").run();
    futureHandle.close();
    const future = openProject(fixture.root);
    try {
      assert.equal(future.status, "unknown-future");
      assert.equal(schemaStatus(future).status, "unknown-future");
      const blocked = updateBranchReference(future, {
        branchId: "main",
        logicalId: "none",
        artifactVersionId: "none",
        expectedVersion: 0,
        commandId: "future-write"
      });
      assert.equal(blocked.status, "blocked");
    } finally {
      future.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("e02s03 recovery removes temporary files and preserves complete state", () => {
  const fixture = projectFixture();
  try {
    const source = artifact(fixture.handle, "source", "v1", "complete");
    const temporaryDirectory = join(fixture.handle.project.artifactRoot, "aa");
    mkdirSync(temporaryDirectory, { recursive: true });
    const temporaryPath = join(temporaryDirectory, "crash.incomplete");
    writeFileSync(temporaryPath, "partial");
    const failed = (): void => {
      registerArtifactVersion(fixture.handle, {
        logicalId: "interrupted",
        version: "v1",
        versionId: "interrupted-v1",
        content: "partial",
        failAt: "after-finalize-before-register"
      });
    };
    assert.throws(failed, /after artifact finalization/);
    assert.throws(
      () => registerArtifactVersion(fixture.handle, {
        logicalId: "committed",
        version: "v1",
        versionId: "committed-v1",
        content: "complete after commit",
        failAt: "after-commit"
      }),
      /after artifact registration commit/
    );
    const result = recoverProject(fixture.root);
    assert.equal(result.status, "ready");
    assert.ok(result.checkpointId);
    assert.ok(result.removedTemporaryFiles.includes(temporaryPath));
    assert.equal(listArtifactVersions(fixture.handle).length, 2);
    assert.equal(result.artifactStatuses.find((item) => item.id === source.id)?.contentStatus, "available");
    assert.equal(result.artifactStatuses.find((item) => item.id === "committed-v1")?.contentStatus, "available");
  } finally {
    disposeFixture(fixture);
  }
});

test("e02s03 read-only offline inspection cannot roll back current state", () => {
  const fixture = projectFixture();
  try {
    const first = artifact(fixture.handle, "question", "v1", "first");
    const second = artifact(fixture.handle, "question", "v2", "second");
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 0, commandId: "question-first" });
    const oldSnapshot = getBranch(fixture.handle, "main").currentSnapshotId;
    updateBranchReference(fixture.handle, { branchId: "main", logicalId: "question", artifactVersionId: second.id, expectedVersion: 1, commandId: "question-second" });
    const currentSnapshot = getBranch(fixture.handle, "main").currentSnapshotId;
    const readOnly = openProject(fixture.root, { readOnly: true, reason: "offline inspection" });
    try {
      assert.equal(readOnly.status, "read-only");
      assert.equal(inspectSnapshot(readOnly, oldSnapshot).references[0]?.artifactVersionId, first.id);
      assert.equal(updateBranchReference(readOnly, { branchId: "main", logicalId: "question", artifactVersionId: first.id, expectedVersion: 2, commandId: "rollback-attempt" }).status, "blocked");
      assert.equal(getBranch(fixture.handle, "main").currentSnapshotId, currentSnapshot);
      assert.equal(listBranchReferences(readOnly, "main")[0]?.artifactVersionId, second.id);
    } finally {
      readOnly.close();
    }
  } finally {
    disposeFixture(fixture);
  }
});
