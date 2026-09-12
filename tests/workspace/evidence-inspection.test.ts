import { strict as assert } from "node:assert";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  importLocalSource,
  type ProjectHandle
} from "../../src/index.js";
import { projectFixture } from "../support/project-fixtures.js";
import { presentInspection, openLocalViewer, type LocalViewerPort } from "../../src/workspace/evidence.js";
import type { WorkspaceSession } from "../../src/workspace/workspace-types.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function session(handle: ProjectHandle): WorkspaceSession {
  const root = handle.project.rootPath;
  return {
    handle,
    ownerCapability: createOwnerCapability(handle.project.ownerId),
    runtimeOptions: { cwd: root, agentDir: join(root, ".ganesh", "pi"), projectRoot: root, ownerId: handle.project.ownerId },
    intake: { lateEntry: true, stagePipeline: false, currentRecords: ["project"] },
    ports: { runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false } }
  };
}

function importText(handle: ProjectHandle, root: string, text: string, commandId = "e14-source-import"): string {
  const path = join(root, "evidence.txt");
  writeFileSync(path, text);
  const worker = createWorkerCapabilities({ projectId: handle.project.id, projectRoot: root, allowedOperations: ["source:import"], allowedPaths: [root] });
  return importLocalSource(handle, worker, {
    commandId, path, logicalId: commandId, version: "1", format: "text", mediaType: "text/plain"
  }).source.artifactVersionId;
}

describe("E14 evidence inspection", () => {
  it("e14s03 inspection shows integrity access extraction locators and bounded content", () => {
    const fixture = projectFixture();
    roots.push(fixture.root);
    const sourceVersionId = importText(fixture.handle, fixture.root, "alpha\nbeta\n");
    const view = presentInspection(session(fixture.handle), { sourceVersionId, includeContent: true });
    assert.equal(view.status, "allowed");
    assert.equal(view.integrity, "verified");
    assert.equal(view.access, "full-text");
    assert.equal(view.extractionStatus, "complete");
    assert.equal(view.locators.length, 2);
    assert.equal(view.content, "alpha\nbeta\n");
    assert.match(view.text, /Integrity: verified/);
    fixture.handle.close();
  });

  it("e14s03 unavailable and limited evidence reports limitations without fabricated quotation", () => {
    const fixture = projectFixture();
    roots.push(fixture.root);
    const view = presentInspection(session(fixture.handle), { sourceVersionId: "missing-source", includeContent: true });
    assert.equal(view.status, "denied");
    assert.equal(view.content, undefined);
    assert.match(view.text, /unavailable|denied/i);
    assert.equal(view.text.includes("alpha"), false);
    fixture.handle.close();
  });

  it("e14s03 local viewer is policy-gated, project-contained, and injectable", async () => {
    const fixture = projectFixture();
    roots.push(fixture.root);
    const sourceVersionId = importText(fixture.handle, fixture.root, "viewer content");
    const launched: string[] = [];
    const viewer: LocalViewerPort = { launch: (path) => { launched.push(path); } };
    const result = await openLocalViewer(session(fixture.handle), { sourceVersionId }, viewer);
    assert.equal(result.status, "launched");
    assert.equal(launched.length, 1);
    assert.equal(launched[0]?.startsWith(fixture.handle.project.artifactRoot), true);

    const denied = await openLocalViewer(session(fixture.handle), { sourceVersionId: "missing-source" }, viewer);
    assert.equal(denied.status, "denied");
    assert.equal(launched.length, 1);
    fixture.handle.close();
  });

  it("e14s03 viewer unavailability is shown without changing source records", async () => {
    const fixture = projectFixture();
    roots.push(fixture.root);
    const sourceVersionId = importText(fixture.handle, fixture.root, "offline");
    const before = presentInspection(session(fixture.handle), { sourceVersionId });
    const unavailable: LocalViewerPort = { launch: () => { throw new Error("no viewer"); } };
    const result = await openLocalViewer(session(fixture.handle), { sourceVersionId }, unavailable);
    assert.equal(result.status, "unavailable");
    const after = presentInspection(session(fixture.handle), { sourceVersionId });
    assert.equal(after.integrity, before.integrity);
    assert.deepEqual(after.locators, before.locators);
    fixture.handle.close();
  });
});
