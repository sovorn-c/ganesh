// story: e19s03
// scenario: SC-e19s03-P0-01 SC-e19s03-P0-02 SC-e19s03-P0-03 SC-e19s03-P1-04
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import { runWorkspace } from "../../src/workspace/launcher.js";
import { presentCompetencyAffordance, EXECUTABLE_COMPETENCY_IDS } from "../../src/workspace/competency-affordances.js";
import type { WorkspaceSession } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {rmSync(root, { recursive: true, force: true });} });

async function sessionFixture(): Promise<WorkspaceSession> {
  const root = mkdtempSync(join(tmpdir(), "ganesh-e19-competency-"));
  roots.push(root);
  const result = await runWorkspace({ argv: [root], cwd: root, ownerId: "owner-test", ports: {
    runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false }
  }});
  assert.ok(result.session);
  return result.session;
}

describe("e19s03 executable competency subset", () => {
  it("marks only five catalog rows executable and keeps provenance visible", async () => {
    const session = await sessionFixture();
    for (const id of EXECUTABLE_COMPETENCY_IDS) {
      const view = presentCompetencyAffordance(session, id);
      assert.equal(view.status, "executable");
      assert.ok(view.backingStore);
      assert.ok(view.provenance);
      assert.ok(view.uncertainty.length > 0);
      assert.ok(view.unsupportedContexts.length > 0);
    }
    const metadata = presentCompetencyAffordance(session, "comp-03");
    assert.equal(metadata.status, "metadata-only");
    assert.equal(metadata.implemented, false);
    assert.match(metadata.text, /metadata-only/i);
    assert.equal(EXECUTABLE_COMPETENCY_IDS.length, 5);
    session.handle.close();
  });

  it("requires escalation when context is outside competence or inputs are missing", async () => {
    const session = await sessionFixture();
    const outside = presentCompetencyAffordance(session, "comp-01", { competence: "outside-competence", contextId: "unsupported" });
    assert.ok(outside.escalation);
    assert.match(outside.escalation, /human/i);
    const missing = presentCompetencyAffordance(session, "comp-02", { providedInputs: [] });
    assert.ok(missing.escalation);
    assert.match(missing.text, /escalat|required input/i);
    session.handle.close();
  });
});
