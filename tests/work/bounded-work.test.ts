import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  acceptSubmission,
  authorizeContract,
  cancelContract,
  cancelRun,
  classifyInput,
  createOwnerCapability,
  createPiSessionAdapter,
  createWorkerCapabilities,
  dispatchRun,
  grantDataUse,
  inspectBudget,
  inspectQuarantine,
  inspectWork,
  listDisagreements,
  openProject,
  listProviderAttempts,
  pauseRun,
  proposeContract,
  queueRoleRun,
  queueRun,
  readAssignedInput,
  readRoleSnapshot,
  requestTargetedRevision,
  recordDisagreement,
  reserveBudget,
  reviseContract,
  settleBudget
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

function classifiedInput(handle: Parameters<typeof classifyInput>[0]) {
  const input = artifact(handle, "assigned", "1", "assigned bytes");
  classifyInput(handle, input.id, { sensitivity: "public", basis: "test" });
  grantDataUse(handle, { inputVersion: input.id, destination: "local", purpose: "research-work", authority: "owner-test" });
  return input;
}

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

function contract(handle: Parameters<typeof proposeContract>[0], owner: ReturnType<typeof createOwnerCapability>, inputIds: readonly string[], overrides: Record<string, unknown> = {}) {
  const proposed = proposeContract(handle, owner, {
    id: `contract-${Math.random().toString(36).slice(2)}`,
    objective: "bounded research work",
    inputVersionIds: inputIds,
    permittedRoles: ["supervisor", "discovery", "evidence", "methodology", "reviewer"],
    limits: { tokens: 100, calls: 10, timeMs: 10_000, ...(overrides.limits as object ?? {}) },
    ...(overrides.scope === undefined ? {} : { scope: overrides.scope as Record<string, unknown> }),
    ...(overrides.destination === undefined ? {} : { destination: String(overrides.destination) }),
    ...(overrides.purpose === undefined ? {} : { purpose: String(overrides.purpose) })
  });
  return authorizeContract(handle, owner, { contractId: proposed.id });
}

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

test("e05s03 budget ledger reservations are cumulative across retry revision reopen and spent totals; unknown spend is denied and uncertain is not zero", () => {
  const fixture = projectFixture();
  try {
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id], { limits: { tokens: 10, calls: 2, timeMs: 20, spend: 5 } });
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-1", { tokens: 4, calls: 1, timeMs: 8, spend: 2 }, { status: "known", amount: 2, currency: "USD" }).status, "reserved");
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-2", { tokens: 7, calls: 1, timeMs: 8, spend: 3 }, { status: "known", amount: 3, currency: "USD" }).status, "rejected");
    assert.equal(reserveBudget(fixture.handle, `${authorized.id}@1`, "budget-run-3", { tokens: 1, calls: 1, timeMs: 1, spend: 1 }, { status: "unknown", reason: "provider did not quote" }).status, "rejected");
    assert.equal(settleBudget(fixture.handle, "budget-run-1", { tokens: 3, calls: 1, timeMs: 5, spend: 2 }).status, "settled");
    assert.equal(inspectBudget(fixture.handle, authorized.id).spent.spend, 2);
    const revised = reviseContract(fixture.handle, owner, { contractId: authorized.id });
    assert.equal(inspectBudget(fixture.handle, revised.id, revised.version).spent.spend, 2);
    assert.equal(settleBudget(fixture.handle, "budget-run-uncertain", { tokens: 1 }, true).status, "rejected");
  } finally {
    disposeFixture(fixture);
  }
});

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
