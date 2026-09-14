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

describe("Provider cancellation and late results", () => {
  it("cancel between retry attempts stops further starts and fences run", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-cancel", "v1", "test input");
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
        id: "cancel-contract",
        objective: "cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 2, minProviderIntervalMs: 50 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "cancel-cmd-01",
        reservation: { tokens: 1, calls: 3, timeMs: 100 },
      });

      let starts = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          starts += 1;
          return { status: "failure", errorCode: "temporary-glitch" };
        },
      };

      // In the wait callback between attempt 1 and attempt 2, cancel the run!
      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
        {
          minIntervalMs: 50,
          wait: async () => {
            cancelRun(fixture.handle, owner, {
              runId: run.id,
              reason: "cancelled between attempts",
            });
          },
        },
      );

      assert.equal(
        starts,
        1,
        "sessionPort.start must stop after cancel and not attempt retry",
      );
      assert.equal(result.status, "cancelled");

      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(finalRun?.status, "cancelled");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("late candidate output remains quarantined after cancel", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-late", "v1", "test input");
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
        id: "late-contract",
        objective: "late candidate test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 10, timeMs: 5000 },
        scope: { maxRetries: 0 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "late-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });

      cancelRun(fixture.handle, owner, {
        runId: run.id,
        reason: "cancelled by owner",
      });

      const submission = await acceptSubmission(fixture.handle, owner, {
        runId: run.id,
        content: "late candidate submission after cancel",
      });

      assert.equal(submission.status, "quarantined");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("cancel before first start prevents start and never overwrites cancellation", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-pre-cancel",
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
        id: "pre-cancel-contract",
        objective: "pre-cancel test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 100 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "pre-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          return { status: "ok" };
        },
      };

      // Record a prior attempt on run.id so minInterval triggers wait before attempt 1
      recordProviderAttempt(fixture.handle, run.id, {
        destination: "local",
        purpose: "testing",
        attempt: 1,
        outcome: "ok",
        pricing: { status: "unknown" },
      });

      // Cancel before the first start executes (via admission wait hook)
      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
        {
          minIntervalMs: 50,
          wait: async () => {
            cancelRun(fixture.handle, owner, {
              runId: run.id,
              reason: "cancelled before first start",
            });
          },
        },
      );

      assert.equal(
        startsCalled,
        0,
        "sessionPort.start must never be called when cancelled before first start",
      );
      assert.equal(result.status, "cancelled");
      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(
        finalRun?.status,
        "cancelled",
        "run status must remain cancelled and not overwritten",
      );
    } finally {
      disposeFixture(fixture);
    }
  });

  it("cancel while start is pending is never overwritten with running or failed", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-pending-cancel",
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
        id: "pending-cancel-contract",
        objective: "pending-cancel test",
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
        commandId: "pending-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          // Simulate cancel while start is pending
          cancelRun(fixture.handle, owner, {
            runId: run.id,
            reason: "cancelled while start pending",
          });
          // Start completes successfully, but must NOT overwrite cancellation
          return { status: "ok", sessionId: "sess-pending-cancel" };
        },
      };

      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
      );

      assert.equal(startsCalled, 1);
      assert.equal(
        result.status,
        "cancelled",
        "dispatchRun must return cancelled",
      );

      const finalRun = getRun(fixture.handle, run.id);
      assert.equal(
        finalRun?.status,
        "cancelled",
        "final run in DB must remain cancelled, never overwritten with running",
      );

      const attempts = listProviderAttempts(fixture.handle, run.id);
      assert.equal(
        attempts.length,
        1,
        "attempt audit row must be preserved when cancel is observed after start",
      );
      assert.equal(attempts[0].outcome, "ok");
      assert.equal(attempts[0].sessionId, "sess-pending-cancel");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("in-flight deadline aborts the provider and quarantines its late result", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-deadline",
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
        id: "deadline-contract",
        objective: "deadline test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 1, timeMs: 20 },
        scope: { maxRetries: 0 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "deadline-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 20 },
      });
      let signal: AbortSignal | undefined;
      let release!: (result: {
        status: "ok";
        candidate: { runId: string; candidateId: string; content: string };
      }) => void;
      const pending = new Promise<{
        status: "ok";
        candidate: { runId: string; candidateId: string; content: string };
      }>((resolve) => {
        release = resolve;
      });
      const result = await dispatchRun(fixture.handle, owner, run.id, {
        start: async (request) => {
          signal = request.signal;
          request.signal?.addEventListener("abort", () => undefined);
          return pending;
        },
      });

      assert.equal(result.status, "failed");
      assert.equal(signal?.aborted, true);
      assert.equal(
        listProviderAttempts(fixture.handle, run.id)[0]?.outcome,
        "timeout",
      );
      release({
        status: "ok",
        candidate: {
          runId: run.id,
          candidateId: "late-deadline-candidate",
          content: "late output",
        },
      });
      await new Promise<void>((resolve) => setImmediate(resolve));
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(inspectQuarantine(fixture.handle, run.id).length, 1);
      recordProviderAttempt(fixture.handle, run.id, {
        destination: "https://provider.test/?token=attempt-secret",
        purpose: "patient@example.test",
        attempt: 99,
        outcome: "failure",
        pricing: { status: "unknown", reason: "api_key=attempt-secret" },
        sessionId: "session-token=attempt-secret",
      });
      const metadata = listProviderAttempts(fixture.handle, run.id).at(-1)!;
      assert.doesNotMatch(
        `${metadata.destination} ${metadata.purpose} ${metadata.pricing.reason ?? ""} ${metadata.sessionId ?? ""}`,
        /attempt-secret|patient@example\.test/,
      );
    } finally {
      disposeFixture(fixture);
    }
  });

  it("cancel observed after provider failure preserves attempt audit row and diagnostic event", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-fail-cancel",
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
        id: "fail-cancel-contract",
        objective: "fail cancel test",
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
        commandId: "fail-cancel-cmd-01",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });

      let startsCalled = 0;
      const sessionPort: SpecialistSessionPort = {
        start: async () => {
          startsCalled += 1;
          cancelRun(fixture.handle, owner, {
            runId: run.id,
            reason: "cancelled during failing start",
          });
          return { status: "failure", errorCode: "provider-upstream-timeout" };
        },
      };

      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
        {
          correlationId: "corr-fail-cancel-01",
        },
      );

      assert.equal(startsCalled, 1);
      assert.equal(result.status, "cancelled");

      const attempts = listProviderAttempts(fixture.handle, run.id);
      assert.equal(
        attempts.length,
        1,
        "failed attempt audit row must be preserved on post-start cancel",
      );
      assert.equal(attempts[0].outcome, "failure");

      const diagnostics = inspectDiagnostics(fixture.handle, owner, {
        correlationId: "corr-fail-cancel-01",
      });
      assert.ok(
        diagnostics.length >= 1,
        "failure diagnostic must be preserved on post-start cancel",
      );
      assert.equal(diagnostics[0].kind, "provider-failure");
      assert.equal(diagnostics[0].code, "provider-upstream-timeout");
    } finally {
      disposeFixture(fixture);
    }
  });
});
