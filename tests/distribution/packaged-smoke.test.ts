import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { runPackagedSmoke } from "../../src/distribution/smoke.js";
import { createTempPrefix } from "../support/distribution-fixtures.js";

test("e18s01 SC-e18s01-P0-02 runPackagedSmoke packs installs into prefix and passes print-launch and preflight smoke", async () => {
  const temp = createTempPrefix("smoke-test-");
  try {
    const report = await runPackagedSmoke({
      root: process.cwd(),
      prefix: temp.dir
    });

    assert.equal(report.status, "pass");
    assert.equal(report.printLaunchExitCode, 0);
    assert.equal(report.preflightExitCode, 0);
    assert.equal(report.matrixRowVerified, true);
    assert.ok(report.printLaunchOutput.includes("Ganesh workspace") || report.printLaunchOutput.includes("ready"));
    assert.ok(fs.existsSync(report.tarballPath));
    assert.equal(report.prefix, temp.dir);

    // Verify prefix is isolated and not user global prefix
    assert.notEqual(report.prefix, "/usr");
    assert.notEqual(report.prefix, "/usr/local");
    assert.ok(report.prefix.includes("smoke-test-"));
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-02 runPackagedSmoke rejects non-isolated or unsafe prefix", async () => {
  await assert.rejects(
    async () => {
      await runPackagedSmoke({ prefix: "/" });
    },
    /isolated prefix/i
  );
});

test("e18s01 SC-e18s01-P0-02 runPackagedSmoke rejects prefix symlinked to /usr (CWE-59)", async () => {
  const temp = createTempPrefix("smoke-symlink-");
  try {
    const symlinkPath = path.join(temp.dir, "symlink-to-usr");
    try {
      fs.symlinkSync("/usr", symlinkPath);
    } catch {
      // If symlink creation fails on unprivileged platform, skip
      return;
    }

    await assert.rejects(
      async () => {
        await runPackagedSmoke({ prefix: symlinkPath });
      },
      /isolated prefix|rejected (unsafe|system) prefix/i
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s01 SC-e18s01-P0-03 runPackagedSmoke fails when verified row points to nonexistent evidence", async () => {
  const temp = createTempPrefix("smoke-bad-pointer-");
  try {
    // Create fake root with bad evidence pointer
    const fakeRoot = path.join(temp.dir, "fake-root");
    fs.mkdirSync(path.join(fakeRoot, "specs", "distribution"), { recursive: true });
    fs.writeFileSync(
      path.join(fakeRoot, "specs", "distribution", "support-matrix.json"),
      JSON.stringify({
        version: "0.1.0",
        scholarlyCertification: false,
        combinations: [
          {
            os: process.platform,
            arch: process.arch,
            nodeMajor: 24,
            status: "verified",
            evidencePointer: "specs/verifications/nonexistent-verify.yaml"
          }
        ]
      })
    );
    // Copy package.json to fakeRoot so npm pack works
    fs.copyFileSync(path.join(process.cwd(), "package.json"), path.join(fakeRoot, "package.json"));

    const report = await runPackagedSmoke({
      root: fakeRoot,
      prefix: path.join(temp.dir, "prefix")
    });

    assert.equal(report.status, "fail");
    assert.equal(report.matrixRowVerified, false);
    assert.ok(
      report.reasons?.some((r) => r.includes("evidence pointer not found")),
      "must record nonexistent evidence pointer failure"
    );
  } finally {
    temp.cleanup();
  }
});
