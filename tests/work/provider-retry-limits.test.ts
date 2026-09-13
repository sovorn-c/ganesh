// story: e16s03 — Bounded Provider Retry, Rate, Time and Responsive Cancellation
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  acceptSubmission,
  authorizeContract,
  cancelRun,
  classifyInput,
  createOwnerCapability,
  dispatchRun,
  getRun,
  getSearchEvent,
  grantDataUse,
  inspectDiagnostics,
  inspectQuarantine,
  listProviderAttempts,
  openProject,
  recordProviderAttempt,
  proposeContract,
  queueRun,
  runAuthorizedRetrieval,
  type ProjectHandle,
  type SpecialistSessionPort
} from "../../src/index.js";
import { projectFixture, disposeFixture, artifact } from "../support/project-fixtures.js";
import { literatureWorker, protocolFixture } from "../support/literature-fixtures.js";

describe("E16s03 bounded provider retry, rate, time and responsive cancellation", () => {
  it("e16s03 SC-e16s03-P0-01 retries honor maxRetries cap 2 and injected interval wait", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc1", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "retry-contract",
        objective: "retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 5, minProviderIntervalMs: 50 } // capped at 2 retries (3 attempts total)
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "retry-cmd-01",
        reservation: { tokens: 1, calls: 3, timeMs: 100 }
      });

      let starts = 0;
      const waitCalls: number[] = [];
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "provider-flaky" };
        }
      };

      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort, {
        minIntervalMs: 50,
        wait: async (ms) => {
          waitCalls.push(ms);
        }
      });

      assert.equal(result.status, "failed");
      assert.equal(starts, 3, "must be called exactly 3 times (1 initial + 2 retries)");
      assert.equal(waitCalls.length, 2, "wait must be called between attempts (2 waits for 3 attempts)");
      assert.ok(waitCalls.every((ms) => ms > 0), "every wait interval must be positive");
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 3);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 retry admission never exceeds the reserved provider call budget", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-call-budget", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "call-budget-contract",
        objective: "call budget retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "call-budget-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let starts = 0;
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "provider-flaky" };
        }
      });

      assert.equal(starts, 1, "a retry must not start after the reserved call budget is consumed");
      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "calls-exhausted");
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 1);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-01 remaining timeMs exhaustion fails run without extra start and records diagnostic", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-time", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "time-exhaustion-contract",
        objective: "time exhaustion test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 50 },
        scope: { maxRetries: 2, minProviderIntervalMs: 10 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });

      // Run 1 exhausts the budget
      const run1 = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "time-run-01",
        reservation: { tokens: 1, calls: 1, timeMs: 50 }
      });

      // Settle run1 with usage of 50ms, exhausting the 50ms limit
      await dispatchRun(fixture.handle, owner, run1.id, {
        start: async () => ({ status: "ok", usage: { timeMs: 50 } })
      });

      // Run 2 now has 0 remaining timeMs
      const run2 = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "time-run-02",
        reservation: { tokens: 1, calls: 1 }
      });

      let starts = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "ok" };
        }
      };

      const result = await dispatchRun(fixture.handle, owner, run2.id, sessionPort, {
        correlationId: "corr-time-exhausted"
      });

      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "time-exhausted");
      assert.equal(starts, 0, "sessionPort.start must not be called when time is exhausted");

      const diagnostics = inspectDiagnostics(fixture.handle, owner, { correlationId: "corr-time-exhausted" });
      assert.ok(diagnostics.some((d) => d.code === "time-exhausted"), "must record time-exhausted diagnostic");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 reported provider time is consumed before admitting a retry", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-reported-time", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "reported-time-contract",
        objective: "reported time retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 2, timeMs: 50 },
        scope: { maxRetries: 1, minProviderIntervalMs: 0 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "reported-time-cmd-01", reservation: { tokens: 1, calls: 2, timeMs: 50 } });
      let starts = 0;
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "provider-time-used", usage: { timeMs: 50 } };
        }
      });
      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "time-exhausted");
      assert.equal(starts, 1);
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 1);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-02 cancel between retry attempts stops further starts and fences run", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-cancel", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "cancel-contract",
        objective: "cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 2, minProviderIntervalMs: 50 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "cancel-cmd-01",
        reservation: { tokens: 1, calls: 3, timeMs: 100 }
      });

      let starts = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "temporary-glitch" };
        }
      };

      // In the wait callback between attempt 1 and attempt 2, cancel the run!
      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort, {
        minIntervalMs: 50,
        wait: async () => {
          cancelRun(fixture.handle, owner, { runId: run.id, reason: "cancelled between attempts" });
        }
      });

      assert.equal(starts, 1, "sessionPort.start must stop after cancel and not attempt retry");
      assert.equal(result.status, "cancelled");

      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(finalRun?.status, "cancelled");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-02 late candidate output remains quarantined after cancel", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-late", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "late-contract",
        objective: "late candidate test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 0 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "late-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      cancelRun(fixture.handle, owner, { runId: run.id, reason: "cancelled by owner" });

      const submission = await acceptSubmission(fixture.handle, owner, {
        runId: run.id,
        content: "late candidate submission after cancel"
      });

      assert.equal(submission.status, "quarantined");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-03 destination denial and local-only material never fallback to unauthorized remote", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-local", "v1", "local only input");
      // Classified as restricted / local-only: no grant to provider-b
      classifyInput(fixture.handle, input.id, { sensitivity: "restricted", basis: "clinical trial" });
      // Only granted to local
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "local-only", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "denied-remote-contract",
        objective: "unauthorized remote attempt",
        inputVersionIds: [input.id],
        destination: "unauthorized-remote-service",
        purpose: "research-work",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "denied-remote-cmd",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let starts = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "ok" };
        }
      };

      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort);

      assert.equal(result.status, "blocked", "destination denial must block run without starts");
      assert.equal(starts, 0, "must never call sessionPort.start against unauthorized remote");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-03 failed retrieval search event remains failed and not complete on retry", async () => {
    const fixture = projectFixture();
    try {
      const { query } = protocolFixture(fixture.handle);
      const worker = literatureWorker(fixture.handle);

      // Attempt 1 fails
      const failedEvent1 = await runAuthorizedRetrieval(fixture.handle, worker, {
        commandId: "retrieval-attempt-1",
        queryVersionId: query.id,
        adapter: {
          retrieve: async () => ({
            status: "failed",
            errorCode: "upstream-500",
            hits: []
          })
        }
      });
      assert.equal(failedEvent1.status, "failed");

      // Attempt 2 fails
      const failedEvent2 = await runAuthorizedRetrieval(fixture.handle, worker, {
        commandId: "retrieval-attempt-2",
        queryVersionId: query.id,
        adapter: {
          retrieve: async () => ({
            status: "failed",
            errorCode: "upstream-503",
            hits: []
          })
        }
      });
      assert.equal(failedEvent2.status, "failed");

      // Verify that the original event remains "failed" and was NOT marked complete
      const rechecked1 = getSearchEvent(fixture.handle, worker, failedEvent1.id);
      assert.equal(rechecked1.status, "failed");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P1-04 injected wait runs without wall-clock sleep and provider attempt diagnostics are redacted", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-diag", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "injected-wait-contract",
        objective: "injected wait test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 5000 } // 5 second interval requested
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "injected-cmd-01",
        reservation: { tokens: 1, calls: 2, timeMs: 100 }
      });

      const waitLog: number[] = [];
      const startTime = Date.now();

      await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        {
          start: async () => {
            // Throw with synthetic secret/participant info
            throw new Error("provider error with Bearer token-secret-999 and doctor@example.test");
          }
        },
        {
          correlationId: "corr-injected-01",
          minIntervalMs: 5000,
          wait: async (ms) => {
            waitLog.push(ms);
          }
        }
      );

      const elapsed = Date.now() - startTime;
      assert.ok(elapsed < 2000, `injected wait must not sleep wall-clock (elapsed: ${elapsed}ms)`);
      assert.equal(waitLog.length, 1);
      assert.ok(waitLog[0] >= 4000 && waitLog[0] <= 5000, `waitMs should be around 5000ms (actual: ${waitLog[0]})`);

      // Verify diagnostics are redacted
      const diags = inspectDiagnostics(fixture.handle, owner, { correlationId: "corr-injected-01" });
      for (const d of diags) {
        assert.ok(!d.message.includes("token-secret-999"), "secret must be redacted in diagnostic message");
        assert.ok(!d.message.includes("doctor@example.test"), "email must be redacted in diagnostic message");
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-02 cancel before first start prevents start and never overwrites cancellation", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-pre-cancel", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "pre-cancel-contract",
        objective: "pre-cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 100 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "pre-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          return { status: "ok" };
        }
      };

      // Record a prior attempt on run.id so minInterval triggers wait before attempt 1
      recordProviderAttempt(fixture.handle, run.id, {
        destination: "local",
        purpose: "testing",
        attempt: 1,
        outcome: "ok",
        pricing: { status: "unknown" }
      });

      // Cancel before the first start executes (via admission wait hook)
      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort, {
        minIntervalMs: 50,
        wait: async () => {
          cancelRun(fixture.handle, owner, { runId: run.id, reason: "cancelled before first start" });
        }
      });

      assert.equal(startsCalled, 0, "sessionPort.start must never be called when cancelled before first start");
      assert.equal(result.status, "cancelled");
      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(finalRun?.status, "cancelled", "run status must remain cancelled and not overwritten");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 SC-e16s03-P0-02 cancel while start is pending is never overwritten with running or failed", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-pending-cancel", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "pending-cancel-contract",
        objective: "pending-cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "pending-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          // Simulate cancel while start is pending
          cancelRun(fixture.handle, owner, { runId: run.id, reason: "cancelled while start pending" });
          // Start completes successfully, but must NOT overwrite cancellation
          return { status: "ok", sessionId: "sess-pending-cancel" };
        }
      };

      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort);

      assert.equal(startsCalled, 1);
      assert.equal(result.status, "cancelled", "dispatchRun must return cancelled");

      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(finalRun?.status, "cancelled", "final run in DB must remain cancelled, never overwritten with running");

      const attempts = listProviderAttempts(fixture.handle, run.id);
      assert.equal(attempts.length, 1, "attempt audit row must be preserved when cancel is observed after start");
      assert.equal(attempts[0].outcome, "ok");
      assert.equal(attempts[0].sessionId, "sess-pending-cancel");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 dispatch admission rejects terminal current run states before start", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-terminal", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "terminal-admission-contract",
        objective: "terminal admission test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 50 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "terminal-admission-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          return { status: "ok" };
        }
      };

      // Record a prior attempt on run.id so minInterval triggers wait before attempt 1
      recordProviderAttempt(fixture.handle, run.id, {
        destination: "local",
        purpose: "testing",
        attempt: 1,
        outcome: "ok",
        pricing: { status: "unknown" }
      });

      // Transition run to 'succeeded' during wait hook before start
      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort, {
        minIntervalMs: 50,
        wait: async () => {
          fixture.handle.db.prepare("UPDATE work_runs SET status = 'succeeded' WHERE id = ?").run(run.id);
        }
      });

      assert.equal(startsCalled, 0, "sessionPort.start must never be called when run is already succeeded");
      assert.equal(result.status, "succeeded");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 concurrent dispatches claim one run before provider admission", async () => {
    const fixture = projectFixture();
    let secondHandle: ProjectHandle | undefined;
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-race", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "race-contract",
        objective: "race test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 2, timeMs: 5000 },
        scope: { maxRetries: 0 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "race-cmd-01", reservation: { tokens: 1, calls: 2, timeMs: 5000 } });
      secondHandle = openProject(fixture.root);
      let started = false;
      let releasePending!: (result: { status: "ok" }) => void;
      const pending = new Promise<{ status: "ok" }>((resolve) => { releasePending = resolve; });
      const firstDispatch = dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          started = true;
          return pending;
        }
      });
      while (!started) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await assert.rejects(
        dispatchRun(secondHandle, owner, run.id, { start: async () => ({ status: "ok" }) }),
        /already being dispatched/
      );
      cancelRun(fixture.handle, owner, { runId: run.id, reason: "race test complete" });
      assert.equal((await firstDispatch).status, "cancelled");
      releasePending({ status: "ok" });
    } finally {
      secondHandle?.close();
      disposeFixture(fixture);
    }
  });

  it("e16s03 in-flight deadline aborts the provider and quarantines its late result", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-deadline", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "deadline-contract",
        objective: "deadline test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 1, timeMs: 20 },
        scope: { maxRetries: 0 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, { contractId: authorized.id, commandId: "deadline-cmd-01", reservation: { tokens: 1, calls: 1, timeMs: 20 } });
      let signal: AbortSignal | undefined;
      let release!: (result: { status: "ok"; candidate: { runId: string; candidateId: string; content: string } }) => void;
      const pending = new Promise<{ status: "ok"; candidate: { runId: string; candidateId: string; content: string } }>((resolve) => { release = resolve; });
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async (request) => {
          signal = request.signal;
          request.signal?.addEventListener("abort", () => undefined);
          return pending;
        }
      });

      assert.equal(result.status, "failed");
      assert.equal(signal?.aborted, true);
      assert.equal(listProviderAttempts(fixture.handle, run.id)[0]?.outcome, "timeout");
      release({ status: "ok", candidate: { runId: run.id, candidateId: "late-deadline-candidate", content: "late output" } });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(inspectQuarantine(fixture.handle, run.id).length, 1);
      recordProviderAttempt(fixture.handle, run.id, {
        destination: "https://provider.test/?token=attempt-secret",
        purpose: "patient@example.test",
        attempt: 99,
        outcome: "failure",
        pricing: { status: "unknown", reason: "api_key=attempt-secret" },
        sessionId: "session-token=attempt-secret"
      });
      const metadata = listProviderAttempts(fixture.handle, run.id).at(-1)!;
      assert.doesNotMatch(`${metadata.destination} ${metadata.purpose} ${metadata.pricing.reason ?? ""} ${metadata.sessionId ?? ""}`, /attempt-secret|patient@example\.test/);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e16s03 cancel observed after provider failure preserves attempt audit row and diagnostic event", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-fail-cancel", "v1", "test input");
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "test" });
      grantDataUse(fixture.handle, { inputVersion: input.id, destination: "local", purpose: "testing", authority: "owner-test" });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "fail-cancel-contract",
        objective: "fail cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 }
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "fail-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 }
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          cancelRun(fixture.handle, owner, { runId: run.id, reason: "cancelled during failing start" });
          return { status: "failure", errorCode: "provider-upstream-timeout" };
        }
      };

      const result = await dispatchRun(fixture.handle, owner, run.id, sessionPort, {
        correlationId: "corr-fail-cancel-01"
      });

      assert.equal(startsCalled, 1);
      assert.equal(result.status, "cancelled");

      const attempts = listProviderAttempts(fixture.handle, run.id);
      assert.equal(attempts.length, 1, "failed attempt audit row must be preserved on post-start cancel");
      assert.equal(attempts[0].outcome, "failure");

      const diagnostics = inspectDiagnostics(fixture.handle, owner, { correlationId: "corr-fail-cancel-01" });
      assert.ok(diagnostics.length >= 1, "failure diagnostic must be preserved on post-start cancel");
      assert.equal(diagnostics[0].kind, "provider-failure");
      assert.equal(diagnostics[0].code, "provider-upstream-timeout");
    } finally {
      disposeFixture(fixture);
    }
  });
});
