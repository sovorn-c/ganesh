import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  acceptSubmission,
  createOwnerCapability,
  createWorkerCapabilities,
  dispatchRun,
  grantDataUse,
  inspectBudget,
  inspectWork,
  openProject,
  queueRun,
  readAssignedInput
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { classifiedInput, contract } from "../support/work-fixtures.js";

// story: e05s01
// scenario: SC-e05s01-P0-01

test("e05s01 schema, atomic reservation, retry, recovery and reopen preserve the exact contract", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    assert.equal(fixture.handle.db.prepare("SELECT 1 FROM work_contracts").get() !== undefined, true);
    const first = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "reopen-command", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    assert.equal(queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "reopen-command", reservation: { tokens: 1, calls: 1, timeMs: 1 } }).id, first.id);
    assert.throws(() => queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "reopen-command", reservation: { tokens: 2, calls: 1, timeMs: 1 } }), /conflict/);
    fixture.handle.close();
    const reopened = openProject(fixture.root);
    assert.equal(inspectWork(reopened, "reopen-command").run?.id, first.id);
    reopened.close();
  } finally {
    disposeFixture(fixture);
  }
});

test("e05s01 authorize, dispatch, candidate, reservation, commitment, snapshot and assigned capability regression", async () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["work:queue-run", "work:submit-candidate", "work:read-assigned-input"] });
    const run = queueRun(fixture.handle, worker, { contractId: authorized.id, commandId: "command-1", reservation: { tokens: 2, calls: 1, timeMs: 10 } });
    const result = await dispatchRun(fixture.handle, worker, run.id, { start: () => ({ status: "ok", sessionId: "session-1" }) });
    assert.equal(result.status, "running");
    const assigned = readAssignedInput(fixture.handle, worker, run.id, input.id);
    assert.equal(assigned.content, "assigned bytes");
    const candidate = await acceptSubmission(fixture.handle, worker, { runId: run.id, sessionId: "session-1", content: "candidate bytes", diagnostics: [{ code: "token=secret-value", count: 2 }], sourceVersionIds: [input.id] });
    assert.equal(candidate.status, "accepted");
    assert.equal(candidate.diagnostics[0]?.code.includes("secret-value"), false);
    assert.equal(inspectWork(fixture.handle, run.id).run?.status, "succeeded");
  } finally {
    disposeFixture(fixture);
  }
});

test("e05s01 current policy denial starts no session and releases reservation", async () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id], { destination: "remote-denied" });
    const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "command-policy", reservation: { tokens: 4, calls: 1, timeMs: 20 } });
    let starts = 0;
    grantDataUse(fixture.handle, { inputVersion: input.id, destination: "remote", purpose: "other", authority: "owner-test" });
    const result = await dispatchRun(fixture.handle, owner, run.id, { start: () => { starts += 1; return { status: "ok" }; } });
    assert.equal(starts, 0);
    assert.equal(result.status, "blocked");
    assert.deepEqual(inspectBudget(fixture.handle, authorized.id).reserved, {});
  } finally {
    disposeFixture(fixture);
  }
});
