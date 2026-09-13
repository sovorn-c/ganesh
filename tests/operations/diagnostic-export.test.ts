// story: e16s02 — Opt-in Diagnostic Export Without Research Content
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { existsSync, readFileSync, rmSync, mkdtempSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  recordDiagnostic,
  exportDiagnostics,
  inspectDiagnosticBundle,
  requestDisclosure,
  registerArtifactVersion,
  createOwnerCapability,
  ProjectStoreError
} from "../../src/index.js";
import {
  createOperationsFixture,
  disposeOperationsFixture,
  type OperationsFixture
} from "../support/operations-fixtures.js";

describe("E16s02 opt-in diagnostic export without research content", () => {
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

  it("e16s02 SC-e16s02-P0-01 owner export writes directory diagnostic bundle with hash and jsonl", () => {
    recordDiagnostic(fix.handle, {
      correlationId: "corr-exp-01",
      kind: "dispatch",
      code: "DISPATCH_START",
      severity: "info",
      message: "dispatch started for run-01"
    });
    recordDiagnostic(fix.handle, {
      correlationId: "corr-exp-01",
      kind: "dispatch",
      code: "DISPATCH_COMPLETE",
      severity: "info",
      message: "dispatch finished successfully"
    });

    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-export-01",
      payloadHash: "hash-export-01",
      destinationPath: bundleDir,
      destination: "local",
      purpose: "local-debugging"
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
      message: "event before close"
    });
    const closedBundleDir = newTempBundleDir();
    exportDiagnostics(standaloneFix.handle, standaloneFix.ownerCap, {
      commandId: "cmd-export-close-01",
      payloadHash: "hash-export-close-01",
      destinationPath: closedBundleDir
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

  it("e16s02 SC-e16s02-P0-01 identical command retry resumes and payload conflict rejects", () => {
    const bundleDir = newTempBundleDir();
    const first = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-retry-01",
      payloadHash: "hash-retry-01",
      destinationPath: bundleDir
    });

    // Identical retry returns same bundle
    const second = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-retry-01",
      payloadHash: "hash-retry-01",
      destinationPath: bundleDir
    });
    assert.equal(second.operationId, first.operationId);
    assert.equal(second.bundlePath, first.bundlePath);

    // Same command and hash cannot reuse a bundle for a different request identity.
    assert.throws(
      () => exportDiagnostics(fix.handle, fix.ownerCap, {
        commandId: "cmd-retry-01",
        payloadHash: "hash-retry-01",
        destinationPath: bundleDir,
        destination: "https://diagnostics.remote.test",
        purpose: "diagnostics-upload",
        optIn: true
      }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );

    // Changed payloadHash with same commandId rejected with payload-conflict
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-retry-01",
          payloadHash: "hash-retry-DIFFERENT",
          destinationPath: bundleDir
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
    );
  });

  it("e16s02 SC-e16s02-P0-03 worker capability denied export authority", () => {
    const bundleDir = newTempBundleDir();
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.workerCap, {
          commandId: "cmd-worker-01",
          payloadHash: "hash-worker-01",
          destinationPath: bundleDir
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.equal(existsSync(bundleDir), false, "no bundle directory should be created for worker");
  });

  it("e16s02 SC-e16s02-P0-03 forged and wrong-owner capability denied export authority", () => {
    const bundleDir = newTempBundleDir();
    const wrongOwnerCap = createOwnerCapability("wrong-owner-id");

    assert.throws(
      () => {
        exportDiagnostics(fix.handle, wrongOwnerCap, {
          commandId: "cmd-wrong-01",
          payloadHash: "hash-wrong-01",
          destinationPath: bundleDir
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.equal(existsSync(bundleDir), false);

    assert.throws(
      () => {
        exportDiagnostics(fix.handle, { forged: true }, {
          commandId: "cmd-forged-01",
          payloadHash: "hash-forged-01",
          destinationPath: bundleDir
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.equal(existsSync(bundleDir), false);
  });

  it("e16s02 SC-e16s02-P0-02 bundle has no artifact tree and omits secret participant excerpt", () => {
    // Add an artifact version to project
    registerArtifactVersion(fix.handle, {
      logicalId: "sensitive-data",
      version: "v1",
      content: Buffer.from("super-secret research artifact data")
    });

    // Record diagnostic with synthetic secrets and participant identifiers
    recordDiagnostic(fix.handle, {
      correlationId: "corr-sensitive-01",
      kind: "auth",
      code: "AUTH_CHECK",
      severity: "warning",
      message: "auth for alice.patient@example.test with Bearer token-secret-998877 and MRN-00123"
    });

    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-clean-01",
      payloadHash: "hash-clean-01",
      destinationPath: bundleDir
    });

    // Must have NO artifacts directory
    assert.equal(existsSync(join(bundleDir, "artifacts")), false);

    // Check JSONL content does not contain secret, email, MRN or artifact content
    const jsonl = readFileSync(join(bundleDir, "events.jsonl"), "utf-8");
    assert.ok(!jsonl.includes("token-secret-998877"), "Bearer secret must not appear in JSONL");
    assert.ok(!jsonl.includes("alice.patient@example.test"), "Email must not appear in JSONL");
    assert.ok(!jsonl.includes("MRN-00123"), "MRN must not appear in JSONL");
    assert.ok(!jsonl.includes("super-secret research artifact data"), "Artifact bytes must not appear in bundle");

    assert.ok(bundle.manifest.omissions && bundle.manifest.omissions.length > 0);
  });

  it("e16s02 SC-e16s02-P0-03 remote destination denied without diagnostic disclosure and leaves no bundle", () => {
    const remoteBundleDir = newTempBundleDir();

    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-remote-no-optin",
          payloadHash: "hash-remote-no-optin",
          destinationPath: remoteBundleDir,
          destination: "https://diagnostics.remote.test",
          purpose: "telemetry-upload"
          // optIn is false / absent
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    assert.equal(existsSync(remoteBundleDir), false, "no bundle directory should remain on remote deny");
  });

  it("e16s02 SC-e16s02-P1-04 empty-source allowed for diagnostic and telemetry operations-only", () => {
    // 1. Diagnostic local allowed
    const diagLocal = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "local",
      purpose: "diagnostics-review"
    });
    assert.equal(diagLocal.status, "allow");

    // 2. Telemetry local allowed
    const telemLocal = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "telemetry",
      destination: "local",
      purpose: "perf-metrics"
    });
    assert.equal(telemLocal.status, "allow");

    // 3. Remote allowed with explicit destination, purpose and optIn
    const remoteAllowed = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "https://vendor-support.test",
      purpose: "crash-analysis",
      optIn: true
    });
    assert.equal(remoteAllowed.status, "allow");
  });

  it("e16s02 SC-e16s02-P1-04 empty-source denied for prompt and export operations regression", () => {
    const promptReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "prompt",
      destination: "local",
      purpose: "test"
    });
    assert.equal(promptReq.status, "deny");
    assert.match(promptReq.reason, /no source versions/i);

    const exportReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "export",
      destination: "local",
      purpose: "test"
    });
    assert.equal(exportReq.status, "deny");
    assert.match(exportReq.reason, /no source versions/i);

    const summaryReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "summary",
      destination: "local",
      purpose: "test"
    });
    assert.equal(summaryReq.status, "deny");
    assert.match(summaryReq.reason, /no source versions/i);
  });

  it("e16s02 SC-e16s02-P1-04 research source version in export payload is refused", () => {
    const refused = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "local",
      purpose: "test",
      payload: { sourceVersions: ["art-version-001"] }
    });
    assert.equal(refused.status, "deny");
    assert.match(refused.reason, /payload contains research content or source versions/i);

    const failDir = newTempBundleDir();
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-refused-01",
          payloadHash: "hash-refused-01",
          destinationPath: failDir,
          payload: { sourceVersions: ["art-version-001"] }
        });
      },
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.equal(existsSync(failDir), false);
  });

  it("e16s02 SC-e16s02-P0-02 destination and purpose in export manifest and disclosure are redacted", () => {
    const bundleDir = newTempBundleDir();
    const bundle = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-redact-dest-01",
      payloadHash: "hash-redact-dest-01",
      destinationPath: bundleDir,
      destination: "https://example.com/dest?token=secret-abc",
      purpose: "diagnostics-for-patient@example.com",
      optIn: true
    });

    assert.doesNotMatch(bundle.manifest.destination, /secret-abc/);
    assert.doesNotMatch(bundle.manifest.purpose, /patient@example\.com/);

    const manifestContent = readFileSync(join(bundleDir, "ganesh-diagnostic-bundle.json"), "utf-8");
    assert.doesNotMatch(manifestContent, /secret-abc/);
    assert.doesNotMatch(manifestContent, /patient@example\.com/);
  });

  it("e16s02 SC-e16s02-P1-04 empty-source operations-only fails closed for primitives, unknown keys, non-boolean flags", () => {
    // Primitives
    for (const primitive of [null, "string-payload", 123, true, false, [1, 2, 3]]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: primitive
      });
      assert.equal(res.status, "deny", `primitive payload ${JSON.stringify(primitive)} must be denied`);
    }

    // Unknown / content-bearing keys
    for (const key of ["content", "text", "artifacts", "sources", "sourceVersions", "unknownKey", "researchData"]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: { [key]: "value" }
      });
      assert.equal(res.status, "deny", `payload with key ${key} must be denied`);
    }

    // Non-boolean flags & case variations
    const nonBoolFlags = [
      { operationsOnly: "true" },
      { operationsOnly: 1 },
      { operationsOnly: false },
      { OPERATIONSOnly: false },
      { optIn: "yes" },
      { OPTIN: "yes" },
      { optIn: 1 }
    ];
    for (const flagPayload of nonBoolFlags) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: flagPayload
      });
      assert.equal(res.status, "deny", `payload with non-boolean flag ${JSON.stringify(flagPayload)} must be denied`);
    }
    for (const optIn of ["true", 1, false, new Boolean(true)]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "remote",
        purpose: "test",
        optIn: optIn as unknown as boolean
      });
      assert.equal(res.status, "deny", `request optIn ${String(optIn)} must require literal true`);
    }
    const payloadOptIn = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "remote",
      purpose: "test",
      payload: { optIn: true }
    });
    assert.equal(payloadOptIn.status, "deny", "payload opt-in must not substitute for owner opt-in");
    const undeclaredOwnerOptIn = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "remote",
      purpose: "test",
      ownerOptIn: true
    } as Parameters<typeof requestDisclosure>[1]);
    assert.equal(undeclaredOwnerOptIn.status, "deny", "undeclared owner opt-in must not bypass the owner opt-in field");

    // Invalid kind & case variations
    for (const invalidKindPayload of [{ kind: "project" }, { KIND: "project" }, { Kind: "research" }]) {
      const invalidKind = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: invalidKindPayload
      });
      assert.equal(invalidKind.status, "deny", `invalid kind ${JSON.stringify(invalidKindPayload)} must be denied`);
    }
  });

  it("e16s02 cached bundle validation rejects tampering and symlinked or extra files", () => {
    const bundleDir = newTempBundleDir();
    const first = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-integrity-1",
      payloadHash: "hash-bundle-integrity-1",
      destinationPath: bundleDir
    });
    writeFileSync(join(bundleDir, "events.jsonl"), "tampered\n", "utf-8");
    const repaired = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-integrity-1",
      payloadHash: "hash-bundle-integrity-1",
      destinationPath: bundleDir
    });
    assert.equal(inspectDiagnosticBundle(repaired.bundlePath).valid, true);
    assert.notEqual(repaired.manifest.exportId, first.manifest.exportId);

    writeFileSync(join(bundleDir, "unlisted.json"), "hidden", "utf-8");
    assert.equal(inspectDiagnosticBundle(bundleDir).valid, false);
    rmSync(join(bundleDir, "unlisted.json"), { force: true });
    unlinkSync(join(bundleDir, "events.jsonl"));
    symlinkSync(join(bundleDir, "ganesh-diagnostic-bundle.json"), join(bundleDir, "events.jsonl"));
    assert.throws(() => inspectDiagnosticBundle(bundleDir), (error: unknown) => error instanceof ProjectStoreError && error.code === "path-escape");
  });

  it("e16s02 SC-e16s02-P0-01 export replacement preserves old bundle when completion DB update fails", () => {
    const bundleDir = newTempBundleDir();
    const bundle1 = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-preserve-1",
      payloadHash: "hash-bundle-1",
      destinationPath: bundleDir
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
      assert.throws(
        () => {
          exportDiagnostics(fix.handle, fix.ownerCap, {
            commandId: "cmd-bundle-preserve-2",
            payloadHash: "hash-bundle-2",
            destinationPath: bundleDir
          });
        },
        /simulated DB update failure/
      );

      // The old bundle must be preserved intact!
      assert.ok(existsSync(join(bundleDir, "ganesh-diagnostic-bundle.json")));
      const manifest = JSON.parse(readFileSync(join(bundleDir, "ganesh-diagnostic-bundle.json"), "utf-8"));
      assert.equal(manifest.commandId, "cmd-bundle-preserve-1", "old bundle manifest must be restored on failure");
    } finally {
      fix.handle.db.exec("DROP TRIGGER IF EXISTS fail_operations_commands_update;");
    }
  });
});
