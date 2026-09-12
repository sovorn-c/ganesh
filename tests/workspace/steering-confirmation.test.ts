import { strict as assert } from "node:assert";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import {
  createBranch,
  createDecisionPacket,
  createWorkerCapabilities,
  listCommitments,
  recordOwnerDecision,
  registerWorkspaceCommands,
  updateBranchReference
} from "../../src/index.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { artifact } from "../support/project-fixtures.js";
import { runWorkspace } from "../../src/workspace/launcher.js";
import { confirmExactVersion } from "../../src/workspace/confirmation.js";
import { presentAlternatives, presentHelp } from "../../src/workspace/steering.js";
import type { TuiPort, WorkspaceSession } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

class ConfirmingTui implements TuiPort {
  constructor(private readonly answers: boolean[] = [true]) {}
  async run(): Promise<void> {}
  async confirm(): Promise<boolean> { return this.answers.shift() ?? false; }
}

async function sessionFixture(tui = new ConfirmingTui()): Promise<WorkspaceSession> {
  const root = mkdtempSync(join(tmpdir(), "ganesh-e14-steering-"));
  roots.push(root);
  const result = await runWorkspace({ argv: [root], cwd: root, ownerId: "owner-test", ports: {
    runtime: { create: () => ({}) },
    tui
  }});
  assert.ok(result.session);
  return result.session;
}

function packet(session: WorkspaceSession, versionId: string, id = "packet-test", branchId?: string) {
  return createDecisionPacket(session.handle, {
    id,
    branchId,
    question: "Which exact version should the owner confirm?",
    candidateVersionIds: [versionId],
    dependencyVersionIds: []
  });
}

describe("E14 steering and confirmation", () => {
  it("e14s02 exact-version confirmation displays packet versions and commits only after confirm", async () => {
    const tui = new ConfirmingTui([true]);
    const session = await sessionFixture(tui);
    const candidate = artifact(session.handle, "question", "1", "candidate");
    const created = packet(session, candidate.id);
    const result = await confirmExactVersion(session, {
      packetId: created.id,
      packetVersion: created.packetVersion,
      selectedCandidateVersionIds: [candidate.id],
      dependencyVersionIds: [],
      commandId: "confirm-exact-1"
    }, tui);
    assert.equal(result.status, "committed");
    assert.match(result.displayed.text, new RegExp(`Packet ${created.id} version 1`));
    assert.deepEqual(result.displayed.selectedCandidateVersionIds, [candidate.id]);
    assert.equal(listCommitments(session.handle, created.id).length, 1);
    session.handle.close();
  });

  it("e14s02 chat forgery worker and unbound bypass paths leave commitments empty", async () => {
    const session = await sessionFixture();
    const candidate = artifact(session.handle, "question", "1", "candidate");
    const created = packet(session, candidate.id, "packet-bypass");
    assert.throws(() => recordOwnerDecision(session.handle, {
      packetId: created.id, action: "approved", selectedCandidateVersionIds: [candidate.id], commandId: "forged", capability: { role: "owner", ownerId: "owner-test" }
    }));
    const worker = createWorkerCapabilities({ projectId: session.handle.project.id, projectRoot: session.handle.project.rootPath, allowedOperations: ["*"] });
    assert.throws(() => recordOwnerDecision(session.handle, {
      packetId: created.id, action: "approved", selectedCandidateVersionIds: [candidate.id], commandId: "worker", capability: worker
    }));
    const registered: string[] = [];
    registerWorkspaceCommands({ registerCommand: (name: string) => registered.push(name) } as unknown as ExtensionAPI, session);
    assert.deepEqual(registered, ["ganesh-help", "ganesh-alternatives", "ganesh-confirm", "ganesh-inspect", "ganesh-viewer", "ganesh-cancel"]);
    assert.equal(listCommitments(session.handle).length, 0);
    session.handle.close();
  });

  it("e14s02 stale packet refreshes and duplicate command does not duplicate commitment", async () => {
    const tui = new ConfirmingTui([true, true, true]);
    const session = await sessionFixture(tui);
    const first = artifact(session.handle, "question", "1", "candidate");
    const second = artifact(session.handle, "question", "2", "new candidate");
    createBranch(session.handle, { branchId: "stable", name: "stable" });
    const created = packet(session, first.id, "packet-stale");
    updateBranchReference(session.handle, { branchId: "main", logicalId: "question", artifactVersionId: second.id, expectedVersion: 0, commandId: "advance-question" });
    const stale = await confirmExactVersion(session, {
      packetId: created.id, packetVersion: 1, selectedCandidateVersionIds: [first.id], commandId: "stale-confirm"
    }, tui);
    assert.equal(stale.status, "stale");
    assert.ok(stale.refreshedPacket);
    assert.equal(listCommitments(session.handle, created.id).length, 0);

    const stablePacket = packet(session, first.id, "packet-duplicate", "stable");
    const stable = await confirmExactVersion(session, {
      packetId: stablePacket.id, packetVersion: 1, selectedCandidateVersionIds: [first.id], commandId: "duplicate-confirm"
    }, tui);
    const duplicate = await confirmExactVersion(session, {
      packetId: stablePacket.id, packetVersion: 1, selectedCandidateVersionIds: [first.id], commandId: "duplicate-confirm"
    }, tui);
    assert.equal(stable.status, "committed");
    assert.equal(duplicate.status, "duplicate");
    assert.equal(listCommitments(session.handle, stablePacket.id).length, 1);
    session.handle.close();
  });

  it("e14s02 help and alternatives inspect without adopting or recording a disposition", async () => {
    const session = await sessionFixture();
    const original = artifact(session.handle, "question", "1", "original");
    const alternative = artifact(session.handle, "question", "2", "alternative");
    const branch = createBranch(session.handle, { branchId: "alternative", name: "alternative" });
    updateBranchReference(session.handle, { branchId: branch.id, logicalId: "question", artifactVersionId: alternative.id, expectedVersion: 0, commandId: "alternative-update" });
    const help = presentHelp(session);
    assert.match(help.text, /ganesh-confirm/);
    const view = presentAlternatives(session, "alternative", "main");
    assert.equal(view.adopted, false);
    assert.equal(view.differences.length, 1);
    assert.match(view.text, /No branch was adopted/);
    assert.equal(listCommitments(session.handle).length, 0);
    void original;
    session.handle.close();
  });
});
