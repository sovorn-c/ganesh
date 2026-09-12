import { strict as assert } from "node:assert";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  isOwnerCapability,
  type TuiPort,
  type WorkspaceLaunchRequest,
  type WorkspaceRuntimePort
} from "../../src/index.js";
import { runWorkspace } from "../../src/workspace/launcher.js";
import type { WorkspaceRuntimeOptions } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

class FakeRuntimePort implements WorkspaceRuntimePort {
  readonly options: WorkspaceRuntimeOptions[] = [];

  create(options: WorkspaceRuntimeOptions): object {
    this.options.push(options);
    return { cwd: options.cwd };
  }
}

class FakeTuiPort implements TuiPort {
  readonly runs: object[] = [];
  confirmations: boolean[] = [];

  async run(runtime: object): Promise<void> {
    this.runs.push(runtime);
  }

  async confirm(): Promise<boolean> {
    return this.confirmations.shift() ?? false;
  }

  notify(): void {
    // Test adapter intentionally does not render terminal output.
  }
}

function fixtureRoot(): string {
  const root = mkdtempSync(join("/tmp", "ganesh-e14-workspace-"));
  roots.push(root);
  return root;
}

function request(root: string, runtime = new FakeRuntimePort(), tui = new FakeTuiPort()): WorkspaceLaunchRequest {
  return { argv: [root], cwd: root, ownerId: "owner-test", ports: { runtime, tui } };
}

describe("E14 workspace launcher", () => {
  it("e14s01 argv intake creates then reopens and binds project-local agent.dir", async () => {
    const root = fixtureRoot();
    const firstRuntime = new FakeRuntimePort();
    const first = await runWorkspace(request(root, firstRuntime));
    assert.equal(first.status, "created");
    assert.equal(first.session?.handle.project.rootPath, resolve(root));
    assert.equal(firstRuntime.options[0]?.cwd, resolve(root));
    assert.equal(firstRuntime.options[0]?.agentDir, join(resolve(root), ".ganesh", "pi"));
    first.session?.handle.close();

    const secondRuntime = new FakeRuntimePort();
    const second = await runWorkspace(request(root, secondRuntime));
    assert.equal(second.status, "reopened");
    assert.equal(second.session?.handle.project.rootPath, resolve(root));
    assert.equal(secondRuntime.options[0]?.agentDir, join(resolve(root), ".ganesh", "pi"));
    second.session?.handle.close();
  });

  it("e14s01 missing unreadable directory and escape intake fail closed without pi.config", async () => {
    const root = fixtureRoot();
    const missing = join(root, "missing");
    const file = join(root, "not-a-directory");
    writeFileSync(file, "not a folder");
    const runtime = new FakeRuntimePort();
    for (const [label, argv, expected] of [
      ["missing", [missing], "missing-folder"],
      ["file", [file], "not-a-directory"],
      ["escape", [".."], "path-escape"]
    ] as const) {
      const result = await runWorkspace({ ...request(root, runtime), argv, allowedRoot: root });
      assert.equal(result.status, "failed", label);
      assert.equal(result.error?.code, expected, label);
      assert.equal(result.session, undefined, label);
    }
    const unreadable = join(root, "unreadable");
    mkdirSync(unreadable);
    chmodSync(unreadable, 0o000);
    try {
      const result = await runWorkspace({ ...request(root, runtime), argv: [unreadable] });
      assert.equal(result.status, "failed");
      assert.equal(result.error?.code, "unreadable");
    } finally {
      chmodSync(unreadable, 0o700);
    }
    assert.equal(existsSync(join(root, ".ganesh")), false);
    assert.equal(runtime.options.length, 0);
  });

  it("e14s01 late.entry and incomplete context open records without a stage pipeline", async () => {
    const root = fixtureRoot();
    const created = await runWorkspace(request(root));
    created.session?.handle.close();
    const reopened = await runWorkspace(request(root));
    assert.equal(reopened.status, "reopened");
    assert.equal(reopened.session?.intake.stagePipeline, false);
    assert.equal(reopened.session?.intake.lateEntry, true);
    assert.match(reopened.message, /current records/i);
    reopened.session?.handle.close();
  });

  it("e14s01 capability stays in-process and global config is untouched", async () => {
    const root = fixtureRoot();
    const globalPi = join(homedir(), ".pi");
    const before = existsSync(globalPi);
    const result = await runWorkspace(request(root));
    assert.ok(result.session);
    assert.equal(isOwnerCapability(result.session.ownerCapability), true);
    assert.equal(result.session.ownerCapability.ownerId, "owner-test");
    assert.equal(result.session.runtimeOptions.agentDir.startsWith(join(resolve(root), ".ganesh")), true);
    assert.equal(existsSync(join(root, ".ganesh", "pi")), true);
    assert.equal(existsSync(globalPi), before);
    result.session.handle.close();
  });
});
