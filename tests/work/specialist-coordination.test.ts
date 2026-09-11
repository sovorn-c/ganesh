import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  listDisagreements,
  queueRoleRun,
  readRoleSnapshot,
  recordDisagreement,
  requestTargetedRevision
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { classifiedInput, contract } from "../support/work-fixtures.js";

// story: e05s02
// scenario: SC-e05s02-P0-01

test("e05s02 role snapshots omit conversation and unassigned material while disagreements preserve both source bases and allow one targeted revision without a recursive loop", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id], { scope: { reviewQuestion: "is this sound?", standards: ["reporting"] } });
    const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["work:queue-run", "work:read-role-snapshot", "work:record-disagreement"] });
    const methodology = queueRoleRun(fixture.handle, worker, { contractId: authorized.id, role: "methodology", commandId: "methodology-1", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const reviewer = queueRoleRun(fixture.handle, worker, { contractId: authorized.id, role: "reviewer", commandId: "reviewer-1", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const reviewerSnapshot = readRoleSnapshot(fixture.handle, worker, reviewer.id);
    assert.equal(reviewerSnapshot.reviewQuestion, "is this sound?");
    assert.equal("conversation" in reviewerSnapshot, false);
    assert.equal("unassignedBytes" in reviewerSnapshot, false);
    const disagreement = recordDisagreement(fixture.handle, worker, { contractId: `${authorized.id}@1`, question: "is this sound?", leftRole: "methodology", rightRole: "reviewer", leftCandidateVersionId: "candidate-left", rightCandidateVersionId: "candidate-right", leftSourceBasis: [input.id], rightSourceBasis: [input.id] });
    assert.equal(disagreement.contractId, authorized.id);
    assert.equal(listDisagreements(fixture.handle, `${authorized.id}@1`).length, 1);
    assert.notEqual(methodology.id, reviewer.id);
    const revision = requestTargetedRevision(fixture.handle, worker, disagreement.id);
    assert.equal(revision.status, "queued");
    const second = recordDisagreement(fixture.handle, worker, { contractId: authorized.id, question: "is this sound?", leftRole: "methodology", rightRole: "reviewer", leftCandidateVersionId: "candidate-left-2", rightCandidateVersionId: "candidate-right-2", leftSourceBasis: [input.id], rightSourceBasis: [input.id] });
    assert.equal(second.status, "returned-to-owner");
  } finally {
    disposeFixture(fixture);
  }
});
