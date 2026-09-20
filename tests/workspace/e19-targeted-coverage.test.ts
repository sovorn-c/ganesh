// story: e19s02 e19s05
// scenario: SC-e19s02-P0-01 SC-e19s02-P0-02 SC-e19s02-P0-03 SC-e19s05-P1-04
import { strict as assert } from "node:assert";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, it } from "node:test";
import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import {
  authorizeContract,
  importLocalSource,
  inspectOrientation,
  presentResearchEntry,
  proposeContract,
  recordCorpusIdentity,
  recordDraft,
  recordOrientation,
  renderReleaseQualificationReport,
  runReleaseQualification,
  runWorkspace,
  type WorkspaceSession
} from "../../src/index.js";
import { loadContinuousVerificationWorkflow } from "../../src/distribution/continuous-verification.js";
import { createWorkspaceExtensions, registerWorkspaceCommands } from "../../src/workspace/extension.js";
import { createWorkspacePorts, PiWorkspaceRuntimePort, PiWorkspaceTuiPort } from "../../src/workspace/runtime-port.js";
import { protocolFixture } from "../support/literature-fixtures.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {rmSync(root, { recursive: true, force: true });}
});

async function sessionFixture(): Promise<WorkspaceSession> {
  const root = mkdtempSync(join(tmpdir(), "ganesh-e19-coverage-"));
  roots.push(root);
  const result = await runWorkspace({
    argv: [root],
    cwd: root,
    ownerId: "owner-test",
    ports: { runtime: { create: () => ({}) }, tui: { run: async () => undefined, confirm: async () => false } }
  });
  assert.ok(result.session);
  return result.session;
}

describe("e19 targeted changed-scope coverage", () => {
  it("fails closed for missing and malformed continuous-verification workflows", () => {
    const missing = mkdtempSync(join(tmpdir(), "ganesh-e19-workflow-missing-"));
    roots.push(missing);
    assert.deepEqual(loadContinuousVerificationWorkflow(missing), {
      valid: false,
      triggers: [],
      commands: [],
      forbiddenClaims: [],
      errors: ["local-gates.yml is missing"]
    });

    const malformed = mkdtempSync(join(tmpdir(), "ganesh-e19-workflow-invalid-"));
    roots.push(malformed);
    const workflow = join(malformed, ".github", "workflows");
    mkdirSync(workflow, { recursive: true });
    writeFileSync(join(workflow, "local-gates.yml"), "on:\n  push:\njobs:\n  test:\n    runs-on: windows-latest\n    steps:\n      - run: npm publish\n", "utf8");
    const report = loadContinuousVerificationWorkflow(malformed);
    assert.equal(report.valid, false);
    assert.deepEqual(report.triggers, ["push"]);
    assert.deepEqual(report.forbiddenClaims, ["npm publish"]);
    assert.ok(report.errors.some((error) => /pull_request|Node.js 24|ubuntu-latest|missing local gate|forbidden/i.test(error)));
  });

  it("records every focused entry-point kind through its existing store", async () => {
    const session = await sessionFixture();
    const owner = session.ownerCapability;
    const { protocol, query } = protocolFixture(session.handle);
    const orientation = recordOrientation(session.handle, owner, {
      commandId: "e19-entry-orientation",
      topic: "Coverage topic",
      discipline: "Computing",
      immediateGoal: "Exercise inspection",
      unknowns: ["coverage"]
    });
    assert.equal(inspectOrientation(session.handle, owner, orientation.id).id, orientation.id);
    const corpus = recordCorpusIdentity(session.handle, owner, {
      commandId: "e19-entry-corpus",
      protocolVersionId: protocol.id,
      bibliographicIdentity: { title: "Coverage fixture" }
    });
    const sourcePath = join(session.handle.project.rootPath, "coverage.txt");
    writeFileSync(sourcePath, "A local source\n", "utf8");
    const source = importLocalSource(session.handle, owner, {
      commandId: "e19-entry-source",
      path: sourcePath,
      logicalId: "coverage-source",
      version: "v1",
      format: "text",
      mediaType: "text/plain"
    });

    const landscape = presentResearchEntry(session, "landscape", JSON.stringify({
      commandId: "e19-entry-landscape",
      protocolVersionId: protocol.id,
      queryVersionIds: [query.id],
      description: "A bounded landscape"
    }));
    assert.equal(landscape.status, "recorded");

    const screening = presentResearchEntry(session, "screen", JSON.stringify({
      commandId: "e19-entry-screen",
      corpusRecordId: corpus.id,
      protocolVersionId: protocol.id,
      criterionId: "criterion-1",
      decision: "include",
      reason: "Matches the bounded scope"
    }));
    assert.equal(screening.status, "recorded");

    const appraisal = presentResearchEntry(session, "appraise", JSON.stringify({
      commandId: "e19-entry-appraise",
      sourceVersionId: source.source.artifactVersionId,
      methodKind: "quantitative",
      dependentObservationsAddressed: true
    }));
    assert.equal(appraisal.status, "recorded");

    const draft = recordDraft(session.handle, owner, {
      commandId: "e19-entry-draft",
      title: "Coverage draft",
      bodyMarkdown: "Draft body"
    });
    const review = presentResearchEntry(session, "review", JSON.stringify({
      commandId: "e19-entry-review",
      draftId: draft.id
    }));
    assert.equal(review.status, "recorded");

    const contract = proposeContract(session.handle, owner, {
      id: "e19-entry-contract",
      objective: "Bounded specialist review",
      permittedRoles: ["reviewer"],
      limits: { tokens: 0, calls: 1, timeMs: 0 },
      destination: "local",
      purpose: "research"
    });
    authorizeContract(session.handle, owner, { contractId: contract.id, version: contract.version });
    const queued = presentResearchEntry(session, "specialist", JSON.stringify({
      contractId: contract.id,
      commandId: "e19-entry-specialist",
      role: "reviewer",
      reservation: { calls: 1, tokens: 0, timeMs: 0 }
    }));
    assert.equal(queued.status, "queued");
    assert.match(queued.text, /Execution mode:/);

    assert.throws(() => presentResearchEntry(session, "orient", "[]"), /JSON object/);
    session.handle.close();
  });

  it("executes the six registered research command handlers and reports handler errors", async () => {
    const session = await sessionFixture();
    type Ui = { notify(message: string, level: "info" | "warning"): void };
    type Context = { ui: Ui };
    type Handler = (args: string, context: Context) => Promise<void>;
    type ShortcutHandler = (context: Context) => Promise<void>;
    const handlers = new Map<string, Handler>();
    const shortcuts = new Map<string, ShortcutHandler>();
    const notices: string[] = [];
    const registrar = {
      registerCommand: (name: string, config: { handler: unknown }) => { handlers.set(name, config.handler as Handler); },
      registerShortcut: (name: string, config: { handler: unknown }) => { shortcuts.set(name, config.handler as ShortcutHandler); }
    };
    registerWorkspaceCommands(registrar, session);
    const extension = createWorkspaceExtensions(session)[0];
    if (extension !== undefined && "factory" in extension) {
      extension.factory(registrar as never);
    }
    const context: Context = { ui: {
      notify: (message) => { notices.push(message); },
      input: async () => undefined
    } as Context["ui"] };
    for (const command of ["ganesh-help", "ganesh-alternatives", "ganesh-confirm", "ganesh-reject", "ganesh-defer", "ganesh-inspect", "ganesh-viewer", "ganesh-status", "ganesh-access", "ganesh-cancel"]) {
      await handlers.get(command)?.(command === "ganesh-cancel" ? "run-unknown" : command === "ganesh-status" ? "" : command.includes("confirm") || command.includes("reject") || command.includes("defer") || command.includes("inspect") || command.includes("viewer") ? "unknown" : "", context);
    }
    for (const command of ["ganesh-orient", "ganesh-landscape", "ganesh-screen", "ganesh-appraise", "ganesh-review", "ganesh-specialist"]) {
      await handlers.get(command)?.("", context);
    }
    await handlers.get("ganesh-orient")?.("{", context);
    for (const shortcut of shortcuts.values()) {
      await shortcut(context);
    }
    assert.ok(shortcuts.size >= 13);
    assert.ok(notices.some((notice) => /orient inspected/.test(notice)));
    assert.ok(notices.some((notice) => /specialist/.test(notice)));
    assert.ok(notices.some((notice) => /JSON object/.test(notice)));
    const tui = new PiWorkspaceTuiPort();
    assert.throws(() => tui.confirm(), /workspace confirmation/);
    tui.notify();
    session.handle.close();
  });

  it("closes the runtime when the process exits during a workspace run", async () => {
    const root = mkdtempSync(join(tmpdir(), "ganesh-e19-exit-"));
    roots.push(root);
    let disposed = 0;
    const result = await runWorkspace({
      argv: [root],
      cwd: root,
      ownerId: "owner-test",
      ports: {
        runtime: { create: () => ({}), dispose: async () => { disposed += 1; } },
        tui: { run: async () => {
          const listener = process.listeners("beforeExit").at(-1);
          if (listener !== undefined) { (listener as (code: number) => void)(0); }
        }, confirm: async () => false }
      }
    });
    assert.equal(result.status, "created");
    assert.equal(disposed, 1);
  });

  it("passes launch guidance through the Pi TUI port and restores its environment", async () => {
    const originalRun = InteractiveMode.prototype.run;
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    InteractiveMode.prototype.run = async function() { return undefined; };
    try {
      process.env.PI_CODING_AGENT_DIR = "before-e19";
      const root = mkdtempSync(join(tmpdir(), "ganesh-e19-runtime-"));
      roots.push(root);
      const runtimePort = new PiWorkspaceRuntimePort();
      const runtime = await runtimePort.create({ cwd: root, agentDir: join(root, ".agent"), projectRoot: root, ownerId: "owner-test", extensionFactories: [] });
      try {
        await new PiWorkspaceTuiPort().run(runtime, {
          projectRoot: root,
          agentDir: join(root, ".agent"),
          ownerId: "owner-test",
          initialMessage: "Ganesh is ready",
          initialMessages: ["/ganesh-orient"]
        });
      } finally {
        await runtimePort.dispose(runtime);
      }
      assert.equal(process.env.PI_CODING_AGENT_DIR, "before-e19");
      assert.ok(createWorkspacePorts().tui instanceof PiWorkspaceTuiPort);
    } finally {
      InteractiveMode.prototype.run = originalRun;
      if (previousAgentDir === undefined) {delete process.env.PI_CODING_AGENT_DIR;}
      else {process.env.PI_CODING_AGENT_DIR = previousAgentDir;}
    }
  });

  it("exercises the R19 optional, missing-pointer, and multi-pointer decisions", () => {
    const fixture = projectFixture();
    try {
      const outcomes: Array<Record<string, unknown>> = Array.from({ length: 17 }, (_, i) => ({ id: `R${String(i + 1).padStart(2, "0")}`, epicId: `e${String(i + 1).padStart(2, "0")}`, title: `Outcome ${i + 1}`, status: "passed" }));
      outcomes.push({ id: "R18", epicId: "e18", title: "Packaging", status: "blocked" });
      outcomes.push({ id: "R19", epicId: "e19", title: "Workspace", status: "passed", verificationPointer: "tests/workspace/launch-guidance.test.ts; tests/workspace/research-entry-points.test.ts" });
      const catalog = { version: "0.1.0", outcomes };
      const r19Path = join(fixture.root, "outcome-evidence.json");
      writeFileSync(r19Path, JSON.stringify(catalog), "utf8");
      const pointerOne = join(fixture.root, "tests/workspace/launch-guidance.test.ts");
      const pointerTwo = join(fixture.root, "tests/workspace/research-entry-points.test.ts");
      mkdirSync(join(fixture.root, "tests/workspace"), { recursive: true });
      writeFileSync(pointerOne, "test", "utf8");
      writeFileSync(pointerTwo, "test", "utf8");
      const options = {
        mode: "catalog" as const,
        outcomeEvidenceFile: r19Path,
        acceptanceCatalogFile: join(process.cwd(), "specs/qualification/acceptance-catalog.json"),
        adversarialCatalogFile: join(process.cwd(), "specs/qualification/adversarial-catalog.json"),
        competencyInventoryFile: join(process.cwd(), "specs/qualification/competency-inventory.json"),
        casePacksFile: join(process.cwd(), "specs/qualification/case-packs/case-packs.json"),
        evaluationsFile: join(process.cwd(), "specs/qualification/human-evaluations/evaluations.json")
      };
      const report = runReleaseQualification(fixture.root, options);
      assert.equal(report.outcomes.find((outcome) => outcome.id === "R19")?.status, "passed");
      assert.match(renderReleaseQualificationReport(report), /R19/);

      writeFileSync(r19Path, JSON.stringify({ version: "0.1.0", outcomes: outcomes.map((outcome) => outcome.id === "R19" ? { ...outcome, verificationPointer: undefined } : outcome) }), "utf8");
      const missingPointer = runReleaseQualification(fixture.root, options);
      assert.equal(missingPointer.outcomes.find((outcome) => outcome.id === "R19")?.status, "blocked");
      assert.ok(missingPointer.reasons?.some((reason) => /R19.*verification pointer/i.test(reason)));
    } finally {
      disposeFixture(fixture);
    }
  });
});
