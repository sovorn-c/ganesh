// story: e11s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  configureAnalysisExecution,
  inspectAnalysisExecutionPolicy,
  previewLocalCommand,
  confirmLocalCommand,
  runLocalCommand,
  ProjectStoreError,
  FULL_ACCESS_NOTICE,
  analysisSchemaAvailable,
  openProject,
  type AnalysisProcessRunner
} from "../../src/index.js";
import { projectFixture, disposeFixture } from "../support/project-fixtures.js";

function runner(calls: string[][]): AnalysisProcessRunner {
  return (argv) => {
    calls.push([...argv]);
    return { exitCode: 0, stdout: "ok", stderr: "" };
  };
}

describe("e11s01 analysis execution policy", () => {
  it("e11s01 SC-e11s01-P0-01 persists policy across reopen and refuses unconfigured spawn", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      assert.throws(
        () => runLocalCommand(fixture.handle, owner, { argv: [process.execPath, "-e", ""], runner: runner([]) }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "unconfigured-mode"
      );
      configureAnalysisExecution(fixture.handle, owner, {
        mode: "approve",
        bashGuard: { deniedCommands: ["ganesh-denied-fixture"] },
        commandId: "e11-policy-1"
      });
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        assert.equal(inspectAnalysisExecutionPolicy(reopened, owner).mode, "approve");
        assert.deepEqual(inspectAnalysisExecutionPolicy(reopened, owner).bashGuard.deniedCommands, ["ganesh-denied-fixture"]);
      } finally {
        reopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s01 SC-e11s01-P0-02 denies before spawn and emits the full-access notice", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const calls: string[][] = [];
    try {
      configureAnalysisExecution(fixture.handle, owner, {
        mode: "ask",
        bashGuard: { deniedCommands: ["ganesh-denied-fixture"] },
        commandId: "e11-policy-2"
      });
      assert.equal(previewLocalCommand(fixture.handle, owner, { argv: ["ganesh-denied-fixture"] }).status, "denied");
      assert.throws(() => runLocalCommand(fixture.handle, owner, { argv: ["ganesh-denied-fixture"], runner: runner(calls) }), ProjectStoreError);
      assert.equal(calls.length, 0);

      assert.equal(previewLocalCommand(fixture.handle, owner, { argv: [process.execPath] }).status, "approval-required");
      assert.throws(() => runLocalCommand(fixture.handle, owner, { argv: [process.execPath], runner: runner(calls) }), /confirmation/i);
      assert.equal(calls.length, 0);

      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access", bashGuard: { deniedCommands: ["ganesh-denied-fixture"] }, commandId: "e11-policy-3" });
      const allowed = previewLocalCommand(fixture.handle, owner, { argv: [process.execPath] });
      assert.equal(allowed.status, "allowed");
      assert.equal(allowed.notice, FULL_ACCESS_NOTICE);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s01 SC-e11s01-P0-03 read-only projects report unavailable analysis schema without mutation", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const tables = [
      "analysis_quarantined_outputs",
      "external_analysis_outputs",
      "analysis_diagnostics",
      "analysis_tool_probes",
      "analysis_candidates",
      "analysis_runs",
      "analysis_command_confirmations",
      "analysis_execution_policies",
      "analysis_operations"
    ];
    try {
      fixture.handle.db.exec("PRAGMA foreign_keys = OFF");
      for (const table of tables) {
        fixture.handle.db.exec(`DROP TABLE ${table}`);
      }
      assert.equal(analysisSchemaAvailable(fixture.handle), false);
      fixture.handle.close();
      const readOnly = openProject(fixture.root, { readOnly: true });
      try {
        assert.throws(
          () => inspectAnalysisExecutionPolicy(readOnly, owner),
          (error: unknown) => error instanceof ProjectStoreError && error.code === "analysis-schema-unavailable"
        );
        assert.equal(analysisSchemaAvailable(readOnly), false);
      } finally {
        readOnly.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s01 SC-e11s01-P1-04 rejects forged, wrong-owner, star-worker and escalation callers", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      const star = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["*"] });
      assert.throws(() => configureAnalysisExecution(fixture.handle, star, { mode: "full-access" }), /forbidden/i);
      assert.throws(() => previewLocalCommand(fixture.handle, star, { argv: [process.execPath] }), /forbidden|unconfigured/i);
      assert.throws(() => configureAnalysisExecution(fixture.handle, { role: "owner", ownerId: "owner-test" }, { mode: "full-access" }), /forbidden/i);
      assert.throws(() => configureAnalysisExecution(fixture.handle, createOwnerCapability("other-owner"), { mode: "full-access" }), /forbidden/i);
      configureAnalysisExecution(fixture.handle, owner, { mode: "ask", bashGuard: { allowedCommands: [process.execPath] }, commandId: "e11-policy-4" });
      assert.equal(inspectAnalysisExecutionPolicy(fixture.handle, owner).mode, "ask");
    } finally {
      disposeFixture(fixture);
    }
  });
});
