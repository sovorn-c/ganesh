// story: e16s01 — Structured Redacted Diagnostics, Correlation IDs and Operational Health
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  openProject,
  createOwnerCapability,
  registerArtifactVersion,
  recordDiagnostic,
  inspectDiagnostics,
  operationsSchemaAvailable,
  assertOperationsSchema,
  ProjectStoreError,
  classifyInput,
  grantDataUse,
  proposeContract,
  authorizeContract,
  queueRun,
  dispatchRun,
  type ProjectHandle,
  type SpecialistSessionPort
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture
} from "../support/operations-fixtures.js";

describe("E16s01 structured redacted diagnostics", () => {
  let fix: OperationsFixture;

  before(() => {
    fix = createOperationsFixture();
  });

  after(() => {
    disposeOperationsFixture(fix);
  });

  it("e16s01 schema initialization creates diagnostic tables and correlation timeline", () => {
    assert.ok(operationsSchemaAvailable(fix.handle), "operations schema must be available");
    assert.doesNotThrow(() => assertOperationsSchema(fix.handle));

    const event = recordDiagnostic(fix.handle, {
      correlationId: "corr-init-01",
      kind: "system",
      code: "sys-boot",
      severity: "info",
      message: "system initialized"
    });

    assert.ok(event.id);
    assert.equal(event.correlationId, "corr-init-01");
    assert.equal(event.code, "sys-boot");
    assert.equal(event.severity, "info");

    const events = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: "corr-init-01" });
    assert.equal(events.length, 1);
    assert.equal(events[0].id, event.id);

    // Reopen and verify persistence
    const reopened = openProject(fix.root);
    try {
      const reopenedEvents = inspectDiagnostics(reopened, fix.ownerCap, { correlationId: "corr-init-01" });
      assert.equal(reopenedEvents.length, 1);
      assert.equal(reopenedEvents[0].id, event.id);
    } finally {
      reopened.close();
    }
  });

  it("e16s01 timeline inspect returns redacted events keyed by correlation ID", () => {
    const corrA = "corr-timeline-A";
    const corrB = "corr-timeline-B";

    recordDiagnostic(fix.handle, {
      correlationId: corrA,
      kind: "dispatch",
      code: "event-a1",
      severity: "info",
      message: "dispatch step 1"
    });
    recordDiagnostic(fix.handle, {
      correlationId: corrB,
      kind: "dispatch",
      code: "event-b1",
      severity: "warning",
      message: "other correlation step"
    });
    recordDiagnostic(fix.handle, {
      correlationId: corrA,
      kind: "dispatch",
      code: "event-a2",
      severity: "error",
      message: "dispatch step 2"
    });

    const eventsA = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: corrA });
    assert.equal(eventsA.length, 2);
    assert.equal(eventsA[0].code, "event-a1");
    assert.equal(eventsA[1].code, "event-a2");

    const eventsB = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: corrB });
    assert.equal(eventsB.length, 1);
    assert.equal(eventsB[0].code, "event-b1");
  });

  it("e16s01 inspect redacts messages and preserves bounded code length", () => {
    const rawCode = "code-" + "x".repeat(200);
    const event = recordDiagnostic(fix.handle, {
      correlationId: "corr-bounds-01",
      kind: "test",
      code: rawCode,
      message: "normal short message"
    });

    assert.ok(event.code.length <= 160, "code must be bounded to <= 160 chars");
  });

  it("e16s01 capability check denies worker callers from inspect", () => {
    assert.throws(
      () => inspectDiagnostics(fix.handle, fix.workerCap, { correlationId: "corr-init-01" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  it("e16s01 forged and wrong-owner capabilities are denied authority to inspect", () => {
    const forgedCap = { role: "owner", ownerId: fix.ownerId };
    assert.throws(
      () => inspectDiagnostics(fix.handle, forgedCap, { correlationId: "corr-init-01" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    const wrongOwnerCap = createOwnerCapability("different-owner-id");
    assert.throws(
      () => inspectDiagnostics(fix.handle, wrongOwnerCap, { correlationId: "corr-init-01" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
  });

  it("e16s01 failed dispatch records redacted diagnostic timeline and correlation id", async () => {
    const input = registerArtifactVersion(fix.handle, {
      logicalId: "input-doc-01",
      version: "1",
      content: "sample test input content"
    });
    classifyInput(fix.handle, input.id, { sensitivity: "public", basis: "test" });
    grantDataUse(fix.handle, { inputVersion: input.id, destination: "local", purpose: "research", authority: fix.ownerId });

    const contract = proposeContract(fix.handle, fix.ownerCap, {
      objective: "analyze failure",
      permittedRoles: ["evidence"],
      inputVersionIds: [input.id],
      destination: "local",
      purpose: "research",
      limits: { tokens: 1000, calls: 2, timeMs: 5000 }
    });
    authorizeContract(fix.handle, fix.ownerCap, { contractId: contract.id });

    const run = queueRun(fix.handle, fix.ownerCap, {
      contractId: contract.id,
      commandId: "cmd-failed-dispatch-01"
    });

    const failingPort: SpecialistSessionPort = {
      start: async () => ({
        status: "failure",
        errorCode: "provider-timeout"
      })
    };

    const corrId = "corr-dispatch-fail-01";
    await dispatchRun(fix.handle, fix.ownerCap, run.id, failingPort, {
      correlationId: corrId
    });

    const events = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: corrId });
    assert.ok(events.length >= 1, "failed dispatch must record at least one diagnostic event");
    const failureEvent = events.find((e) => e.code.includes("provider-timeout"));
    assert.ok(failureEvent, "must find provider-timeout diagnostic event");
    assert.equal(failureEvent?.severity, "error");
    assert.equal(failureEvent?.runId, run.id);
  });

  it("e16s01 secret, Bearer token, email, and participant strings are stripped from stored diagnostics", () => {
    const secretMsg = "token=test-secret-value Bearer abc123def456 patient@example.test Alice Example MRN-0001 Basic c2VjcmV0";
    const event = recordDiagnostic(fix.handle, {
      correlationId: "corr-redact-01",
      kind: "security-test",
      code: "sec-check",
      message: secretMsg
    });

    assert.doesNotMatch(event.message, /test-secret-value/);
    assert.doesNotMatch(event.message, /abc123def456/);
    assert.doesNotMatch(event.message, /patient@example\.test/);
    assert.doesNotMatch(event.message, /Alice Example/);
    assert.doesNotMatch(event.message, /MRN-0001/);
    assert.doesNotMatch(event.message, /c2VjcmV0/);
    assert.match(event.message, /REDACTED/);

    const inspected = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: "corr-redact-01" });
    assert.equal(inspected.length, 1);
    assert.doesNotMatch(inspected[0].message, /test-secret-value/);
    assert.doesNotMatch(inspected[0].message, /patient@example\.test/);
  });

  it("e16s01 read-only project without operations schema reports operations-schema-unavailable on inspect", () => {
    // Create a temporary sqlite db without operations schema tables
    const tempDir = mkdtempSync(join(tmpdir(), "ganesh-ro-missing-"));
    const dbDir = join(tempDir, ".ganesh");
    mkdirSync(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "project.sqlite"));
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
      CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, root_path TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES ('p-ro', '${fix.ownerId}', '${tempDir}', 1, datetime('now'));
    `);
    db.close();

    const roHandle = openProject(tempDir, { readOnly: true });
    try {
      assert.equal(operationsSchemaAvailable(roHandle), false);
      assert.throws(
        () => inspectDiagnostics(roHandle, fix.ownerCap),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "operations-schema-unavailable"
      );
    } finally {
      roHandle.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("e16s01 secrets and participant content are redacted in kind, code, correlationId, commandId, and runId", () => {
    const event = recordDiagnostic(fix.handle, {
      correlationId: "corr-Bearer abc123def456 alice@example.com",
      commandId: "cmd-token=supersecret MRN-001",
      runId: "run-patient@hospital.test",
      kind: "kind-Bearer secret-key",
      code: "code-token=apikey-12345",
      message: "all fields test"
    });

    assert.doesNotMatch(event.correlationId, /abc123def456|alice@example\.com/);
    assert.doesNotMatch(event.commandId ?? "", /supersecret|MRN-001/);
    assert.doesNotMatch(event.runId ?? "", /patient@hospital\.test/);
    assert.doesNotMatch(event.kind, /secret-key/);
    assert.doesNotMatch(event.code, /apikey-12345/);

    const inspected = inspectDiagnostics(fix.handle, fix.ownerCap, { correlationId: event.correlationId });
    assert.equal(inspected.length, 1);
    assert.equal(inspected[0].id, event.id);
    assert.doesNotMatch(inspected[0].correlationId, /abc123def456|alice@example\.com/);
    assert.doesNotMatch(inspected[0].commandId ?? "", /supersecret|MRN-001/);
    assert.doesNotMatch(inspected[0].runId ?? "", /patient@hospital\.test/);
    assert.doesNotMatch(inspected[0].kind, /secret-key/);
    assert.doesNotMatch(inspected[0].code, /apikey-12345/);
  });

  it("e16s01 operationsSchemaAvailable verifies BOTH diagnostic_events and operations_commands", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganesh-schema-check-"));
    const dbDir = join(tempDir, ".ganesh");
    mkdirSync(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "project.sqlite"));
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
    `);

    // Initially neither table exists
    assert.equal(operationsSchemaAvailable(db), false);

    // Create ONLY diagnostic_events
    db.exec(`
      CREATE TABLE diagnostic_events (id TEXT PRIMARY KEY, correlation_id TEXT, command_id TEXT, run_id TEXT, kind TEXT, code TEXT, severity TEXT, message TEXT, created_at TEXT);
    `);
    assert.equal(operationsSchemaAvailable(db), false, "must be false when operations_commands is missing");

    // Create operations_commands
    db.exec(`
      CREATE TABLE operations_commands (id TEXT PRIMARY KEY, command_id TEXT, kind TEXT, payload_hash TEXT, status TEXT, result_data TEXT, created_at TEXT, updated_at TEXT);
    `);
    assert.equal(operationsSchemaAvailable(db), true, "must be true when both tables are present");

    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("e16s01 regression: closed handle throws on inspect", () => {
    const tempFix = createOperationsFixture("temp-owner");
    tempFix.handle.close();
    assert.throws(
      () => inspectDiagnostics(tempFix.handle, tempFix.ownerCap),
      (err: unknown) => err instanceof ProjectStoreError
    );
    rmSync(tempFix.root, { recursive: true, force: true });
  });
});
