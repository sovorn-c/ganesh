import assert from "node:assert/strict";
import test from "node:test";
import {
  renderJson,
  renderHuman,
  runPreflight,
  redactDiagnostic
} from "../src/preflight.js";

test("preflight returns a stable ready report for a configured supported environment", () => {
  const report = runPreflight({
    runtimeVersion: "24.20.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: "ask",
    requiredTools: []
  });

  assert.equal(report.status, "ready");
  assert.equal(report.exitCode, 0);
  assert.deepEqual(
    report.checks.map((check) => check.id),
    ["node-runtime", "package-manager", "project-dependencies", "required-tools", "execution-mode"]
  );
  assert.equal(JSON.parse(renderJson(report)).exitCode, 0);
  assert.match(renderHuman(report), /node-runtime/);
});

test("preflight blocks an unsupported Node runtime with remediation", () => {
  const report = runPreflight({
    runtimeVersion: "26.7.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: "ask",
    requiredTools: []
  });

  assert.equal(report.status, "blocked");
  assert.equal(report.exitCode, 1);
  const check = report.checks.find((item) => item.id === "node-runtime");
  assert.equal(check?.status, "unsupported");
  assert.match(check?.remediation ?? "", /Node\.js 24/);
});

test("preflight reports missing tools without installing them", () => {
  const report = runPreflight({
    runtimeVersion: "24.20.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: "approve",
    requiredTools: [{ name: "python", required: true }],
    availableTools: { python: false }
  });

  const check = report.checks.find((item) => item.id === "required-tools");
  assert.equal(check?.status, "missing");
  assert.equal(report.exitCode, 1);
  assert.match(check?.remediation ?? "", /install or configure/i);
});

test("preflight distinguishes mode states and labels full-access as local risk", () => {
  const missing = runPreflight({
    runtimeVersion: "24.20.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: undefined,
    requiredTools: []
  });
  assert.equal(missing.executionMode.status, "not_configured");
  assert.equal(missing.status, "warning");

  const invalid = runPreflight({
    runtimeVersion: "24.20.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: "sandbox",
    requiredTools: []
  });
  assert.equal(invalid.executionMode.status, "invalid");
  assert.equal(invalid.exitCode, 1);

  const fullAccess = runPreflight({
    runtimeVersion: "24.20.0",
    npmVersion: "11.19.0",
    dependenciesReady: true,
    executionMode: "full-access",
    requiredTools: []
  });
  assert.match(fullAccess.executionMode.notice, /local-risk/i);
  assert.match(fullAccess.executionMode.notice, /not a sandbox/i);
});

test("diagnostics redact credential-shaped values", () => {
  const diagnostic = redactDiagnostic("token=super-secret password: hidden api_key=private");

  assert.doesNotMatch(diagnostic, /super-secret|hidden|private/);
  assert.match(diagnostic, /REDACTED/);
});
