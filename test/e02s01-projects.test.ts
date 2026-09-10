// story: e02s01
// scenario: SC-e02s01-P0-01, SC-e02s01-P0-02, SC-e02s01-P1-03
import assert from "node:assert/strict";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import {
  inspectArtifactVersion,
  listArtifactVersions,
  listDependencies,
  listTemporaryArtifactFiles,
  openProject,
  registerArtifactVersion,
  ProjectStoreError
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

test("e02s01 project schema survives reopen offline", () => {
  const fixture = projectFixture();
  try {
    const source = artifact(fixture.handle, "source", "v1", "source bytes");
    const proposal = artifact(fixture.handle, "proposal", "v1", "proposal bytes", [
      { versionId: source.id, relation: "derived-from" }
    ]);
    const root = fixture.root;
    fixture.handle.close();
    const reopened = openProject(root);
    try {
      assert.equal(reopened.status, "ready");
      assert.equal(reopened.project.ownerId, "owner-test");
      assert.equal(reopened.project.schemaVersion, 1);
      assert.equal(inspectArtifactVersion(reopened, proposal.id).contentStatus, "available");
      assert.deepEqual(listDependencies(reopened, proposal.id), [{
        artifactVersionId: proposal.id,
        dependencyVersionId: source.id,
        relation: "derived-from"
      }]);
    } finally {
      reopened.close();
    }
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("e02s01 artifact immutable hash and later versions", () => {
  const fixture = projectFixture();
  try {
    const first = artifact(fixture.handle, "notes", "v1", "first");
    const firstBytes = readFileSync(first.storagePath ?? "");
    const second = artifact(fixture.handle, "notes", "v2", "second");
    assert.notEqual(first.contentHash, second.contentHash);
    assert.deepEqual(readFileSync(first.storagePath ?? ""), firstBytes);
    assert.equal(listArtifactVersions(fixture.handle).length, 2);
    assert.throws(
      () => registerArtifactVersion(fixture.handle, {
        logicalId: "notes",
        version: "v3",
        versionId: "notes-v3",
        content: "wrong",
        expectedHash: first.contentHash ?? undefined
      }),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "hash-mismatch"
    );
  } finally {
    disposeFixture(fixture);
  }
});

test("e02s01 dependency inspection distinguishes missing corrupt and unavailable", () => {
  const fixture = projectFixture();
  try {
    const missing = artifact(fixture.handle, "missing", "v1", "missing bytes");
    const corrupt = artifact(fixture.handle, "corrupt", "v1", "correct bytes");
    const unavailable = registerArtifactVersion(fixture.handle, {
      logicalId: "remote",
      version: "v1",
      versionId: "remote-v1",
      availability: "unavailable",
      access: "unavailable",
      origin: "remote metadata"
    });
    rmSync(missing.storagePath ?? "", { force: true });
    writeFileSync(corrupt.storagePath ?? "", "changed bytes");
    assert.equal(inspectArtifactVersion(fixture.handle, missing.id).contentStatus, "missing");
    assert.equal(inspectArtifactVersion(fixture.handle, corrupt.id).contentStatus, "corrupt");
    assert.equal(inspectArtifactVersion(fixture.handle, unavailable.id).contentStatus, "unavailable");
    assert.match(inspectArtifactVersion(fixture.handle, corrupt.id).detail, /hash|length/);
  } finally {
    disposeFixture(fixture);
  }
});

test("e02s01 atomic registration leaves no incomplete reference", () => {
  const fixture = projectFixture();
  try {
    assert.throws(
      () => registerArtifactVersion(fixture.handle, {
        logicalId: "failed",
        version: "before",
        versionId: "failed-before",
        content: "bytes",
        failAt: "before-finalize"
      }),
      /before artifact finalization/
    );
    assert.throws(
      () => registerArtifactVersion(fixture.handle, {
        logicalId: "failed",
        version: "after",
        versionId: "failed-after",
        content: "bytes",
        failAt: "after-finalize-before-register"
      }),
      /after artifact finalization/
    );
    assert.equal(listArtifactVersions(fixture.handle).length, 0);
    assert.equal(listTemporaryArtifactFiles(fixture.handle).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});
