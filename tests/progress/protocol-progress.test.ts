// story: e12s01
// scenarios: SC-e12s01-P0-01, SC-e12s01-P0-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindProtocolInForce,
  createDecisionPacket,
  createOwnerCapability,
  createWorkerCapabilities,
  inspectProgress,
  inspectProtocol,
  ingestProgressCandidate,
  inspectReportedExecution,
  listCommitments,
  openProject,
  recordOwnerDecision,
  recordProgress,
  recordProgressCorrection,
  recordProtocolVersion,
  recordReportedExecution,
  updateBranchReference
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("e12s01 protocol and progress persist after reopen without optional refs", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const protocol = recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v1",
      procedureText: "Example Clinic North interview guide v1",
      commandId: "e12s01-persist-protocol"
    });
    assert.equal(recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v1",
      procedureText: "Example Clinic North interview guide v1",
      commandId: "e12s01-persist-protocol"
    }).id, protocol.id);
    const progress = recordProgress(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      summary: "Owner reported that the pilot briefing was drafted.",
      occurredOn: "2026-09-15",
      commandId: "e12s01-persist-progress"
    });
    assert.equal(recordProgress(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      summary: "Owner reported that the pilot briefing was drafted.",
      occurredOn: "2026-09-15",
      commandId: "e12s01-persist-progress"
    }).id, progress.id);

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

test("e12s01 owner binding requires the current branch artifact and active commitment", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const protocol = recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v1",
      procedureText: "Approved protocol candidate"
    });
    updateBranchReference(fixture.handle, {
      branchId: "main",
      logicalId: "study-protocol",
      artifactVersionId: protocol.artifactVersionId,
      expectedVersion: 0,
      commandId: "e12s01-protocol-reference"
    });
    assert.throws(() => bindProtocolInForce(fixture.handle, owner, { protocolVersionId: protocol.id }), /active E04 commitment/);
    const packet = createDecisionPacket(fixture.handle, {
      question: "Adopt study protocol",
      branchId: "main",
      candidateVersionIds: [protocol.artifactVersionId]
    });
    const decision = recordOwnerDecision(fixture.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [protocol.artifactVersionId],
      commandId: "e12s01-protocol-approval",
      capability: owner
    });
    assert.ok(decision.commitmentId);
    const bound = bindProtocolInForce(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      commitmentId: decision.commitmentId,
      commandId: "e12s01-protocol-bind"
    });
    assert.equal(bound.status, "in-force");
    assert.equal(bindProtocolInForce(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      commitmentId: decision.commitmentId,
      commandId: "e12s01-protocol-bind"
    }).id, protocol.id);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s01 worker records specialist provenance and reported execution stays non-reproduced", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const worker = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["progress:record", "progress:inspect"]
    });
    const candidate = ingestProgressCandidate(fixture.handle, worker, {
      kind: "reported-execution",
      payload: { summary: "A specialist supplied a prior execution note." },
      specialistRole: "methodology",
      commandId: "e12s01-specialist-candidate"
    });
    assert.equal(candidate.origin, "specialist-proposed");
    const protocol = recordProtocolVersion(fixture.handle, worker, {
      versionLabel: "worker-v1",
      procedureText: "Methodology specialist proposal"
    });
    assert.equal(protocol.attribution, "agent-inferred");
    assert.equal(protocol.origin, "specialist-proposed");
    assert.throws(() => recordProtocolVersion(fixture.handle, worker, {
      versionLabel: "worker-v2",
      procedureText: "Must not be human stated",
      attribution: "human-stated"
    }), /human-stated/);
    const evidence = artifact(fixture.handle, "reported-source", "v1", "reported source");
    const execution = recordReportedExecution(fixture.handle, worker, {
      protocolVersionId: protocol.id,
      summary: "Specialist reported a prior run; no local run was executed.",
      evidenceVersionIds: [evidence.id],
      reproduced: true
    });
    assert.equal(execution.reproduced, false);
    assert.equal(inspectReportedExecution(fixture.handle, owner, protocol.id).length, 1);
    const runs = fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM work_runs").get() as { count: number };
    assert.equal(runs.count, 0);
    assert.equal(listCommitments(fixture.handle).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s01 missing progress tables fail closed on read-only inspection", () => {
  const fixture = projectFixture();
  let closed = false;
  try {
    fixture.handle.db.exec(`
      DROP TABLE reported_prior_commitments;
      DROP TABLE deviations;
      DROP TABLE amendments;
      DROP TABLE progress_candidates;
      DROP TABLE reported_execution_evidence;
      DROP TABLE progress_records;
      DROP TABLE protocol_versions;
      DROP TABLE progress_operations;
    `);
    fixture.handle.close();
    closed = true;
    const readonly = openProject(fixture.root, { readOnly: true });
    try {
      assert.throws(
        () => inspectProtocol(readonly, createOwnerCapability("owner-test")),
        (error: unknown) => (error as { code?: string }).code === "progress-schema-unavailable"
      );
    } finally {
      readonly.close();
    }
  } finally {
    if (!closed) {fixture.handle.close();}
    disposeFixture(fixture);
  }
});

test("e12s01 corrections append retrospective records and direct mutation is blocked", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const protocol = recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v1",
      procedureText: "Protocol"
    });
    const original = recordProgress(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      summary: "Initial progress statement"
    });
    const correction = recordProgressCorrection(fixture.handle, owner, {
      progressId: original.id,
      summary: "Corrected progress statement",
      commandId: "e12s01-correction"
    });
    assert.equal(correction.retrospective, true);
    assert.equal(correction.correctsProgressId, original.id);
    assert.equal(inspectProgress(fixture.handle, owner, { includeRetrospective: false }).length, 1);
    assert.equal(inspectProgress(fixture.handle, owner).length, 2);
    assert.throws(() => fixture.handle.db.prepare("UPDATE progress_records SET summary = ? WHERE id = ?").run("tampered", original.id), /insert-only/);
    assert.throws(() => fixture.handle.db.prepare("DELETE FROM progress_records WHERE id = ?").run(original.id), /insert-only/);
  } finally {
    disposeFixture(fixture);
  }
});
