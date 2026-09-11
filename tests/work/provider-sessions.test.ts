import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  authorizeContract,
  classifyInput,
  createOwnerCapability,
  createPiSessionAdapter,
  dispatchRun,
  grantDataUse,
  inspectBudget,
  listProviderAttempts,
  proposeContract,
  queueRun
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

// story: e05s05
// scenario: SC-e05s05-P0-01

test("e05s05 destination consent timeout retry failure fallback and uncertain usage records attempts", async () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = artifact(fixture.handle, "remote", "1", "public bytes");
    classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
    grantDataUse(fixture.handle, { inputVersion: input.id, destination: "provider-a", purpose: "research-work", authority: "owner-test" });
    const proposed = proposeContract(fixture.handle, owner, { id: "provider-contract", objective: "remote work", inputVersionIds: [input.id], destination: "provider-a", purpose: "research-work", limits: { tokens: 10, calls: 3, timeMs: 10 }, scope: { maxRetries: 1 } });
    const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
    const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "provider-command", providerQuote: { status: "known", amount: 0, currency: "USD" }, reservation: { tokens: 1, calls: 2, timeMs: 2 } });
    let attempts = 0;
    const result = await dispatchRun(fixture.handle, owner, run.id, { start: () => { attempts += 1; return { status: attempts === 1 ? "timeout" : "failure", errorCode: "provider-down" }; } });
    assert.equal(result.status, "failed");
    assert.equal(attempts, 2);
    assert.equal(listProviderAttempts(fixture.handle, run.id).length, 2);
    const externalCheckpoints = fixture.handle.db.prepare("SELECT phase, status FROM policy_checkpoints WHERE operation_id = ? AND phase = 'external'").all(run.operationId) as Array<{ phase: string; status: string }>;
    assert.deepEqual(externalCheckpoints.map((checkpoint) => checkpoint.status), ["passed", "passed"]);
    assert.equal(inspectBudget(fixture.handle, authorized.id).uncertain, true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e05s05 adapter unsubscribes and submits only the current session", () => {
  let oldSubscriptions = 0;
  let newSubscriptions = 0;
  let current = { id: "session-a", subscribe: () => { oldSubscriptions += 1; return () => { oldSubscriptions -= 1; }; } };
  const runtime = { get session() { return current; }, bindExtensions: () => undefined };
  const adapter = createPiSessionAdapter({ runtime });
  current = { id: "session-b", subscribe: () => { newSubscriptions += 1; return () => { newSubscriptions -= 1; }; } };
  adapter.rebind?.();
  assert.equal(oldSubscriptions, 0);
  assert.equal(newSubscriptions, 1);
  assert.equal(adapter.submit?.({ runId: "run-1", content: "result" }).sessionId, "session-b");
});
