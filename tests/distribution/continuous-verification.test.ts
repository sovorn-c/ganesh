// story: e19s05
// scenario: SC-e19s05-P0-02 SC-e19s05-P0-03
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { loadContinuousVerificationWorkflow } from "../../src/distribution/continuous-verification.js";

describe("e19s05 continuous verification workflow", () => {
  it("runs the pinned local gates on Node 24 for push and pull requests", () => {
    const report = loadContinuousVerificationWorkflow(process.cwd());
    assert.equal(report.valid, true);
    assert.deepEqual(report.triggers, ["push", "pull_request"]);
    assert.equal(report.nodeVersion, "24");
    assert.equal(report.runsOn, "ubuntu-latest");
    for (const command of ["npm run preflight", "npm test", "npm run typecheck", "npm run lint", "npm run build", "npm run qualify"]) {
      assert.ok(report.commands.includes(command), command);
    }
    assert.equal(report.forbiddenClaims.length, 0);
  });
});
