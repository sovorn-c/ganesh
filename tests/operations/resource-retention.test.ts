// story: e16s04 — Resource Limits, Performance Budgets, Retention and Runbooks
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  recordDiagnostic,
  inspectDiagnostics,
  inspectOperationalHealth,
  purgeDiagnosticEvents,
  registerArtifactVersion,
  createDecisionPacket,
  recordOwnerDecision,
  createOwnerCapability,
  ProjectStoreError,
  DIAGNOSTIC_EVENT_LIMIT
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture
} from "../support/operations-fixtures.js";

describe("E16s04 resource limits and retention purge", () => {
  let fix: OperationsFixture;

  before(() => {
    fix = createOperationsFixture("owner-retention");
  });

  after(() => {
    disposeOperationsFixture(fix);
  });

  it("e16s04 SC-e16s04-P0-01 recording at cap throws resource-limit and preserves event count", () => {
    // Insert events in batch to reach cap quickly
    const insertStmt = fix.handle.db.prepare(`
      INSERT INTO diagnostic_events (id, correlation_id, kind, code, severity, message, created_at)
      VALUES (?, 'corr-cap-batch', 'test', 'overflow-fill', 'info', 'fill message', '2026-09-13T00:00:00.000Z')
    `);

    const currentCount = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM diagnostic_events").get() as { count: number }).count);
    const toInsert = DIAGNOSTIC_EVENT_LIMIT - currentCount;

    fix.handle.db.exec("BEGIN TRANSACTION");
    for (let i = 0; i < toInsert; i++) {
      insertStmt.run(`diag-cap-seed-${i}`);
    }
    fix.handle.db.exec("COMMIT");

    assert.throws(
      () => {
        recordDiagnostic(fix.handle, {
          correlationId: "corr-overflow",
          kind: "test",
          code: "overflow-fail",
          severity: "error",
          message: "this should fail at cap"
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError);
        assert.equal(err.code, "resource-limit");
        return true;
      }
    );

    const afterCount = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM diagnostic_events").get() as { count: number }).count);
    assert.equal(afterCount, DIAGNOSTIC_EVENT_LIMIT);
  });

  it("e16s04 SC-e16s04-P0-01 health warns at 80 percent and blocks at cap", () => {
    const healthAtCap = inspectOperationalHealth(fix.handle, fix.ownerCap);
    const diagCheckAtCap = healthAtCap.checks.find((c) => c.id === "diagnostic-store");
    assert.ok(diagCheckAtCap);
    assert.equal(diagCheckAtCap.status, "blocking");

    // Temporarily reduce count to 8000
    fix.handle.db.prepare("DELETE FROM diagnostic_events WHERE id IN (SELECT id FROM diagnostic_events LIMIT 2000)").run();
    const count8000 = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM diagnostic_events").get() as { count: number }).count);
    assert.equal(count8000, 8000);

    const healthAt80 = inspectOperationalHealth(fix.handle, fix.ownerCap);
    const diagCheckAt80 = healthAt80.checks.find((c) => c.id === "diagnostic-store");
    assert.ok(diagCheckAt80);
    assert.equal(diagCheckAt80.status, "warning");

    // Reduce to below 80% (< 8000)
    fix.handle.db.prepare("DELETE FROM diagnostic_events WHERE id IN (SELECT id FROM diagnostic_events LIMIT 100)").run();
    const healthBelow80 = inspectOperationalHealth(fix.handle, fix.ownerCap);
    const diagCheckBelow80 = healthBelow80.checks.find((c) => c.id === "diagnostic-store");
    assert.ok(diagCheckBelow80);
    assert.equal(diagCheckBelow80.status, "ready");
  });

  it("e16s04 SC-e16s04-P0-02 purgeDiagnosticEvents deletes matching events and is idempotent", () => {
    // Clear all test events first
    fix.handle.db.exec("DELETE FROM diagnostic_events");

    recordDiagnostic(fix.handle, {
      correlationId: "corr-purge-a",
      kind: "test",
      code: "event-a",
      severity: "info",
      message: "event to be purged"
    });
    recordDiagnostic(fix.handle, {
      correlationId: "corr-purge-b",
      kind: "test",
      code: "event-b",
      severity: "info",
      message: "event to be preserved"
    });

    const purgeResult = purgeDiagnosticEvents(fix.handle, fix.ownerCap, {
      commandId: "cmd-purge-01",
      correlationId: "corr-purge-a"
    });

    assert.equal(purgeResult.commandId, "cmd-purge-01");
    assert.equal(purgeResult.deletedCount, 1);
    assert.equal(purgeResult.recalled, false);

    // Verify event A is deleted and event B is preserved
    const eventsA = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: "corr-purge-a" });
    assert.equal(eventsA.length, 0);

    const eventsB = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: "corr-purge-b" });
    assert.equal(eventsB.length, 1);

    // Identical retry succeeds idempotently
    const retryResult = purgeDiagnosticEvents(fix.handle, fix.ownerCap, {
      commandId: "cmd-purge-01",
      correlationId: "corr-purge-a"
    });
    assert.deepEqual(retryResult, purgeResult);

    // Conflicting payload with same commandId throws conflict
    assert.throws(
      () => {
        purgeDiagnosticEvents(fix.handle, fix.ownerCap, {
          commandId: "cmd-purge-01",
          correlationId: "corr-purge-different"
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError);
        assert.equal(err.code, "conflict");
        return true;
      }
    );
  });

  it("e16s04 SC-e16s04-P0-02 worker capability and wrong owner cannot purge", () => {
    assert.throws(
      () => {
        purgeDiagnosticEvents(fix.handle, fix.workerCap, {
          commandId: "cmd-purge-worker-denied"
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError);
        assert.equal(err.code, "forbidden");
        return true;
      }
    );

    const wrongOwnerCap = createOwnerCapability("wrong-owner-id");
    assert.throws(
      () => {
        purgeDiagnosticEvents(fix.handle, wrongOwnerCap, {
          commandId: "cmd-purge-wrong-owner"
        });
      },
      (err: unknown) => {
        assert.ok(err instanceof ProjectStoreError);
        assert.equal(err.code, "forbidden");
        return true;
      }
    );
  });

  it("e16s04 SC-e16s04-P0-02 purge does not delete research artifact versions or commitments tombstone", () => {
    const artifact = registerArtifactVersion(fix.handle, {
      logicalId: "art-retention-preserve",
      version: "v1",
      content: "# Research paper\nPreserved content."
    });
    assert.ok(artifact.id);

    const packet = createDecisionPacket(fix.handle, {
      question: "Preserve question",
      branchId: "main",
      candidateVersionIds: [artifact.id]
    });
    const decision = recordOwnerDecision(fix.handle, {
      capability: fix.ownerCap,
      commandId: "cmd-dec-preserve-1",
      packetId: packet.id,
      packetVersion: packet.packetVersion,
      disposition: "approved",
      selectedCandidateVersionIds: [artifact.id],
      rationale: "Accept hypothesis"
    });
    assert.ok(decision.commitmentId);

    // Execute broad purge
    purgeDiagnosticEvents(fix.handle, fix.ownerCap, {
      commandId: "cmd-purge-preserve-check"
    });

    // Verify artifact is still present and inspectable
    const artRow = fix.handle.db.prepare("SELECT * FROM artifact_versions WHERE logical_id = ?").get("art-retention-preserve");
    assert.ok(artRow, "artifact version must be preserved after purge");

    // Verify commitment is still present
    const commRow = fix.handle.db.prepare("SELECT * FROM commitments WHERE id = ?").get(decision.commitmentId);
    assert.ok(commRow, "commitment must be preserved after purge");
  });

  it("e16s04 SC-e16s04-P0-02 read-only handle is rejected by assertWritable on purge", () => {
    const roHandle = openProject(fix.root, { readOnly: true });
    try {
      assert.throws(
        () => {
          purgeDiagnosticEvents(roHandle, fix.ownerCap, {
            commandId: "cmd-purge-ro-denied"
          });
        },
        (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
      );
    } finally {
      roHandle.close();
    }
  });

  it("e16s04 purgeDiagnosticEvents completion event sanitizes and bounds secret-shaped metadata", () => {
    const secretCmd = "cmd-token=ghp_SECRETKEY1234567890-patient-MRN-998877";
    const secretRun = "run-Bearer token-secret-xyz-researcher@example.com";

    const result = purgeDiagnosticEvents(fix.handle, fix.ownerCap, {
      commandId: secretCmd,
      runId: secretRun
    });

    assert.equal(result.commandId, secretCmd);

    const completionRow = fix.handle.db.prepare(
      "SELECT command_id, run_id, message FROM diagnostic_events WHERE correlation_id = 'retention-purge' ORDER BY created_at DESC LIMIT 1"
    ).get() as { command_id?: string; run_id?: string; message?: string } | undefined;

    assert.ok(completionRow, "completion event must be recorded");
    assert.doesNotMatch(completionRow.command_id ?? "", /ghp_SECRETKEY|MRN-998877/);
    assert.match(completionRow.command_id ?? "", /\[REDACTED\]/);
    assert.doesNotMatch(completionRow.run_id ?? "", /token-secret-xyz|researcher@example\.com/);
    assert.match(completionRow.run_id ?? "", /\[REDACTED\]/);
    assert.ok((completionRow.command_id?.length ?? 0) <= 160);
    assert.ok((completionRow.run_id?.length ?? 0) <= 160);
  });
});
