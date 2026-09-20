// story: e19s02
// scenario: SC-e19s02-P0-01 SC-e19s02-P0-02 SC-e19s02-P0-03 SC-e19s02-P1-04
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import { runWorkspace } from "../../src/workspace/launcher.js";
import { createWorkerCapabilities } from "../../src/authority/capability-broker.js";
import { presentResearchEntry, RESEARCH_ENTRY_COMMANDS } from "../../src/workspace/entry-points.js";
import { presentAlternatives, presentHelp } from "../../src/workspace/steering.js";
import { registerWorkspaceCommands } from "../../src/workspace/extension.js";
import type { WorkspaceSession } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) {rmSync(root, { recursive: true, force: true });} });

async function sessionFixture(): Promise<WorkspaceSession> {
  const root = mkdtempSync(join(tmpdir(), "ganesh-e19-entry-"));
  roots.push(root);
  const result = await runWorkspace({ argv: [root], cwd: root, ownerId: "owner-test", ports: {
    runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false }
  }});
  assert.ok(result.session);
  return result.session;
}

describe("e19s02 focused research entry points", () => {
  it("registers six named commands and inspects through existing stores", async () => {
    const session = await sessionFixture();
    const registered: string[] = [];
    registerWorkspaceCommands({
      registerCommand: (name) => { registered.push(name); },
      registerShortcut: () => undefined
    }, session);
    for (const command of RESEARCH_ENTRY_COMMANDS) {assert.ok(registered.includes(command), command);}
    for (const kind of ["orient", "landscape", "screen", "appraise", "review", "specialist"] as const) {
      const view = presentResearchEntry(session, kind);
      assert.equal(view.status, "inspected");
      assert.equal(view.kind, kind);
    }
    const help = presentHelp(session);
    for (const command of RESEARCH_ENTRY_COMMANDS) {assert.match(help.text, new RegExp(`/${command}`));}
    assert.match(presentAlternatives(session).text, /No branch was adopted/);
    session.handle.close();
  });

  it("preserves owner idempotency and denies worker mutation", async () => {
    const session = await sessionFixture();
    const payload = JSON.stringify({ topic: "tool fatigue", discipline: "software engineering", immediateGoal: "frame a study", commandId: "orient-1" });
    assert.throws(
      () => presentResearchEntry(session, "orient", JSON.stringify({ topic: "tool fatigue", discipline: "software engineering", immediateGoal: "frame a study" })),
      /commandId/i
    );
    const first = presentResearchEntry(session, "orient", payload);
    const duplicate = presentResearchEntry(session, "orient", payload);
    assert.equal(first.status, "recorded");
    assert.deepEqual(duplicate.record, first.record);
    assert.throws(
      () => presentResearchEntry(session, "orient", JSON.stringify({ topic: "different", discipline: "software engineering", immediateGoal: "frame a study", commandId: "orient-1" })),
      /payload|conflict/i
    );
    const worker = createWorkerCapabilities({ projectId: session.handle.project.id, projectRoot: session.handle.project.rootPath, allowedOperations: ["*"] });
    assert.throws(() => presentResearchEntry(session, "orient", payload.replace("orient-1", "worker-1"), worker), /owner capability/i);
    session.handle.close();
  });
});
