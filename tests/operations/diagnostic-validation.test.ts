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

describe("Diagnostic export validation and replacement", () => {
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

  it("empty-source allowed for diagnostic and telemetry operations-only", () => {
    // 1. Diagnostic local allowed
    const diagLocal = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "local",
      purpose: "diagnostics-review",
    });
    assert.equal(diagLocal.status, "allow");

    // 2. Telemetry local allowed
    const telemLocal = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "telemetry",
      destination: "local",
      purpose: "perf-metrics",
    });
    assert.equal(telemLocal.status, "allow");

    // 3. Remote allowed with explicit destination, purpose and optIn
    const remoteAllowed = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "https://vendor-support.test",
      purpose: "crash-analysis",
      optIn: true,
    });
    assert.equal(remoteAllowed.status, "allow");
  });

  it("empty-source denied for prompt and export operations regression", () => {
    const promptReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "prompt",
      destination: "local",
      purpose: "test",
    });
    assert.equal(promptReq.status, "deny");
    assert.match(promptReq.reason, /no source versions/i);

    const exportReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "export",
      destination: "local",
      purpose: "test",
    });
    assert.equal(exportReq.status, "deny");
    assert.match(exportReq.reason, /no source versions/i);

    const summaryReq = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "summary",
      destination: "local",
      purpose: "test",
    });
    assert.equal(summaryReq.status, "deny");
    assert.match(summaryReq.reason, /no source versions/i);
  });

  it("research source version in export payload is refused", () => {
    const refused = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "local",
      purpose: "test",
      payload: { sourceVersions: ["art-version-001"] },
    });
    assert.equal(refused.status, "deny");
    assert.match(
      refused.reason,
      /payload contains research content or source versions/i,
    );

    const failDir = newTempBundleDir();
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-refused-01",
          payloadHash: "hash-refused-01",
          destinationPath: failDir,
          payload: { sourceVersions: ["art-version-001"] },
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
    assert.equal(existsSync(failDir), false);
  });

  it("empty-source operations-only fails closed for primitives, unknown keys, non-boolean flags", () => {
    // Primitives
    for (const primitive of [
      null,
      "string-payload",
      123,
      true,
      false,
      [1, 2, 3],
    ]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: primitive,
      });
      assert.equal(
        res.status,
        "deny",
        `primitive payload ${JSON.stringify(primitive)} must be denied`,
      );
    }

    // Unknown / content-bearing keys
    for (const key of [
      "content",
      "text",
      "artifacts",
      "sources",
      "sourceVersions",
      "unknownKey",
      "researchData",
    ]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: { [key]: "value" },
      });
      assert.equal(
        res.status,
        "deny",
        `payload with key ${key} must be denied`,
      );
    }

    // Non-boolean flags & case variations
    const nonBoolFlags = [
      { operationsOnly: "true" },
      { operationsOnly: 1 },
      { operationsOnly: false },
      { OPERATIONSOnly: false },
      { optIn: "yes" },
      { OPTIN: "yes" },
      { optIn: 1 },
    ];
    for (const flagPayload of nonBoolFlags) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: flagPayload,
      });
      assert.equal(
        res.status,
        "deny",
        `payload with non-boolean flag ${JSON.stringify(flagPayload)} must be denied`,
      );
    }
    for (const optIn of ["true", 1, false, new Boolean(true)]) {
      const res = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "remote",
        purpose: "test",
        optIn: optIn as unknown as boolean,
      });
      assert.equal(
        res.status,
        "deny",
        `request optIn ${String(optIn)} must require literal true`,
      );
    }
    const payloadOptIn = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "remote",
      purpose: "test",
      payload: { optIn: true },
    });
    assert.equal(
      payloadOptIn.status,
      "deny",
      "payload opt-in must not substitute for owner opt-in",
    );
    const undeclaredOwnerOptIn = requestDisclosure(fix.handle, {
      sourceVersions: [],
      operation: "diagnostic",
      destination: "remote",
      purpose: "test",
      ownerOptIn: true,
    } as Parameters<typeof requestDisclosure>[1]);
    assert.equal(
      undeclaredOwnerOptIn.status,
      "deny",
      "undeclared owner opt-in must not bypass the owner opt-in field",
    );

    // Invalid kind & case variations
    for (const invalidKindPayload of [
      { kind: "project" },
      { KIND: "project" },
      { Kind: "research" },
    ]) {
      const invalidKind = requestDisclosure(fix.handle, {
        sourceVersions: [],
        operation: "diagnostic",
        destination: "local",
        purpose: "test",
        payload: invalidKindPayload,
      });
      assert.equal(
        invalidKind.status,
        "deny",
        `invalid kind ${JSON.stringify(invalidKindPayload)} must be denied`,
      );
    }
  });

  it("cached bundle validation rejects tampering and symlinked or extra files", () => {
    const bundleDir = newTempBundleDir();
    const first = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-integrity-1",
      payloadHash: "hash-bundle-integrity-1",
      destinationPath: bundleDir,
    });
    writeFileSync(join(bundleDir, "events.jsonl"), "tampered\n", "utf-8");
    const repaired = exportDiagnostics(fix.handle, fix.ownerCap, {
      commandId: "cmd-bundle-integrity-1",
      payloadHash: "hash-bundle-integrity-1",
      destinationPath: bundleDir,
    });
    assert.equal(inspectDiagnosticBundle(repaired.bundlePath).valid, true);
    assert.notEqual(repaired.manifest.exportId, first.manifest.exportId);

    writeFileSync(join(bundleDir, "unlisted.json"), "hidden", "utf-8");
    assert.equal(inspectDiagnosticBundle(bundleDir).valid, false);
    rmSync(join(bundleDir, "unlisted.json"), { force: true });
    unlinkSync(join(bundleDir, "events.jsonl"));
    symlinkSync(
      join(bundleDir, "ganesh-diagnostic-bundle.json"),
      join(bundleDir, "events.jsonl"),
    );
    assert.throws(
      () => inspectDiagnosticBundle(bundleDir),
      (error: unknown) =>
        error instanceof ProjectStoreError && error.code === "path-escape",
    );
  });
});
