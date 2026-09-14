// story: e16s02 — Opt-in Diagnostic Export Without Research Content
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import {
  existsSync,
  readFileSync,
  rmSync,
  mkdtempSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import {
  recordDiagnostic,
  exportDiagnostics,
  inspectDiagnosticBundle,
  requestDisclosure,
  registerArtifactVersion,
  createOwnerCapability,
  ProjectStoreError,
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture,
} from "../support/operations-fixtures.js";

describe("Diagnostic bundle behavior", () => {
  let fix: OperationsFixture;
  let tempDirs: string[] = [];

  before(() => {
    fix = createOperationsFixture();
  });

  after(() => {
    disposeOperationsFixture(fix);
    for (const dir of tempDirs) {
      try {
        rmSync(dir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  function newTempBundleDir(): string {
    const dir = mkdtempSync(join(tmpdir(), "diag-bundle-test-"));
    tempDirs.push(dir);
    return join(dir, "bundle");
  }

  it("owner export writes directory diagnostic bundle with hash and jsonl", () => {
    recordDiagnostic(fix.handle, {
      correlationId: "corr-exp-01",
      kind: "dispatch",
      code: "DISPATCH_START",
      severity: "info",
      message: "dispatch started for run-01",
    });
    recordDiagnostic(fix.handle, {
      correlationId: "corr-exp-01",
      kind: "dispatch",
      code: "DISPATCH_COMPLETE",
      severity: "info",
      message: "dispatch finished successfully",
    });

    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-export-01",
      payloadHash: "hash-export-01",
      destinationPath: bundleDir,
      destination: "local",
      purpose: "local-debugging",
    });

    assert.ok(bundle.operationId);
    assert.equal(bundle.bundlePath, bundleDir);
    assert.equal(bundle.manifest.schemaVersion, 1);
    assert.equal(bundle.manifest.kind, "diagnostic");
    assert.equal(bundle.manifest.destination, "local");
    assert.equal(bundle.manifest.purpose, "local-debugging");

    const manifestPath = join(bundleDir, "ganesh-diagnostic-bundle.json");
    const jsonlPath = join(bundleDir, "events.jsonl");
    assert.ok(existsSync(manifestPath), "manifest file must exist");
    assert.ok(existsSync(jsonlPath), "events.jsonl file must exist");

    // Close project to prove inspection survives project close
    const standaloneFix = createOperationsFixture("owner-standalone");
    recordDiagnostic(standaloneFix.handle, {
      correlationId: "corr-close-01",
      kind: "test",
      code: "TEST_EVENT",
      severity: "info",
      message: "event before close",
    });
    const closedBundleDir = newTempBundleDir();
    exportDiagnostics(standaloneFix.handle, standaloneFix.ownerCap, {
      commandId: "cmd-export-close-01",
      payloadHash: "hash-export-close-01",
      destinationPath: closedBundleDir,
    });
    // Close the project
    standaloneFix.handle.close();

    const inspection = inspectDiagnosticBundle(closedBundleDir);
    assert.equal(inspection.valid, true);
    assert.ok(inspection.eventCount >= 1);
    assert.equal(inspection.manifest.kind, "diagnostic");
    assert.equal(inspection.manifest.schemaVersion, 1);
    assert.ok(inspection.hashResults.every((r) => r.match));

    rmSync(standaloneFix.root, { recursive: true, force: true });
  });

  it("identical command retry resumes and payload conflict rejects", () => {
    const bundleDir = newTempBundleDir();
    const first = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-retry-01",
      payloadHash: "hash-retry-01",
      destinationPath: bundleDir,
    });

    // Identical retry returns same bundle
    const second = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-retry-01",
      payloadHash: "hash-retry-01",
      destinationPath: bundleDir,
    });
    assert.equal(second.operationId, first.operationId);
    assert.equal(second.bundlePath, first.bundlePath);

    // Same command and hash cannot reuse a bundle for a different request identity.
    assert.throws(
      () =>
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-retry-01",
          payloadHash: "hash-retry-01",
          destinationPath: bundleDir,
          destination: "https://diagnostics.remote.test",
          purpose: "diagnostics-upload",
          optIn: true,
        }),
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );

    // Changed payloadHash with same commandId rejected with payload-conflict
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-retry-01",
          payloadHash: "hash-retry-DIFFERENT",
          destinationPath: bundleDir,
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "payload-conflict",
    );
  });

  it("bundle has no artifact tree and omits secret participant excerpt", () => {
    // Add an artifact version to project
    registerArtifactVersion(fix.handle, {
      logicalId: "sensitive-data",
      version: "v1",
      content: Buffer.from("super-secret research artifact data"),
    });

    // Record diagnostic with synthetic secrets and participant identifiers
    recordDiagnostic(fix.handle, {
      correlationId: "corr-sensitive-01",
      kind: "auth",
      code: "AUTH_CHECK",
      severity: "warning",
      message:
        "auth for alice.patient@example.test with Bearer token-secret-998877 and MRN-00123",
    });

    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-clean-01",
      payloadHash: "hash-clean-01",
      destinationPath: bundleDir,
    });

    // Must have NO artifacts directory
    assert.equal(existsSync(join(bundleDir, "artifacts")), false);

    // Check JSONL content does not contain secret, email, MRN or artifact content
    const jsonl = readFileSync(join(bundleDir, "events.jsonl"), "utf-8");
    assert.ok(
      !jsonl.includes("token-secret-998877"),
      "Bearer secret must not appear in JSONL",
    );
    assert.ok(
      !jsonl.includes("alice.patient@example.test"),
      "Email must not appear in JSONL",
    );
    assert.ok(!jsonl.includes("MRN-00123"), "MRN must not appear in JSONL");
    assert.ok(
      !jsonl.includes("super-secret research artifact data"),
      "Artifact bytes must not appear in bundle",
    );

    assert.ok(
      bundle.manifest.omissions && bundle.manifest.omissions.length > 0,
    );
  });

  it("destination and purpose in export manifest and disclosure are redacted", () => {
    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-redact-dest-01",
      payloadHash: "hash-redact-dest-01",
      destinationPath: bundleDir,
      destination: "https://example.com/dest?token=secret-abc",
      purpose: "diagnostics-for-patient@example.com",
      optIn: true,
    });

    assert.doesNotMatch(bundle.manifest.destination, /secret-abc/);
    assert.doesNotMatch(bundle.manifest.purpose, /patient@example\.com/);

    const manifestContent = readFileSync(
      join(bundleDir, "ganesh-diagnostic-bundle.json"),
      "utf-8",
    );
    assert.doesNotMatch(manifestContent, /secret-abc/);
    assert.doesNotMatch(manifestContent, /patient@example\.com/);
  });

  it("export replacement preserves old bundle when completion DB update fails", () => {
    const bundleDir = newTempBundleDir();
    const bundle1 = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-preserve-1",
      payloadHash: "hash-bundle-1",
      destinationPath: bundleDir,
    });
    assert.equal(bundle1.manifest.commandId, "cmd-bundle-preserve-1");

    // Install temporary SQLite trigger to simulate failure during UPDATE operations_commands
    fix.handle.db.exec(`
      CREATE TRIGGER fail_operations_commands_update
      BEFORE UPDATE ON operations_commands
      BEGIN
        SELECT RAISE(ABORT, 'simulated DB update failure');
      END;
    `);

    try {
      assert.throws(() => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-bundle-preserve-2",
          payloadHash: "hash-bundle-2",
          destinationPath: bundleDir,
        });
      }, /simulated DB update failure/);

      // The old bundle must be preserved intact!
      assert.ok(existsSync(join(bundleDir, "ganesh-diagnostic-bundle.json")));
      const manifest = JSON.parse(
        readFileSync(join(bundleDir, "ganesh-diagnostic-bundle.json"), "utf-8"),
      );
      assert.equal(
        manifest.commandId,
        "cmd-bundle-preserve-1",
        "old bundle manifest must be restored on failure",
      );
    } finally {
      fix.handle.db.exec(
        "DROP TRIGGER IF EXISTS fail_operations_commands_update;",
      );
    }
  });
});
