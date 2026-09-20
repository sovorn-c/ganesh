// story: e19s01
// scenario: SC-e19s01-P0-01 SC-e19s01-P0-02 SC-e19s01-P0-03 SC-e19s01-P1-04
import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import { composeLaunchGuidance } from "../../src/workspace/guidance.js";
import { runWorkspace } from "../../src/workspace/launcher.js";
import type { TuiPort, WorkspaceRuntimePort, WorkspaceTuiOptions } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {rmSync(root, { recursive: true, force: true });}
});

class FakeTui implements TuiPort {
  readonly options: WorkspaceTuiOptions[] = [];
  async run(_runtime: object, options: WorkspaceTuiOptions): Promise<void> { this.options.push(options); }
  async confirm(): Promise<boolean> { return false; }
}

const runtime: WorkspaceRuntimePort = { create: () => ({}), dispose: () => undefined };

function launch(tui: FakeTui, root: string) {
  return runWorkspace({ argv: [root], cwd: root, ownerId: "owner-test", ports: { runtime, tui } });
}

describe("e19s01 launch guidance", () => {
  it("names Ganesh and its bounded Supervisor, omits restricted records, offers one safe action, and changes on return", async () => {
    const root = mkdtempSync(join(tmpdir(), "ganesh-e19-launch-"));
    roots.push(root);
    const firstTui = new FakeTui();
    const first = await launch(firstTui, root);
    assert.ok(first.session);
    const firstGuidance = composeLaunchGuidance(first.session);
    assert.match(firstGuidance.text, /Ganesh/);
    assert.match(firstGuidance.text, /bounded.*coordinating.*Supervisor/i);
    assert.doesNotMatch(firstGuidance.text, /academic supervisor/i);
    assert.equal(firstGuidance.returning, false);
    assert.ok(firstGuidance.nextAction.length > 0);
    assert.equal(firstGuidance.nextActions.length, 1);
    assert.equal(firstTui.options[0]?.initialMessage, firstGuidance.text);
    assert.ok(firstTui.options[0]?.initialMessages.includes(firstGuidance.nextAction));
    assert.doesNotMatch(firstGuidance.text, /pi:base-prompt/);
    assert.match(firstGuidance.text, /restricted records.*authorized inspection/i);
    first.session.handle.close();

    const secondTui = new FakeTui();
    const second = await launch(secondTui, root);
    assert.ok(second.session);
    const secondGuidance = composeLaunchGuidance(second.session);
    assert.equal(secondGuidance.returning, true);
    assert.doesNotMatch(secondGuidance.text, /first launch|welcome|onboarding/i);
    assert.equal(second.message, secondGuidance.text);
    assert.equal(secondTui.options[0]?.initialMessage, secondGuidance.text);
    second.session.handle.close();
  });
});
