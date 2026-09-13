// story: e16s04 — Resource Limits, Performance Budgets, Retention and Runbooks
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  inspectDiagnostics,
  exportDiagnostics,
  inspectDiagnosticBundle
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture
} from "../support/operations-fixtures.js";

describe("E16s04 performance budgets and large fixture exercise", () => {
  let fix: OperationsFixture;

  before(() => {
    fix = createOperationsFixture("owner-perf");
  });

  after(() => {
    disposeOperationsFixture(fix);
  });

  it("e16s04 SC-e16s04-P0-03 large synthetic project 5000 events inspect and export stay within budget without reading artifact-bytes", () => {
    // Populate synthetic large project:
    // 500 artifacts with non-existent storage paths to guarantee 0 artifact-bytes read
    // 200 work runs
    // 5000 diagnostic events
    fix.handle.db.exec("BEGIN TRANSACTION");

    const artStmt = fix.handle.db.prepare(`
      INSERT INTO artifact_versions (id, logical_id, version_label, content_hash, storage_path, byte_length, origin, access_level, content_status, created_at)
      VALUES (?, ?, 'v1', 'hash-nonexistent', ?, 256, 'derived', 'read-write', 'active', '2026-09-13T00:00:00.000Z')
    `);
    for (let i = 0; i < 500; i++) {
      artStmt.run(`art-ver-${i}`, `art-${i}`, `/nonexistent/path/synthetic-artifact-${i}.bin`);
    }

    fix.handle.db.prepare(`
      INSERT INTO work_contracts (id, version, budget_group_id, objective, scope, input_version_ids, permitted_roles, limits, destination, purpose, authorization_basis, status, created_at, updated_at)
      VALUES ('contract-perf', 1, 'bg-perf', 'perf test', 'all', '[]', '["researcher"]', '{}', 'local', 'research', 'owner', 'active', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')
    `).run();

    const opStmt = fix.handle.db.prepare(`
      INSERT INTO lifecycle_operations (id, operation_type, branch_id, input_snapshot, status, created_at, updated_at)
      VALUES (?, 'work', 'main', '{}', 'completed', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')
    `);
    const runStmt = fix.handle.db.prepare(`
      INSERT INTO work_runs (id, contract_id, contract_version, role, command_id, payload_hash, operation_id, input_version_ids, reserved, status, created_at, updated_at)
      VALUES (?, 'contract-perf', 1, 'researcher', ?, 'hash', ?, '[]', '{}', 'completed', '2026-09-13T00:00:00.000Z', '2026-09-13T00:00:00.000Z')
    `);
    for (let i = 0; i < 200; i++) {
      const opId = `op-perf-${i}`;
      const runId = `run-perf-${i}`;
      opStmt.run(opId);
      runStmt.run(runId, `cmd-perf-${i}`, opId);
    }

    const diagStmt = fix.handle.db.prepare(`
      INSERT INTO diagnostic_events (id, correlation_id, run_id, kind, code, severity, message, created_at)
      VALUES (?, ?, ?, 'perf', 'perf-event', 'info', 'synthetic diagnostic message for budget check', '2026-09-13T00:00:00.000Z')
    `);
    for (let i = 0; i < 5000; i++) {
      const runId = `run-perf-${i % 200}`;
      diagStmt.run(`diag-perf-${i}`, `corr-perf-${i % 100}`, runId);
    }

    fix.handle.db.exec("COMMIT");

    // Verify artifact count, run count, event count
    const artCount = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM artifact_versions").get() as { count: number }).count);
    const runCount = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM work_runs").get() as { count: number }).count);
    const eventCount = Number((fix.handle.db.prepare("SELECT COUNT(*) as count FROM diagnostic_events").get() as { count: number }).count);

    assert.equal(artCount, 500, "expected 500 artifact rows");
    assert.equal(runCount, 200, "expected 200 run rows");
    assert.equal(eventCount, 5000, "expected 5000 diagnostic events");

    // Exercise inspectDiagnostics and exportDiagnostics within documented 10s budget
    const startTime = performance.now();

    const events = inspectDiagnostics(fix.handle, fix.ownerCap);
    assert.equal(events.length, 5000);

    const exportDest = join(fix.root, "export-perf-bundle");
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-perf-export-5000",
      payloadHash: "hash-perf-export-5000",
      destinationPath: exportDest
    });

    const inspection = inspectDiagnosticBundle(bundle.bundlePath);
    assert.equal(inspection.valid, true);
    assert.equal(inspection.eventCount, 5000);

    const elapsedMs = performance.now() - startTime;
    assert.ok(
      elapsedMs < 10000,
      `large fixture inspect and export took ${elapsedMs.toFixed(1)}ms, expected < 10000ms budget`
    );
  });
});
