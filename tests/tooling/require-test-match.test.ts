import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

function runFilter(pattern: string): ReturnType<typeof spawnSync> {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  return spawnSync(process.execPath, ["scripts/require-test-match.mjs", pattern, "dist/tests/analysis/execution-policy.test.js"], {
    encoding: "utf8",
    env
  });
}

describe("test filter validation", () => {
  it("rejects patterns that match no tests", () => {
    const result = runFilter("pattern-that-matches-no-test-name");
    assert.notEqual(result.status, 0);
    assert.match(`${result.stdout ?? ""}${result.stderr ?? ""}`, /matched no tests/);
  });

  it("preserves valid filtered test commands", () => {
    const result = runFilter("e11s01.*policy");
    assert.equal(result.status, 0);
  });
});
