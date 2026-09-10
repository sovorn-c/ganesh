// story: e04s04
// scenario: SC-e04s04-P0-01, SC-e04s04-P0-02, SC-e04s04-P1-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInput,
  createDecisionPacket,
  createOwnerCapability,
  createWorkerCapabilities,
  evaluateCommitmentGates,
  listCommitments,
  recordReasonedOverride,
  recordScholarlyFinding,
  resolveReviewDisagreement,
  grantDataUse,
  updateBranchReference,
  ProjectStoreError
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("records scholarly disagreement and a durable reasoned owner override", () => {
  const fixture = projectFixture();
  try {
    const candidate = artifact(fixture.handle, "hypothesis", "v1", "hypothesis");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "hypothesis", artifactVersionId: candidate.id, expectedVersion: 0, commandId: "override-ref"
    });
    const finding = recordScholarlyFinding(fixture.handle, {
      affectedVersionIds: [candidate.id],
      sourceBasis: "reviewer paper DOI:10.0000/example",
      rationale: "The reviewer disputes the proposed interpretation.",
      reviewerId: "reviewer-1",
      methodologyPosition: "Use the preregistered method."
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Use the disputed hypothesis",
      branchId: "main",
      candidateVersionIds: [candidate.id]
    });
    const override = recordReasonedOverride(fixture.handle, {
      findingId: finding.id,
      packetId: packet.id,
      candidateVersionId: candidate.id,
      rationale: "The owner records why this bounded exception is scholarly defensible.",
      uncertainty: "The finding remains material uncertainty.",
      dissent: "The reviewer position is retained verbatim.",
      commandId: "owner-reasoned-override",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(override.status, "recorded");
    assert.equal(override.selectedCandidateVersionIds[0], candidate.id);
    assert.throws(
      () => recordReasonedOverride(fixture.handle, {
        findingId: finding.id, packetId: packet.id, candidateVersionId: candidate.id,
        rationale: "a second override must remain bounded", commandId: "second-override", capability: createOwnerCapability("owner-test")
      }),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "invalid-override"
    );
    assert.throws(
      () => recordReasonedOverride(fixture.handle, {
        findingId: finding.id, packetId: packet.id, candidateVersionId: candidate.id,
        rationale: "forged", commandId: "forged-override", capability: { ownerId: "owner-test" }
      }),
      (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
    );
  } finally {
    disposeFixture(fixture);
  }
});

test("non-waivable privacy gates block unknown authorization and wrong candidates", () => {
  const fixture = projectFixture();
  try {
    const candidate = artifact(fixture.handle, "hypothesis", "v1", "hypothesis");
    const other = artifact(fixture.handle, "hypothesis", "v2", "other");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "hypothesis", artifactVersionId: candidate.id, expectedVersion: 0, commandId: "gate-ref"
    });
    for (const versionId of [candidate.id, other.id]) {
      classifyInput(fixture.handle, versionId, { sensitivity: "confidential", basis: "synthetic source" });
      grantDataUse(fixture.handle, {
        inputVersion: versionId, destination: "review-api", purpose: "scholarly-review", authority: "owner-test"
      });
    }
    const packet = createDecisionPacket(fixture.handle, {
      question: "Gate hypothesis", branchId: "main", candidateVersionIds: [candidate.id]
    });
    const unknown = evaluateCommitmentGates(fixture.handle, {
      packetId: packet.id,
      candidateVersionIds: [candidate.id],
      destination: "review-api",
      purpose: "scholarly-review",
      externalAuthorization: "unknown",
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(unknown.status, "blocked");
    assert.equal(unknown.allowed, false);
    assert.ok(unknown.gates.some((gate) => gate.gate === "external-authorization" && !gate.passed));
    assert.equal(listCommitments(fixture.handle).length, 0);

    const wrongCandidate = evaluateCommitmentGates(fixture.handle, {
      packetId: packet.id,
      candidateVersionIds: [other.id],
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(wrongCandidate.status, "blocked");
    assert.ok(wrongCandidate.gates.some((gate) => gate.gate === "provenance" && !gate.passed));

    const worker = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["canonical-project-write"]
    });
    const workerAttempt = evaluateCommitmentGates(fixture.handle, {
      packetId: packet.id, candidateVersionIds: [candidate.id], capability: worker
    });
    assert.equal(workerAttempt.status, "blocked");
    assert.ok(workerAttempt.gates.some((gate) => gate.gate === "identity" && !gate.passed));
  } finally {
    disposeFixture(fixture);
  }
});

test("passes documented gates and bounds finite disagreement regression to one revision", () => {
  const fixture = projectFixture();
  try {
    const candidate = artifact(fixture.handle, "method", "v1", "method");
    updateBranchReference(fixture.handle, {
      branchId: "main", logicalId: "method", artifactVersionId: candidate.id, expectedVersion: 0, commandId: "pass-ref"
    });
    classifyInput(fixture.handle, candidate.id, { sensitivity: "confidential", basis: "protocol" });
    grantDataUse(fixture.handle, {
      inputVersion: candidate.id, destination: "review-api", purpose: "method-review", authority: "owner-test"
    });
    const finding = recordScholarlyFinding(fixture.handle, {
      affectedVersionIds: [candidate.id], sourceBasis: "registered protocol", rationale: "Method disagreement",
      reviewerId: "reviewer-2", methodologyPosition: "Prefer method B"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Choose method", branchId: "main", candidateVersionIds: [candidate.id]
    });
    const first = resolveReviewDisagreement(fixture.handle, {
      findingId: finding.id, packetId: packet.id, commandId: "disagreement-revision",
      action: "revise", rationale: "Owner receives one bounded revision."
    });
    assert.equal(first.status, "revised");
    assert.ok(first.replacementPacketId);
    const second = resolveReviewDisagreement(fixture.handle, {
      findingId: finding.id, packetId: first.replacementPacketId ?? packet.id,
      commandId: "disagreement-owner-decision", action: "return-to-owner", blockerPersists: true
    });
    assert.equal(second.status, "owner-decision-required");
    assert.equal(second.revisionCount, 1);

    const passed = evaluateCommitmentGates(fixture.handle, {
      packetId: packet.id,
      candidateVersionIds: [candidate.id],
      destination: "review-api",
      purpose: "method-review",
      externalAuthorization: { status: "documented-approved", basis: "local authorization record" },
      capability: createOwnerCapability("owner-test")
    });
    assert.equal(passed.status, "passed");
    assert.equal(passed.allowed, true);
    assert.ok(passed.gates.every((gate) => gate.passed));
  } finally {
    disposeFixture(fixture);
  }
});