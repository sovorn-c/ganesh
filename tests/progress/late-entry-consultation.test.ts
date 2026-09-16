// story: e12s03
// scenarios: SC-e12s03-P0-01, SC-e12s03-P0-02, SC-e12s03-P0-03, SC-e12s03-P1-04
import assert from "node:assert/strict";
import test from "node:test";
import {
  bindProtocolInForce,
  createDecisionPacket,
  createOwnerCapability,
  createWorkerCapabilities,
  inspectStudyConsultation,
  listCommitments,
  recordOwnerDecision,
  recordOrientation,
  recordProblemFraming,
  recordReportedPriorCommitment,
  recordProtocolVersion,
  updateBranchReference,
  inspectReportedPriorCommitments,
  ProjectStoreError
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("e12s03 consultation returns a methodology draft without requiring protocol discovery", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const orientation = recordOrientation(fixture.handle, owner, {
      topic: "Late-entry study",
      discipline: "public health",
      immediateGoal: "Review an existing draft",
      unknowns: ["Whether the protocol is current"]
    });
    const framing = recordProblemFraming(fixture.handle, owner, {
      orientationId: orientation.id,
      statement: "A draft study needs supervision review.",
      boundaries: "Review only; do not infer approval."
    });
    const view = inspectStudyConsultation(fixture.handle, owner);
    assert.equal(view.methodologyDrafts[0]?.id, framing.id);
    assert.equal(view.protocolVersions.length, 0);
    assert.ok(view.limits.some((limit) => limit.code === "missing-protocol-in-force"));
    assert.ok(view.limits.some((limit) => limit.code === "missing-literature"));
    assert.ok(view.limits.some((limit) => limit.code === "missing-data"));
    assert.equal(view.limits.some((limit) => limit.code === "missing-orientation"), false);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s03 missing literature and data remain explicit limits", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const view = inspectStudyConsultation(fixture.handle, owner);
    assert.deepEqual(view.limits.map((limit) => limit.code), ["missing-orientation", "missing-literature", "missing-data", "missing-protocol-in-force"]);
    assert.equal(view.progress.length, 0);
    assert.equal(view.reportedPriorCommitments.length, 0);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s03 approved language stays reported and does not mint a commitment or grant", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const source = artifact(fixture.handle, "supervisor-note", "v1", "The committee approved the protocol in an earlier meeting.");
    const reported = recordReportedPriorCommitment(fixture.handle, owner, {
      statement: "The committee approved the protocol in an earlier meeting.",
      attributedActor: "Fictional supervisor",
      sourceArtifactVersionId: source.id,
      sourceKind: "supervisor-feedback",
      commandId: "e12s03-reported-approval"
    });
    assert.equal(reported.authenticity, "reported");
    assert.equal(inspectReportedPriorCommitments(fixture.handle, owner)[0]?.authenticity, "reported");
    assert.equal(listCommitments(fixture.handle).length, 0);
    assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM external_authorizations").get() as { count: number }).count, 0);
    assert.equal(inspectStudyConsultation(fixture.handle, owner).reportedPriorCommitments[0]?.statement.includes("approved"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s03 consultation includes authenticated commitments and an in-force protocol", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const protocol = recordProtocolVersion(fixture.handle, owner, { versionLabel: "v1", procedureText: "Approved protocol" });
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "study-protocol", artifactVersionId: protocol.artifactVersionId,
      expectedVersion: 0, commandId: "e12s03-consultation-reference"
    });
    const packet = createDecisionPacket(fixture.handle, { question: "Approve protocol", branchId: "main", candidateVersionIds: [protocol.artifactVersionId] });
    const decision = recordOwnerDecision(fixture.handle, {
      packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [protocol.artifactVersionId],
      commandId: "e12s03-consultation-commitment", capability: owner
    });
    assert.ok(decision.commitmentId);
    bindProtocolInForce(fixture.handle, owner, {
      protocolVersionId: protocol.id, commitmentId: decision.commitmentId, commandId: "e12s03-consultation-bind"
    });

    const view = inspectStudyConsultation(fixture.handle, owner);
    assert.equal(view.authenticatedCommitments.length, 1);
    assert.equal(view.protocolVersions.some((item) => item.status === "in-force"), true);
    assert.equal(view.limits.some((limit) => limit.code === "missing-protocol-in-force"), false);
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s03 specialist and star worker cannot authenticate reported prior commitments", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["*"] });
    const reported = recordReportedPriorCommitment(fixture.handle, worker, {
      statement: "Supervisor reported that the protocol was approved.",
      attributedActor: "Supervisor",
      sourceKind: "imported-text",
      commandId: "e12s03-worker-reported"
    });
    assert.equal(reported.origin, "specialist-proposed");
    assert.equal(reported.authenticity, "reported");
    assert.throws(() => recordReportedPriorCommitment(fixture.handle, worker, {
      statement: "Attempted authentication",
      attributedActor: "Supervisor",
      sourceKind: "imported-text",
      authenticity: "authenticated" as "reported",
      commandId: "e12s03-worker-authenticated"
    }), (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden");
    const protocol = recordProtocolVersion(fixture.handle, owner, { versionLabel: "v1", procedureText: "Candidate protocol" });
    const packet = createDecisionPacket(fixture.handle, { question: "Approve", branchId: "main", candidateVersionIds: [protocol.artifactVersionId] });
    assert.throws(() => recordOwnerDecision(fixture.handle, {
      packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [protocol.artifactVersionId],
      commandId: "e12s03-worker-owner-decision", capability: worker
    }), (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden");
    assert.equal(listCommitments(fixture.handle).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});
