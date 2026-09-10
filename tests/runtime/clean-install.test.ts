// story: e01s03
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCleanInstall } from "../../src/runtime/clean-install.js";

test("clean install reports an incomplete baseline", () => {
  const temporaryRoot = mkdtempSync(join(tmpdir(), "ganesh-clean-test-"));
  try {
    assert.equal(runCleanInstall(temporaryRoot), 1);
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
