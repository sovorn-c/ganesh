// story: e11s02, e11s03, e11s04, e11s05
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import {
  attachAnalysisDiagnostics,
  configureAnalysisExecution,
  confirmLocalCommand,
  createOwnerCapability,
  createWorkerCapabilities,
  importExternalAnalysisOutput,
  ingestAnalysisCandidate,
  inspectArtifactVersion,
  inspectAnalysisDiagnostics,
  inspectAnalysisExecutionPolicy,
  inspectAnalysisRuns,
  listLifecycleOperations,
  listQuarantinedOutputs,
  inspectExternalAnalysisOutputs,
  installAnalysisPackage,
  openProject,
  probeAnalysisTools,
  ProjectStoreError,
  reproduceAnalysisRun,
  runAuthorizedAnalysis,
  type AnalysisProcessRunner
} from "../../src/index.js";
import { artifact, disposeFixture, projectFixture } from "../support/project-fixtures.js";

const fakeRunner = (stdout = "ok\n"): AnalysisProcessRunner => () => ({ exitCode: 0, stdout, stderr: "" });

describe("e11 analysis runs, probes, diagnostics and external outputs", () => {
  it("e11s02 SC-e11s02-P0-01 persists complete analysis provenance across reopen", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const input = artifact(fixture.handle, "dataset", "1", "local input");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "approve", bashGuard: { allowedCommands: [process.execPath] } });
      const argv = [process.execPath, "-e", "console.log(1)"];
      const confirmation = confirmLocalCommand(fixture.handle, owner, { argv });
      const run = runAuthorizedAnalysis(fixture.handle, owner, {
        argv,
        confirmationId: confirmation.id,
        inputVersionIds: [input.id],
        scriptVersionId: input.id,
        commandOrScriptVersion: "script-v1",
        parameters: { seed: 7 },
        diagnostics: { warnings: [] },
        environment: { node: process.version },
        runner: fakeRunner("fixture output\n")
      });
      assert.equal(run.repeatability, "reported");
      assert.equal(run.inputVersionIds[0], input.id);
      assert.equal(run.stdout, "fixture output\n");
      assert.equal(run.origin, "owner-recorded");
      assert.equal(listLifecycleOperations(fixture.handle).find((operation) => operation.id === run.id)?.operationType, "local-analysis");
      const workers = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["analysis:ingest"] });
      assert.throws(() => runAuthorizedAnalysis(fixture.handle, workers, { argv: [process.execPath], runner: fakeRunner() }), /forbidden/i);
      const candidate = ingestAnalysisCandidate(fixture.handle, workers, { payload: { method: "candidate" }, inputVersionIds: [input.id] });
      assert.equal(candidate.origin, "specialist-proposed");
      assert.equal(candidate.attribution, "agent-inferred");
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        assert.equal(inspectAnalysisRuns(reopened, owner, { id: run.id })[0]?.id, run.id);
      } finally {
        reopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s02 SC-e11s02-P0-03 quarantines cancelled output through the lifecycle gate", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const run = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: () => ({ cancelled: true, stdout: "late" }) });
      assert.equal(run.status, "quarantined");
      assert.equal(listLifecycleOperations(fixture.handle).find((operation) => operation.id === run.id)?.status, "quarantined");
      assert.equal(listQuarantinedOutputs(fixture.handle, run.id).length, 1);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s02 SC-e11s02-P0-02 reports repeatability without creating work or commitment records", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const run = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      assert.equal(run.repeatability, "reported");
      for (const table of ["work_runs", "commitments", "policy_permissions", "standing_permissions", "reported_execution_evidence"]) {
        assert.equal(Number(fixture.handle.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0), 0, table);
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s02 SC-e11s02-P1-04 gives workers metadata-only runs and redacted diagnostics", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const run = runAuthorizedAnalysis(fixture.handle, owner, {
        argv: [process.execPath, "--participant-secret"],
        parameters: { participantSecret: "participant-secret" },
        environment: { participantSecret: "participant-secret", safe: "node" },
        diagnostics: { message: "participant-secret" },
        runner: fakeRunner("participant-secret")
      });
      const diagnostic = attachAnalysisDiagnostics(fixture.handle, owner, {
        runId: run.id,
        diagnostics: [{ code: "participant-data", message: "participant-secret" }]
      });
      assert.equal(run.stdout, "participant-secret");
      assert.equal(run.environment.participantSecret, "participant-secret");
      const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["analysis:inspect"] });
      const workerRun = inspectAnalysisRuns(fixture.handle, worker, { id: run.id })[0];
      assert.equal(workerRun?.stdout, undefined);
      assert.equal(workerRun?.stderr, undefined);
      assert.deepEqual(workerRun?.environment, { redacted: true });
      assert.deepEqual(workerRun?.diagnostics, { redacted: true });
      assert.deepEqual(workerRun?.parameters, { redacted: true });
      assert.deepEqual(workerRun?.argv, ["[REDACTED]"]);
      assert.doesNotMatch(JSON.stringify(workerRun), /participant-secret/);
      const workerDiagnostic = inspectAnalysisDiagnostics(fixture.handle, worker, { runId: diagnostic.runId })[0];
      assert.ok(workerDiagnostic);
      assert.doesNotMatch(JSON.stringify(workerDiagnostic), /participant-secret/);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s03 SC-e11s03-P0-01 names missing tools with honest remediation", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const calls: string[][] = [];
    const runner: AnalysisProcessRunner = (argv) => { calls.push([...argv]); return { exitCode: 0, stdout: "installed", stderr: "" }; };
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "approve", bashGuard: { requireApprovalCommands: ["fake-installer"] } });
      const report = probeAnalysisTools(fixture.handle, owner, { tools: ["missing-fixture-tool"], packages: ["missing-fixture-package"], availableTools: {}, availablePackages: {} });
      assert.equal(report.missingTools[0], "missing-fixture-tool");
      assert.equal(report.tools[0]?.code, "tool-missing");
      assert.equal(report.packages[0]?.code, "package-missing");
      assert.throws(() => installAnalysisPackage(fixture.handle, owner, { argv: ["fake-installer", "pkg"], runner }), (error: unknown) => error instanceof ProjectStoreError && error.code === "install-unconfirmed");
      assert.equal(calls.length, 0);
      assert.equal(inspectAnalysisExecutionPolicy(fixture.handle, owner).mode, "approve");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s03 SC-e11s03-P0-02 evaluates installation under mode and guard before spawn", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const calls: string[][] = [];
    const runner: AnalysisProcessRunner = (argv) => { calls.push([...argv]); return { exitCode: 0, stdout: "installed", stderr: "" }; };
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "approve", bashGuard: { requireApprovalCommands: ["fake-installer"] } });
      assert.throws(
        () => installAnalysisPackage(fixture.handle, owner, { argv: ["fake-installer", "pkg"], runner }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "install-unconfirmed"
      );
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access", bashGuard: { deniedCommands: ["fake-installer"] } });
      assert.throws(
        () => installAnalysisPackage(fixture.handle, owner, { argv: ["fake-installer", "pkg"], runner }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "install-denied"
      );
      assert.equal(calls.length, 0);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s03 SC-e11s03-P0-03 does not fabricate a succeeded analysis from missing tools", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const report = probeAnalysisTools(fixture.handle, owner, { tools: ["missing-tool"], packages: ["missing-package"] });
      assert.equal(report.missingTools.length, 1);
      assert.equal(report.missingPackages.length, 1);
      assert.equal(inspectAnalysisRuns(fixture.handle, owner).length, 0);
      assert.equal(inspectAnalysisExecutionPolicy(fixture.handle, owner).mode, "full-access");
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s03 SC-e11s03-P1-04 permits worker probes but denies worker installation", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["analysis:probe"] });
      assert.equal(probeAnalysisTools(fixture.handle, worker, { tools: ["missing-tool"] }).tools[0]?.available, false);
      assert.throws(() => installAnalysisPackage(fixture.handle, worker, { argv: ["fake-installer", "pkg"] }), /forbidden/i);
      const star = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["*"] });
      assert.throws(() => installAnalysisPackage(fixture.handle, star, { argv: ["fake-installer", "pkg"] }), /forbidden/i);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s04 SC-e11s04-P0-02 keeps causal limitations visible after design labels change", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const run = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      const diagnostic = attachAnalysisDiagnostics(fixture.handle, owner, { runId: run.id, profileId: "mixed-methods", evidenceType: "associational", claimType: "causal", designLabel: "longitudinal" });
      assert.equal(diagnostic.status, "incomplete");
      assert.ok(diagnostic.limitationCodes.includes("missing-integration-rationale"));
      assert.ok(diagnostic.limitationCodes.includes("causal-identification-mismatch"));
      const missing = attachAnalysisDiagnostics(fixture.handle, owner, { runId: run.id });
      assert.ok(missing.limitationCodes.includes("missing-profile"));
      const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["analysis:inspect"] });
      assert.throws(() => attachAnalysisDiagnostics(fixture.handle, worker, { runId: run.id }), /forbidden/i);
      assert.equal(inspectAnalysisDiagnostics(fixture.handle, owner, { runId: run.id }).length, 2);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s04 SC-e11s04-P0-01 records diagnostics for all four method profiles", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const profiles = [
      ["quantitative", { independentObservations: false }, "quantitative-profile"],
      ["qualitative", { approach: "reflexive-thematic-analysis" }, "qualitative-profile"],
      ["mixed-methods", { integrationRationale: "merge findings" }, "mixed-methods-profile"],
      ["artifact-evaluation-design-science", { evaluationPlan: "benchmark artifact" }, "artifact-evaluation-profile"]
    ] as const;
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      for (const [profileId, profileDetails, expectedCode] of profiles) {
        const run = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
        const diagnostic = attachAnalysisDiagnostics(fixture.handle, owner, { runId: run.id, profileId, profileDetails });
        assert.ok(diagnostic.diagnostics.some((item) => item.code === expectedCode), profileId);
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s04 SC-e11s04-P0-03 keeps integration, evaluation and confirmatory limits visible", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const mixedRun = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      const mixed = attachAnalysisDiagnostics(fixture.handle, owner, { runId: mixedRun.id, profileId: "mixed-methods" });
      assert.equal(mixed.status, "incomplete");
      assert.ok(mixed.limitationCodes.includes("missing-integration-rationale"));
      const artifactRun = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      const artifact = attachAnalysisDiagnostics(fixture.handle, owner, { runId: artifactRun.id, profileId: "artifact-evaluation-design-science" });
      assert.equal(artifact.status, "implementation-not-contribution");
      assert.ok(artifact.limitationCodes.includes("missing-evaluation"));
      const exploratoryRun = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      const exploratory = attachAnalysisDiagnostics(fixture.handle, owner, { runId: exploratoryRun.id, confirmatoryOrExploratory: "confirmatory" });
      assert.ok(exploratory.limitationCodes.includes("confirmatory-plan-required"));
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s04 SC-e11s04-P1-04 records missing profiles as limits and rejects worker overwrite", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const run = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner() });
      const diagnostic = attachAnalysisDiagnostics(fixture.handle, owner, { runId: run.id });
      assert.ok(diagnostic.limitationCodes.includes("missing-profile"));
      const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["analysis:inspect"] });
      assert.throws(() => attachAnalysisDiagnostics(fixture.handle, worker, { runId: run.id }), /forbidden/i);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s05 SC-e11s05-P0-01 imports reported output and preserves it across reopen", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const imported = importExternalAnalysisOutput(fixture.handle, owner, { content: "external output", source: "outside" });
      assert.equal(imported.authenticity, "reported");
      assert.equal(imported.reproduced, false);
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        assert.deepEqual(inspectExternalAnalysisOutputs(reopened, owner, { id: imported.id })[0], imported);
      } finally {
        reopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s05 SC-e11s05-P0-02 creates a new-run with reproduced output without rewriting reported output", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const argv = [process.execPath, "-e", "console.log(1)"];
      const first = runAuthorizedAnalysis(fixture.handle, owner, { argv, commandOrScriptVersion: "script-v1", runner: fakeRunner("external output\n") });
      const imported = importExternalAnalysisOutput(fixture.handle, owner, { content: "external output\n", inputVersionIds: [], argvDigest: first.argvDigest, commandOrScriptVersion: "script-v1" });
      assert.equal(imported.authenticity, "reported");
      assert.equal(imported.reproduced, false);
      const reproduced = reproduceAnalysisRun(fixture.handle, owner, { externalOutputId: imported.id, authenticatedRunId: first.id, runner: fakeRunner("external output\n") });
      assert.equal(reproduced?.reproduced, true);
      assert.notEqual(reproduced?.id, first.id);
      assert.equal(inspectExternalAnalysisOutputs(fixture.handle, owner, { id: imported.id })[0]?.reproduced, false);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s05 SC-e11s05-P0-03 denies claims and keeps failed or unavailable reproduction reported", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const argv = [process.execPath, "-e", "console.log(1)"];
      const authenticated = runAuthorizedAnalysis(fixture.handle, owner, { argv, commandOrScriptVersion: "script-v1", runner: fakeRunner("expected") });
      const claimed = importExternalAnalysisOutput(fixture.handle, owner, { content: "expected", argvDigest: authenticated.argvDigest, commandOrScriptVersion: "script-v1" });
      assert.throws(
        () => reproduceAnalysisRun(fixture.handle, owner, { externalOutputId: claimed.id, authenticatedRunId: "missing-authenticated-run", runner: fakeRunner("expected") }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "not-found"
      );
      const unavailable = importExternalAnalysisOutput(fixture.handle, owner, { content: "expected", argvDigest: authenticated.argvDigest, commandOrScriptVersion: "script-v1" });
      const importedArtifact = inspectArtifactVersion(fixture.handle, unavailable.artifactVersionId);
      assert.equal(importedArtifact.contentStatus, "available");
      assert.notEqual(importedArtifact.contentHash, null);
      assert.ok(importedArtifact.storagePath);
      rmSync(importedArtifact.storagePath, { force: true });
      const missingArtifact = inspectArtifactVersion(fixture.handle, unavailable.artifactVersionId);
      assert.equal(missingArtifact.contentStatus, "missing");
      assert.notEqual(missingArtifact.contentHash, null);
      assert.throws(
        () => reproduceAnalysisRun(fixture.handle, owner, { externalOutputId: unavailable.id, authenticatedRunId: authenticated.id, runner: fakeRunner("expected") }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "reproduction-mismatch"
      );
      const failed = importExternalAnalysisOutput(fixture.handle, owner, { content: "expected", argvDigest: authenticated.argvDigest, commandOrScriptVersion: "script-v1" });
      const failedRun = reproduceAnalysisRun(fixture.handle, owner, { externalOutputId: failed.id, authenticatedRunId: authenticated.id, runner: () => ({ exitCode: 1, stdout: "different", stderr: "failed" }) });
      assert.equal(failedRun.status, "failed");
      assert.equal(inspectExternalAnalysisOutputs(fixture.handle, owner, { id: claimed.id })[0]?.reproduced, false);
      assert.equal(inspectExternalAnalysisOutputs(fixture.handle, owner, { id: unavailable.id })[0]?.reproduced, false);
      assert.equal(inspectExternalAnalysisOutputs(fixture.handle, owner, { id: failed.id })[0]?.reproduced, false);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e11s05 SC-e11s05-P1-04 denies worker reproduction and reproduced claims", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      configureAnalysisExecution(fixture.handle, owner, { mode: "full-access" });
      const authenticated = runAuthorizedAnalysis(fixture.handle, owner, { argv: [process.execPath], runner: fakeRunner("expected") });
      const imported = importExternalAnalysisOutput(fixture.handle, owner, { content: "expected", argvDigest: authenticated.argvDigest, parameters: { participantSecret: "participant-secret" }, source: "participant-secret", notes: "participant-secret" });
      const star = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["*"] });
      assert.throws(() => importExternalAnalysisOutput(fixture.handle, star, { content: "claimed" }), /forbidden/i);
      assert.throws(() => reproduceAnalysisRun(fixture.handle, star, { externalOutputId: imported.id, authenticatedRunId: authenticated.id }), /forbidden/i);
      assert.throws(() => runAuthorizedAnalysis(fixture.handle, star, { argv: [process.execPath], reproduced: true, runner: fakeRunner() }), /forbidden/i);
      const workerOutput = inspectExternalAnalysisOutputs(fixture.handle, star, { id: imported.id })[0];
      assert.ok(workerOutput);
      assert.doesNotMatch(JSON.stringify(workerOutput), /participant-secret/);
      assert.equal(inspectExternalAnalysisOutputs(fixture.handle, owner, { id: imported.id })[0]?.reproduced, false);
    } finally {
      disposeFixture(fixture);
    }
  });
});
