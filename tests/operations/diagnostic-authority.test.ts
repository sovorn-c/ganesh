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

describe("Diagnostic export authority", () => {
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

  it("worker capability denied export authority", () => {
    const bundleDir = newTempBundleDir();
    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.workerCap, {
          commandId: "cmd-worker-01",
          payloadHash: "hash-worker-01",
          destinationPath: bundleDir,
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
    assert.equal(
      existsSync(bundleDir),
      false,
      "no bundle directory should be created for worker",
    );
  });

  it("forged and wrong-owner capability denied export authority", () => {
    const bundleDir = newTempBundleDir();
    const wrongOwnerCap = createOwnerCapability("wrong-owner-id");

    assert.throws(
      () => {
        exportDiagnostics(fix.handle, wrongOwnerCap, {
          commandId: "cmd-wrong-01",
          payloadHash: "hash-wrong-01",
          destinationPath: bundleDir,
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
    assert.equal(existsSync(bundleDir), false);

    assert.throws(
      () => {
        exportDiagnostics(
          fix.handle,
          { forged: true },
          {
            commandId: "cmd-forged-01",
            payloadHash: "hash-forged-01",
            destinationPath: bundleDir,
          },
        );
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );
    assert.equal(existsSync(bundleDir), false);
  });

  it("remote destination denied without diagnostic disclosure and leaves no bundle", () => {
    const remoteBundleDir = newTempBundleDir();

    assert.throws(
      () => {
        exportDiagnostics(fix.handle, fix.ownerCap, {
          commandId: "cmd-remote-no-optin",
          payloadHash: "hash-remote-no-optin",
          destinationPath: remoteBundleDir,
          destination: "https://diagnostics.remote.test",
          purpose: "telemetry-upload",
          // optIn is false / absent
        });
      },
      (err: unknown) =>
        err instanceof ProjectStoreError && err.code === "forbidden",
    );

    assert.equal(
      existsSync(remoteBundleDir),
      false,
      "no bundle directory should remain on remote deny",
    );
  });
});
