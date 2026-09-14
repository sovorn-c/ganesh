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
  type SpecialistSessionPort,
} from "../../src/index.js";
import {
  projectFixture,
  disposeFixture,
  artifact,
} from "../support/project-fixtures.js";
import {
  literatureWorker,
  protocolFixture,
} from "../support/literature-fixtures.js";

describe("Provider retry budgets and timing", () => {
  it("retries honor maxRetries cap 2 and injected interval wait", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc1", "v1", "test input");
      classifyInput(fixture.handle, input.id, {
        sensitivity: "public",
        basis: "test",
      });
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "testing",
        authority: "owner-test",
      });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "retry-contract",
        objective: "retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 5, minProviderIntervalMs: 50 }, // capped at 2 retries (3 attempts total)
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "retry-cmd-01",
        reservation: { tokens: 1, calls: 3, timeMs: 100 },
      });

      let starts = 0;
      const waitCalls: number[] = [];
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "provider-flaky" };
        },
      };

      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
        {
          minIntervalMs: 50,
          wait: async (ms) => {
            waitCalls.push(ms);
          },
        },
      );

      assert.equal(result.status, "failed");
      assert.equal(
        starts,
        3,
        "must be called exactly 3 times (1 initial + 2 retries)",
      );
      assert.equal(
        waitCalls.length,
        2,
        "wait must be called between attempts (2 waits for 3 attempts)",
      );
      assert.ok(
        waitCalls.every((ms) => ms > 0),
        "every wait interval must be positive",
      );
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 3);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("retry admission never exceeds the reserved provider call budget", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-call-budget",
        "v1",
        "test input",
      );
      classifyInput(fixture.handle, input.id, {
        sensitivity: "public",
        basis: "test",
      });
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "testing",
        authority: "owner-test",
      });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "call-budget-contract",
        objective: "call budget retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "call-budget-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });

      let starts = 0;
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "provider-flaky" };
        },
      });

      assert.equal(
        starts,
        1,
        "a retry must not start after the reserved call budget is consumed",
      );
      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "calls-exhausted");
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 1);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("remaining timeMs exhaustion fails run without extra start and records diagnostic", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-time", "v1", "test input");
      classifyInput(fixture.handle, input.id, {
        sensitivity: "public",
        basis: "test",
      });
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "testing",
        authority: "owner-test",
      });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "time-exhaustion-contract",
        objective: "time exhaustion test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 50 },
        scope: { maxRetries: 2, minProviderIntervalMs: 10 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });

      // Run 1 exhausts the budget
      const run1 = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "time-run-01",
        reservation: { tokens: 1, calls: 1, timeMs: 50 },
      });

      // Settle run1 with usage of 50ms, exhausting the 50ms limit
      await dispatchRun(fixture.handle, owner, run1.id, {
        start: async () => ({ status: "ok", usage: { timeMs: 50 } }),
      });

      // Run 2 now has 0 remaining timeMs
      const run2 = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "time-run-02",
        reservation: { tokens: 1, calls: 1 },
      });

      let starts = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "ok" };
        },
      };

      const result = await dispatchRun(
        fixture.handle,
        owner,
        run2.id,
        sessionPort,
        {
          correlationId: "corr-time-exhausted",
        },
      );

      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "time-exhausted");
      assert.equal(
        starts,
        0,
        "sessionPort.start must not be called when time is exhausted",
      );

      const diagnostics = inspectDiagnostics(fixture.handle, owner, {
        correlationId: "corr-time-exhausted",
      });
      assert.ok(
        diagnostics.some((d) => d.code === "time-exhausted"),
        "must record time-exhausted diagnostic",
      );
    } finally {
      disposeFixture(fixture);
    }
  });

  it("reported provider time is consumed before admitting a retry", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-reported-time",
        "v1",
        "test input",
      );
      classifyInput(fixture.handle, input.id, {
        sensitivity: "public",
        basis: "test",
      });
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "testing",
        authority: "owner-test",
      });
      const proposed = proposeContract(fixture.handle, owner, {
        id: "reported-time-contract",
        objective: "reported time retry test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 2, timeMs: 50 },
        scope: { maxRetries: 1, minProviderIntervalMs: 0 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "reported-time-cmd-01",
        reservation: { tokens: 1, calls: 2, timeMs: 50 },
      });
      let starts = 0;
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          starts += 1;
          return {
            status: "failure",
            errorCode: "provider-time-used",
            usage: { timeMs: 50 },
          };
        },
      });
      assert.equal(result.status, "failed");
      assert.equal(result.failureReason, "time-exhausted");
      assert.equal(starts, 1);
      assert.equal(listProviderAttempts(fixture.handle, run.id).length, 1);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("injected wait runs without wall-clock sleep and provider attempt diagnostics are redacted", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-diag", "v1", "test input");
      classifyInput(fixture.handle, input.id, {
        sensitivity: "public",
        basis: "test",
      });
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "testing",
        authority: "owner-test",
      });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "injected-wait-contract",
        objective: "injected wait test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 5000 }, // 5 second interval requested
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "injected-cmd-01",
        reservation: { tokens: 1, calls: 2, timeMs: 100 },
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
            throw new Error(
              "provider error with Bearer token-secret-999 and doctor@example.test",
            );
          },
        },
        {
          correlationId: "corr-injected-01",
          minIntervalMs: 5000,
          wait: async (ms) => {
            waitLog.push(ms);
          },
        },
      );

      const elapsed = Date.now() - startTime;
      assert.ok(
        elapsed < 2000,
        `injected wait must not sleep wall-clock (elapsed: ${elapsed}ms)`,
      );
      assert.equal(waitLog.length, 1);
      assert.ok(
        waitLog[0] >= 4000 && waitLog[0] <= 5000,
        `waitMs should be around 5000ms (actual: ${waitLog[0]})`,
      );

      // Verify diagnostics are redacted
      const diags = inspectDiagnostics(fixture.handle, owner, {
        correlationId: "corr-injected-01",
      });
      for (const d of diags) {
        assert.ok(
          !d.message.includes("token-secret-999"),
          "secret must be redacted in diagnostic message",
        );
        assert.ok(
          !d.message.includes("doctor@example.test"),
          "email must be redacted in diagnostic message",
        );
      }
    } finally {
      disposeFixture(fixture);
    }
  });
});
