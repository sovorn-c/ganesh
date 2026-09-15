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
  grantStandingPermission,
  inspectDiagnostics,
  inspectQuarantine,
  listProviderAttempts,
  openProject,
  ProjectStoreError,
  recordProviderAttempt,
  proposeContract,
  queueRun,
  retryRun,
  updateRun,
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

describe("Provider dispatch admission", () => {
  it("destination denial and local-only material never fallback to unauthorized remote", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-local",
        "v1",
        "local only input",
      );
      // Classified as restricted / local-only: no grant to provider-b
      classifyInput(fixture.handle, input.id, {
        sensitivity: "restricted",
        basis: "clinical trial",
      });
      // Only granted to local
      grantDataUse(fixture.handle, {
        inputVersion: input.id,
        destination: "local",
        purpose: "local-only",
        authority: "owner-test",
      });

      const proposed = proposeContract(fixture.handle, owner, {
        id: "denied-remote-contract",
        objective: "unauthorized remote attempt",
        inputVersionIds: [input.id],
        destination: "unauthorized-remote-service",
        purpose: "research-work",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 2 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "denied-remote-cmd",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
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
        run.id,
        sessionPort,
      );

      assert.equal(
        result.status,
        "blocked",
        "destination denial must block run without starts",
      );
      assert.equal(
        starts,
        0,
        "must never call sessionPort.start against unauthorized remote",
      );
    } finally {
      disposeFixture(fixture);
    }
  });

  it("failed retrieval search event remains failed and not complete on retry", async () => {
    const fixture = projectFixture();
    try {
      const { query } = protocolFixture(fixture.handle);
      const worker = literatureWorker(fixture.handle);

      // Attempt 1 fails
      const failedEvent1 = await runAuthorizedRetrieval(
        fixture.handle,
        worker,
        {
          commandId: "retrieval-attempt-1",
          queryVersionId: query.id,
          adapter: {
            retrieve: async () => ({
              status: "failed",
              errorCode: "upstream-500",
              hits: [],
            }),
          },
        },
      );
      assert.equal(failedEvent1.status, "failed");

      // Attempt 2 fails
      const failedEvent2 = await runAuthorizedRetrieval(
        fixture.handle,
        worker,
        {
          commandId: "retrieval-attempt-2",
          queryVersionId: query.id,
          adapter: {
            retrieve: async () => ({
              status: "failed",
              errorCode: "upstream-503",
              hits: [],
            }),
          },
        },
      );
      assert.equal(failedEvent2.status, "failed");

      // Verify that the original event remains "failed" and was NOT marked complete
      const rechecked1 = getSearchEvent(
        fixture.handle,
        worker,
        failedEvent1.id,
      );
      assert.equal(rechecked1.status, "failed");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("dispatch admission rejects terminal current run states before start", async () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(
        fixture.handle,
        "doc-terminal",
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
        id: "terminal-admission-contract",
        objective: "terminal admission test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 5, timeMs: 5000 },
        scope: { maxRetries: 1, minProviderIntervalMs: 50 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "terminal-admission-cmd-01",
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

      // Transition run to 'succeeded' during wait hook before start
      const result = await dispatchRun(
        fixture.handle,
        owner,
        run.id,
        sessionPort,
        {
          minIntervalMs: 50,
          wait: async () => {
            fixture.handle.db
              .prepare("UPDATE work_runs SET status = 'succeeded' WHERE id = ?")
              .run(run.id);
          },
        },
      );

      assert.equal(
        startsCalled,
        0,
        "sessionPort.start must never be called when run is already succeeded",
      );
      assert.equal(result.status, "succeeded");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e10s04 standing authorization binds scope and every permitted role", () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "standing-scope-input", "v1", "test input");
      const standing = grantStandingPermission(fixture.handle, owner, {
        id: "standing-scope-permission",
        role: "evidence",
        scope: { dataClasses: ["public"] },
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 }
      });
      const mismatchedScope = proposeContract(fixture.handle, owner, {
        id: "standing-scope-mismatch",
        objective: "standing scope mismatch",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 },
        scope: { dataClasses: ["identifiable"] },
        permittedRoles: ["evidence"]
      });
      assert.throws(
        () => authorizeContract(fixture.handle, owner, { contractId: mismatchedScope.id, standingPermissionId: standing.id }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      const mismatchedRole = proposeContract(fixture.handle, owner, {
        id: "standing-role-mismatch",
        objective: "standing role mismatch",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 },
        scope: { dataClasses: ["public"] },
        permittedRoles: ["evidence", "reviewer"]
      });
      assert.throws(
        () => authorizeContract(fixture.handle, owner, { contractId: mismatchedRole.id, standingPermissionId: standing.id }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
      const matching = proposeContract(fixture.handle, owner, {
        id: "standing-scope-match",
        objective: "standing scope match",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 },
        scope: { dataClasses: ["public"] },
        permittedRoles: ["evidence"]
      });
      assert.equal(authorizeContract(fixture.handle, owner, { contractId: matching.id, standingPermissionId: standing.id }).status, "authorized");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e10s04 standing permission and structured contract context stay bound across retry", () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "standing-input", "v1", "test input");
      const proposed = proposeContract(fixture.handle, owner, {
        id: "standing-contract",
        objective: "standing contract",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 },
        scope: { dataClasses: ["survey"] },
        permittedRoles: ["evidence"],
      });
      const standing = grantStandingPermission(fixture.handle, owner, {
        id: "standing-permission",
        role: "evidence",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 10, calls: 3, timeMs: 1000 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
        standingPermissionId: standing.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "standing-run-1",
        reservation: { tokens: 1, calls: 1, timeMs: 100 },
      });
      updateRun(fixture.handle, run.id, "failed", "retry coverage setup");
      const retried = retryRun(fixture.handle, owner, run.id, "standing-run-2");
      assert.notEqual(retried.id, run.id);
      assert.deepEqual(retried.inputVersionIds, [input.id]);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e10s04 queueRun removes its lifecycle operation when the initial budget reservation is rejected", () => {
    const fixture = projectFixture();
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "budget-input", "v1", "test input");
      const proposed = proposeContract(fixture.handle, owner, {
        id: "budget-reject-contract",
        objective: "budget rejection",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 1, calls: 1, timeMs: 10 },
      });
      const authorized = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
      const beforeOperations = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM lifecycle_operations").get() as { count: number }).count;
      assert.throws(
        () => queueRun(fixture.handle, owner, {
          contractId: authorized.id,
          commandId: "budget-reject-run",
          reservation: { tokens: 2, calls: 1, timeMs: 10 },
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "budget-exhausted",
      );
      const afterOperations = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM lifecycle_operations").get() as { count: number }).count;
      assert.equal(afterOperations, beforeOperations);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("concurrent dispatches claim one run before provider admission", async () => {
    const fixture = projectFixture();
    let secondHandle: ProjectHandle | undefined;
    try {
      const owner = createOwnerCapability("owner-test");
      const input = artifact(fixture.handle, "doc-race", "v1", "test input");
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
        id: "race-contract",
        objective: "race test",
        inputVersionIds: [input.id],
        destination: "local",
        purpose: "testing",
        limits: { tokens: 100, calls: 2, timeMs: 5000 },
        scope: { maxRetries: 0 },
      });
      const authorized = authorizeContract(fixture.handle, owner, {
        contractId: proposed.id,
      });
      const run = queueRun(fixture.handle, owner, {
        contractId: authorized.id,
        commandId: "race-cmd-01",
        reservation: { tokens: 1, calls: 2, timeMs: 5000 },
      });
      secondHandle = openProject(fixture.root);
      let started = false;
      let releasePending!: (result: { status: "ok" }) => void;
      const pending = new Promise<{ status: "ok" }>((resolve) => {
        releasePending = resolve;
      });
      const firstDispatch = dispatchRun(fixture.handle, owner, run.id, {
        start: async () => {
          started = true;
          return pending;
        },
      });
      while (!started) {
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await assert.rejects(
        dispatchRun(secondHandle, owner, run.id, {
          start: async () => ({ status: "ok" }),
        }),
        /already being dispatched/,
      );
      cancelRun(fixture.handle, owner, {
        runId: run.id,
        reason: "race test complete",
      });
      assert.equal((await firstDispatch).status, "cancelled");
      releasePending({ status: "ok" });
    } finally {
      secondHandle?.close();
      disposeFixture(fixture);
    }
  });
});
