// story: e19s04
// scenario: SC-e19s04-P0-01 SC-e19s04-P0-02 SC-e19s04-P0-03 SC-e19s04-P1-04
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runWorkspace } from "../../src/workspace/launcher.js";
import { presentResearchEntry } from "../../src/workspace/entry-points.js";
import { FULL_ACCESS_NOTICE } from "../../src/runtime/preflight-constants.js";
import { presentExecutionModeGuidance } from "../../src/workspace/execution-mode-guidance.js";

describe("e19s04 execution-mode guidance", () => {
  it("renders the existing report without selecting an unconfigured mode", () => {
    const before = process.env.GANESH_EXECUTION_MODE;
    delete process.env.GANESH_EXECUTION_MODE;
    try {
      const view = presentExecutionModeGuidance();
      assert.equal(view.report.status, "not_configured");
      assert.equal(view.report.value, null);
      assert.match(view.text, /no execution mode is selected/i);
      assert.doesNotMatch(view.text, /selected mode: (ask|approve|full-access)/i);
    } finally {
      if (before === undefined) {delete process.env.GANESH_EXECUTION_MODE;}
      else {process.env.GANESH_EXECUTION_MODE = before;}
    }
  });

  it("keeps invalid values unselected and preserves the full-access notice", () => {
    const invalid = presentExecutionModeGuidance("later");
    assert.equal(invalid.report.status, "invalid");
    assert.equal(invalid.report.value, "later");
    assert.match(invalid.text, /no execution authority/i);
    const full = presentExecutionModeGuidance("full-access");
    assert.equal(full.report.status, "ready");
    assert.equal(full.report.value, "full-access");
    assert.match(full.text, new RegExp(FULL_ACCESS_NOTICE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.doesNotMatch(full.text, /full-access is a sandbox/i);
  });

  it("shows guidance at the specialist point of need", async () => {
    const root = mkdtempSync(join(tmpdir(), "ganesh-e19-mode-"));
    try {
      const result = await runWorkspace({ argv: [root], cwd: root, ownerId: "owner-test", ports: {
        runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false }
      }});
      assert.ok(result.session);
      const before = process.env.GANESH_EXECUTION_MODE;
      delete process.env.GANESH_EXECUTION_MODE;
      try {
        assert.match(presentResearchEntry(result.session, "specialist").text, /Execution mode: not_configured/);
      } finally {
        if (before === undefined) {delete process.env.GANESH_EXECUTION_MODE;}
        else {process.env.GANESH_EXECUTION_MODE = before;}
      }
      result.session.handle.close();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not write GANESH_EXECUTION_MODE", () => {
    const before = process.env.GANESH_EXECUTION_MODE;
    process.env.GANESH_EXECUTION_MODE = "approve";
    presentExecutionModeGuidance();
    assert.equal(process.env.GANESH_EXECUTION_MODE, "approve");
    if (before === undefined) {delete process.env.GANESH_EXECUTION_MODE;}
    else {process.env.GANESH_EXECUTION_MODE = before;}
  });
});
