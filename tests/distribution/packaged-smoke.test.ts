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
