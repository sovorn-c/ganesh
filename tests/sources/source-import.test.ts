import { deepStrictEqual, match, strictEqual, throws } from "node:assert";
import { mkdtempSync, writeFileSync, symlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test } from "node:test";
import {
  createWorkerCapabilities,
  type ProjectHandle
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

type ImportRequest = {
  commandId: string;
  path: string;
  logicalId: string;
  version: string;
  format: "text" | "markdown";
  mediaType: string;
};
type SourceApi = {
  importLocalSource: (handle: ProjectHandle, capability: unknown, request: ImportRequest) => {
    status: string;
    source: { artifactVersionId: string; access: string; extractionStatus: string };
  };
  listSourceLocators: (handle: ProjectHandle, artifactVersionId: string) => readonly Record<string, unknown>[];
  inspectSourceImport: (handle: ProjectHandle, commandId: string) => Record<string, unknown>;
};

async function sourceApi(): Promise<SourceApi> {
  return await import("../../src/index.js") as unknown as SourceApi;
}

function worker(handle: ProjectHandle, root: string, operations = ["source:import"]): unknown {
  return createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: root,
    allowedOperations: operations,
    allowedPaths: [root]
  });
}

function request(path: string, commandId = "command-text-1"): ImportRequest {
  return {
    commandId,
    path,
    logicalId: "source-text",
    version: "v1",
    format: "text",
    mediaType: "text/plain"
  };
}

test("e06s01 schema source record reopen and atomic recovery", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "notes.txt");
  writeFileSync(path, "alpha\r\nbeta\n");
  try {
    const api = await sourceApi();
    const result = api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), request(path));
    strictEqual(result.status, "complete");
    strictEqual(result.source.extractionStatus, "complete");
    fixture.handle.close();
    const { openProject } = await import("../../src/index.js");
    const reopened = openProject(fixture.root);
    const inspected = api.inspectSourceImport(reopened, "command-text-1");
    strictEqual(inspected.status, "complete");
    deepStrictEqual(api.listSourceLocators(reopened, result.source.artifactVersionId).map((locator) => locator.lineNumber), [1, 2]);
    reopened.close();
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s01 source record text original locator and diagnostic", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "notes.txt");
  writeFileSync(path, "one\ntwo\n");
  try {
    const api = await sourceApi();
    const result = api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), request(path));
    const locators = api.listSourceLocators(fixture.handle, result.source.artifactVersionId);
    strictEqual(locators[0]?.startByte, 0);
    strictEqual(locators[0]?.endByte, 3);
    strictEqual(locators[1]?.startByte, 4);
    strictEqual(locators[1]?.endByte, 7);
    strictEqual(result.source.access, "full-text");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s01 markdown locator duplicate heading and local.only", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "notes.md");
  writeFileSync(path, "# Same\nfirst\n# Same\nsecond\n");
  try {
    const api = await sourceApi();
    const result = api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), {
      ...request(path, "command-markdown-1"), format: "markdown", mediaType: "text/markdown", logicalId: "source-markdown"
    });
    const locators = api.listSourceLocators(fixture.handle, result.source.artifactVersionId);
    const headings = locators.filter((locator) => locator.kind === "heading");
    deepStrictEqual(headings.map((heading) => heading.occurrence), [1, 2]);
    strictEqual(result.source.access, "full-text");
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s01 capability path symlink project limit mutation", async () => {
  const fixture = projectFixture();
  const outside = mkdtempSync(join(tmpdir(), "ganesh-outside-"));
  const path = join(fixture.root, "notes.txt");
  const sibling = `${fixture.root}-sibling/notes.txt`;
  mkdirSync(`${fixture.root}-sibling`, { recursive: true });
  writeFileSync(path, "safe");
  writeFileSync(sibling, "escape");
  const link = join(fixture.root, "link.txt");
  symlinkSync(path, link);
  try {
    const api = await sourceApi();
    throws(() => api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), request(sibling, "command-sibling")));
    throws(() => api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), request(link, "command-link")));
    throws(() => api.importLocalSource(fixture.handle, worker(fixture.handle, outside), request(path, "command-project")));
  } finally {
    disposeFixture(fixture);
  }
});

test("e06s01 failure and redact diagnostics", async () => {
  const fixture = projectFixture();
  const path = join(fixture.root, "bad.txt");
  writeFileSync(path, Buffer.from([0xc3, 0x28]));
  try {
    const api = await sourceApi();
    throws(() => api.importLocalSource(fixture.handle, worker(fixture.handle, fixture.root), request(path, "command-invalid")));
    const operation = api.inspectSourceImport(fixture.handle, "command-invalid");
    match(JSON.stringify(operation), /invalid-utf8/);
    strictEqual(JSON.stringify(operation).includes("bad.txt"), false);
  } finally {
    disposeFixture(fixture);
  }
});
