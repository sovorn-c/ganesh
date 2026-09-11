import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  acceptSubmission,
  cancelContract,
  createOwnerCapability,
  dispatchRun,
  inspectQuarantine,
  inspectWork,
  pauseRun,
  queueRun
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { classifiedInput, contract } from "../support/work-fixtures.js";

// story: e05s04
// scenario: SC-e05s04-P0-01

test("e05s04 cancel fences siblings, remote best-effort stop, budget pause and quarantines a late submission", async () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    const first = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "cancel-first", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const second = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "cancel-second", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    await dispatchRun(fixture.handle, owner, first.id, { start: () => ({ status: "ok", sessionId: "old-session" }) });
    assert.equal(pauseRun(fixture.handle, owner, { runId: second.id, reason: "owner review" }).status, "waiting-for-human");
    cancelContract(fixture.handle, owner, { contractId: authorized.id, reason: "owner stop", sessionPort: { cancel: () => undefined } });
    assert.throws(() => queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "cancel-third" }), /authorized/);
    assert.equal((await acceptSubmission(fixture.handle, owner, { runId: first.id, sessionId: "old-session", content: "late" })).status, "quarantined");
    assert.ok(inspectQuarantine(fixture.handle, first.id).length >= 1);
    assert.equal(inspectWork(fixture.handle, second.id).run?.status, "cancelled");
  } finally {
    disposeFixture(fixture);
  }
});
