// story: e12s01
// scenarios: SC-e12s01-P0-01, SC-e12s01-P0-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerCapability,
  inspectProgress,
  inspectProtocol,
  openProject,
  recordProgress,
  recordProtocolVersion
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("e12s01 protocol and progress persist after reopen without optional refs", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const protocol = recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v1",
      procedureText: "Example Clinic North interview guide v1"
    });
    const progress = recordProgress(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      summary: "Owner reported that the pilot briefing was drafted.",
      occurredOn: "2026-09-15"
    });

    assert.equal(protocol.status, "candidate");
    assert.equal(protocol.attribution, "human-stated");
    assert.equal(protocol.origin, "owner-recorded");
    assert.equal(inspectProtocol(fixture.handle, owner, { id: protocol.id })[0]?.id, protocol.id);
    assert.equal(inspectProgress(fixture.handle, owner, { id: progress.id })[0]?.id, progress.id);

    fixture.handle.close();
    const reopened = openProject(fixture.root);
    try {
      const reopenedOwner = createOwnerCapability("owner-test");
      assert.equal(inspectProtocol(reopened, reopenedOwner, { id: protocol.id })[0]?.artifactVersionId, protocol.artifactVersionId);
      assert.equal(inspectProgress(reopened, reopenedOwner, { protocolVersionId: protocol.id })[0]?.summary, progress.summary);
    } finally {
      reopened.close();
    }
  } finally {
    // The first handle is already closed when the reopen path is exercised.
    try { fixture.handle.close(); } catch { /* already closed */ }
    disposeFixture(fixture);
  }
});
