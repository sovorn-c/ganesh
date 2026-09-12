// story: e14s04
// scenario: SC-e14s04-P0-01 SC-e14s04-P0-02 SC-e14s04-P0-03 SC-e14s04-P1-04
import { strict as assert } from "node:assert";
import { afterEach, describe, it } from "node:test";
import {
  acceptSubmission,
  createOwnerCapability,
  dispatchRun,
  getRun,
  inspectBudget,
  listRuns,
  queueRun,
  pauseRun,
  qualifyAccessPath,
  keyboardMap,
  type ProjectHandle
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { classifiedInput, contract } from "../support/work-fixtures.js";
import { cancelFromWorkspace, presentWorkStatus } from "../../src/workspace/status.js";
import type { WorkspaceSession } from "../../src/workspace/workspace-types.js";

const fixtures: ReturnType<typeof projectFixture>[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) {
    disposeFixture(fixture);
  }
});

function workspaceSession(handle: ProjectHandle): WorkspaceSession {
  const root = handle.project.rootPath;
  return {
    handle,
    ownerCapability: createOwnerCapability(handle.project.ownerId),
    runtimeOptions: { cwd: root, agentDir: `${root}/.ganesh/pi`, projectRoot: root, ownerId: handle.project.ownerId },
    intake: { lateEntry: true, stagePipeline: false, currentRecords: ["project", "work"] },
    ports: { runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false } }
  };
}

describe("E14 live work state and access paths", () => {
  it("e14s04 live work state shows status remaining budget and cancellation fence", async () => {
    const fixture = projectFixture();
    fixtures.push(fixture);
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "workspace-run", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const session = workspaceSession(fixture.handle);
    const queued = presentWorkStatus(session, { runId: run.id });
    assert.equal(queued.status, "queued");
    assert.equal(queued.remaining.tokens, 99);
    assert.match(queued.text, /Remaining budget/);

    const running = await dispatchRun(fixture.handle, owner, run.id, { start: () => ({ status: "ok", sessionId: "workspace-session" }) });
    assert.equal(running.status, "running");
    assert.equal(presentWorkStatus(session, { runId: run.id }).status, "working");
    const cancelled = cancelFromWorkspace(session, { runId: run.id, reason: "owner stop", sessionPort: { cancel: () => undefined } });
    assert.equal(cancelled.status, "cancelled");
    assert.match(cancelled.cancellation ?? "", /fenced/);
    assert.equal(getRun(fixture.handle, run.id)?.status, "cancelled");
    const late = await acceptSubmission(fixture.handle, owner, { runId: run.id, sessionId: "workspace-session", content: "late output" });
    assert.equal(late.status, "quarantined");
  });

  it("e14s04 waiting-for-human and blocked states remain readable", async () => {
    const fixture = projectFixture();
    fixtures.push(fixture);
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const local = contract(fixture.handle, owner, [input.id]);
    const waitingRun = queueRun(fixture.handle, owner, { contractId: local.id, commandId: "workspace-waiting", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    pauseRun(fixture.handle, owner, { runId: waitingRun.id, reason: "owner review" });
    const session = workspaceSession(fixture.handle);
    assert.equal(presentWorkStatus(session, { runId: waitingRun.id }).status, "waiting-for-human");

    const remote = contract(fixture.handle, owner, [input.id], { destination: "remote", purpose: "remote-review" });
    const blockedRun = queueRun(fixture.handle, owner, { contractId: remote.id, commandId: "workspace-blocked", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    await dispatchRun(fixture.handle, owner, blockedRun.id, { start: () => ({ status: "ok", sessionId: "blocked-session" }) });
    assert.equal(presentWorkStatus(session, { runId: blockedRun.id }).status, "blocked");
  });

  it("e14s04 contract cancellation fences all runs and keeps budget inspection truthful", () => {
    const fixture = projectFixture();
    fixtures.push(fixture);
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    const first = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "workspace-contract-1", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const second = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "workspace-contract-2", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const session = workspaceSession(fixture.handle);
    const cancelled = cancelFromWorkspace(session, { contractId: authorized.id, reason: "owner contract stop" });
    assert.equal(cancelled.cancellation, "contract fenced; late output is quarantined");
    assert.equal(cancelled.runId, second.id);
    assert.notEqual(cancelled.runId, first.id);
    assert.equal(listRuns(fixture.handle, authorized.id).every((run) => run.status === "cancelled"), true);
    const budget = inspectBudget(fixture.handle, authorized.id);
    assert.equal(budget.reserved.tokens, 2);
    assert.equal(budget.spent.tokens, undefined);
    assert.equal(budget.uncertain, false);
  });

  it("e14s04 keyboard map and non-colour access paths qualify without hardware claims", () => {
    const bindings = keyboardMap();
    assert.ok(bindings.some((binding) => binding.keys.includes("?")));
    assert.ok(bindings.some((binding) => binding.keys.includes("s")));
    assert.equal(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true, textTerminal: true, keyboardMapComplete: true, pointerOnly: false, screenReader: "VoiceOver", terminal: "Terminal.app" }).status, "supported");
    assert.deepEqual(qualifyAccessPath({ keyboard: true, textStatus: false, utf8: true }).reason, "colour-only-status");
    assert.deepEqual(qualifyAccessPath({ keyboard: false, textStatus: true, utf8: true }).reason, "no-keyboard");
    assert.deepEqual(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: false }).reason, "non-utf8-terminal");
    assert.deepEqual(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true, textTerminal: true, keyboardMapComplete: true, pointerOnly: false, screenReader: "Other", terminal: "Terminal.app" }).reason, "unsupported-screen-reader-pairing");
    assert.deepEqual(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true, textTerminal: true, keyboardMapComplete: true, pointerOnly: false, screenReader: "VoiceOver" }).reason, "unsupported-screen-reader-pairing");
  });

  it("e14s04 empty status selects the latest live work item", () => {
    const fixture = projectFixture();
    fixtures.push(fixture);
    const owner = createOwnerCapability("owner-test");
    const input = classifiedInput(fixture.handle);
    const authorized = contract(fixture.handle, owner, [input.id]);
    const first = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "workspace-latest-1", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const second = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "workspace-latest-2", reservation: { tokens: 1, calls: 1, timeMs: 1 } });
    const session = workspaceSession(fixture.handle);
    const status = presentWorkStatus(session);
    assert.equal(status.runId, second.id);
    assert.notEqual(status.runId, first.id);
    assert.equal(status.status, "queued");
  });

  it("e14s04 unknown access evidence is blocked instead of assumed supported", () => {
    assert.equal(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true }).reason, "non-text-terminal");
    assert.equal(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true, textTerminal: true }).reason, "missing-keyboard-map");
    assert.equal(qualifyAccessPath({ keyboard: true, textStatus: true, utf8: true, textTerminal: true, keyboardMapComplete: true }).reason, "pointer-only");
  });
});
