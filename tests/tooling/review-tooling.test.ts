import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

test("preflight rejects the unsupported runtime fixture", () => {
  const result = spawnSync(
    "npm",
    ["run", "preflight", "--", "--fixture", "unsupported-runtime"],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Ganesh preflight: BLOCKED/);
  assert.match(result.stdout, /Node\.js 26\.x/);
});

test("preflight rejects unknown arguments", () => {
  const result = spawnSync(
    "npm",
    ["run", "preflight", "--", "--unknown"],
    { cwd: process.cwd(), encoding: "utf8" }
  );

  assert.equal(result.status, 2);
  assert.match(result.stderr, /unknown argument: --unknown/);
});
