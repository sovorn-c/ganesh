// story: e16s01 — Structured Redacted Diagnostics, Correlation IDs and Operational Health
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  openProject,
  createOwnerCapability,
  inspectOperationalHealth,
  recordDiagnostic,
  operationsSchemaAvailable,
  ProjectStoreError
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture
} from "../support/operations-fixtures.js";

describe("E16s01 operational health", () => {
  let fix: OperationsFixture;

  before(() => {
    fix = createOperationsFixture();
  });

  after(() => {
    disposeOperationsFixture(fix);
  });

  it("e16s01 operational health composes environment preflight with lock, schema, store-size, and diagnostic-store", () => {
    const report = inspectOperationalHealth(fix.handle, fix.ownerCap);

    assert.equal(report.schemaVersion, 1);
    assert.ok(report.checks.length >= 8, "must compose preflight checks with operational checks");

    const checkIds = report.checks.map((c) => c.id);
    assert.ok(checkIds.includes("node-runtime"), "must include preflight node-runtime");
    assert.ok(checkIds.includes("project-lock"), "must include project-lock");
    assert.ok(checkIds.includes("project-schema"), "must include project-schema");
    assert.ok(checkIds.includes("store-size"), "must include store-size");
    assert.ok(checkIds.includes("diagnostic-store"), "must include diagnostic-store");

    const lockCheck = report.checks.find((c) => c.id === "project-lock");
    assert.equal(lockCheck?.status, "ready");

    const schemaCheck = report.checks.find((c) => c.id === "project-schema");
    assert.equal(schemaCheck?.status, "ready");

    const diagCheck = report.checks.find((c) => c.id === "diagnostic-store");
    assert.equal(diagCheck?.status, "ready");
    assert.match(diagCheck?.evidence ?? "", /\d+\s*\/\s*10000/);
  });

  it("e16s01 health output strips secrets, Bearer tokens, emails, and participant content", () => {
    recordDiagnostic(fix.handle, {
      correlationId: "corr-health-redact",
      kind: "check",
      code: "secret-leak-attempt",
      message: "token=test-secret-value Bearer abc123def456 patient@example.test Alice Example MRN-0001"
    });

    const report = inspectOperationalHealth(fix.handle, fix.ownerCap);
    const jsonOutput = JSON.stringify(report);

    assert.doesNotMatch(jsonOutput, /test-secret-value/);
    assert.doesNotMatch(jsonOutput, /abc123def456/);
    assert.doesNotMatch(jsonOutput, /patient@example\.test/);
    assert.doesNotMatch(jsonOutput, /Alice Example/);
    assert.doesNotMatch(jsonOutput, /MRN-0001/);
  });

  it("e16s01 health on read-only missing operations tables reports operations-schema-unavailable without mutating database", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganesh-health-ro-"));
    const dbDir = join(tempDir, ".ganesh");
    mkdirSync(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "project.sqlite"));
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
      CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, root_path TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES ('p-ro-h', '${fix.ownerId}', '${tempDir}', 1, datetime('now'));
    `);
    db.close();

    const roHandle = openProject(tempDir, { readOnly: true });
    try {
      assert.equal(operationsSchemaAvailable(roHandle), false);

      assert.throws(
        () => inspectOperationalHealth(roHandle),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      const report = inspectOperationalHealth(roHandle, createOwnerCapability(fix.ownerId));
      assert.equal(report.status, "blocked");
      assert.equal(report.exitCode, 1);

      // Path-based CLI invocation succeeds without capability
      const pathReport = inspectOperationalHealth(tempDir);
      assert.equal(pathReport.status, "blocked");
      assert.equal(pathReport.exitCode, 1);

      const diagCheck = report.checks.find((c) => c.id === "diagnostic-store");
      assert.equal(diagCheck?.status, "blocking");
      assert.equal(diagCheck?.evidence, "operations-schema-unavailable");

      // Verify database was NOT mutated
      assert.equal(operationsSchemaAvailable(roHandle), false, "read-only health inspection must not create tables");
    } finally {
      roHandle.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("e16s01 worker and forged callers are denied authority to inspect health on project handle", () => {
    assert.throws(
      () => inspectOperationalHealth(fix.handle),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden",
      "project handle without capability must be denied"
    );

    assert.throws(
      () => inspectOperationalHealth(fix.handle, fix.workerCap),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    const forgedCap = { role: "owner", ownerId: fix.ownerId };
    assert.throws(
      () => inspectOperationalHealth(fix.handle, forgedCap),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    const wrongOwnerCap = createOwnerCapability("other-owner-456");
    assert.throws(
      () => inspectOperationalHealth(fix.handle, wrongOwnerCap),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  it("e16s01 complete returned health report, checks and executionMode are redacted", () => {
    const report = inspectOperationalHealth(fix.handle, fix.ownerCap);
    for (const check of report.checks) {
      assert.doesNotMatch(check.evidence, /token=[^\s]+|Bearer\s+[^\s]+|patient@|MRN-/);
      if (check.remediation) {
        assert.doesNotMatch(check.remediation, /token=[^\s]+|Bearer\s+[^\s]+|patient@|MRN-/);
      }
    }
    assert.doesNotMatch(report.executionMode.notice, /token=[^\s]+|Bearer\s+[^\s]+|patient@|MRN-/);
    if (report.executionMode.value) {
      assert.doesNotMatch(report.executionMode.value, /token=[^\s]+|Bearer\s+[^\s]+|patient@|MRN-/);
    }
  });

  it("e16s01 diagnostics CLI rejects non-finite, negative, fractional, and unsafe limits", () => {
    for (const value of ["-1", "1.5", "Infinity", "NaN", "9007199254740992"]) {
      const result = spawnSync(execPath, [join(process.cwd(), "dist/src/diagnostics-cli.js"), "--health", "--limit", value], { encoding: "utf8" });
      assert.equal(result.status, 2, `--limit ${value} must be rejected`);
      assert.match(result.stderr, /--limit must be a finite non-negative integer/);
    }
  });

  it("e16s01 diagnostics CLI executes health check and help", () => {
    const run = (args: string[]) => spawnSync(
      execPath,
      ["dist/src/diagnostics-cli.js", ...args],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    const help = run(["--help"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: ganesh-diagnostics/);

    const health = run(["--health", "--json", "--project-path", fix.root]);
    assert.equal(health.status, 1, "exit code must reflect report.exitCode (1 when blocked)");
    assert.match(health.stdout, /\"schemaVersion\": 1/);
  });

  it("e16s04 diagnostics CLI executes export and purge", () => {
    const run = (args: string[]) => spawnSync(
      execPath,
      ["dist/src/diagnostics-cli.js", ...args],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    const cliFix = createOperationsFixture();
    cliFix.handle.close();

    const exportDir = join(tmpdir(), `test-cli-export-${Date.now()}`);
    mkdirSync(exportDir, { recursive: true });

    try {
      const exportRes = run([
        "--export",
        "--destination-path",
        exportDir,
        "--project-path",
        cliFix.root,
        "--json"
      ]);
      assert.equal(exportRes.status, 0, `export failed: ${exportRes.stderr}`);
      assert.match(exportRes.stdout, /\"operationId\":/);

      const purgeRes = run([
        "--purge",
        "--project-path",
        cliFix.root,
        "--json"
      ]);
      assert.equal(purgeRes.status, 0, `purge failed: ${purgeRes.stderr}`);
      assert.match(purgeRes.stdout, /\"deletedCount\":/);
    } finally {
      rmSync(exportDir, { recursive: true, force: true });
      disposeOperationsFixture(cliFix);
    }
  });

  it("e16s04 npm run diagnostics executes through package.json script", () => {
    const npmRes = spawnSync(
      "npm",
      ["run", "diagnostics", "--", "--help"],
      { cwd: process.cwd(), encoding: "utf8" }
    );
    assert.equal(npmRes.status, 0, `npm run diagnostics failed: ${npmRes.stderr}`);
    assert.match(npmRes.stdout, /Usage: ganesh-diagnostics/);
  });
});
