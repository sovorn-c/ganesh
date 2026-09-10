// story: e01s02
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { execPath } from "node:process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import test from "node:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  aggregateStatus,
  checkExecutionMode,
  checkNodeRuntime,
  checkPackageManager,
  checkProjectConfiguration,
  checkProjectDependencies,
  checkRequiredTools,
  readNpmVersion
} from "../src/preflight-checks.js";
import {
  hasProjectDependencies,
  readPackageJson,
  readProjectConfig
} from "../src/preflight-config.js";
import { runCleanInstall } from "../src/clean-install.js";

test("preflight checks report malformed and unavailable runtime inputs", () => {
  assert.equal(checkNodeRuntime("unknown").evidence, "Node.js version unavailable");
  assert.equal(checkPackageManager(null, "11.19.0").status, "blocking");
  assert.equal(checkPackageManager({ packageManager: "npm@11.19.0" }, null).status, "missing");
  assert.equal(checkPackageManager({ packageManager: "npm@11.19.0" }, "10.0.0").status, "unsupported");
  assert.equal(checkPackageManager({ packageManager: "npm@11.19.0" }, "11.19.0").status, "ready");
  assert.equal(checkProjectDependencies(null, true).status, "blocking");
  assert.equal(checkProjectDependencies({}, false).status, "missing");
  assert.equal(checkProjectDependencies({}, true).status, "ready");
  assert.equal(checkProjectConfiguration({ requiredTools: [], error: "bad config" }).status, "blocking");
  assert.equal(checkProjectConfiguration({ requiredTools: [] }).status, "ready");
});

test("required-tool checks distinguish missing, optional, version, and executable states", () => {
  assert.equal(checkRequiredTools([], {}).status, "ready");
  assert.equal(
    checkRequiredTools(
      [{ name: "required-tool" }, { name: "optional-tool", required: false }],
      { availableTools: { "required-tool": false, "optional-tool": false } }
    ).status,
    "missing"
  );
  assert.equal(
    checkRequiredTools(
      [{ name: "optional-tool", required: false }],
      { availableTools: { "optional-tool": false } }
    ).status,
    "warning"
  );
  assert.equal(
    checkRequiredTools(
      [{ name: "old-tool", minVersion: "2.0.0" }],
      { availableTools: { "old-tool": true }, toolVersions: { "old-tool": "1.9.0" } }
    ).status,
    "unsupported"
  );
  assert.equal(
    checkRequiredTools(
      [{ name: "unknown-version", command: "definitely-not-a-command", minVersion: "1.0.0" }],
      { availableTools: { "unknown-version": true } }
    ).status,
    "unsupported"
  );
  assert.equal(
    checkRequiredTools(
      [
        { name: "node", minVersion: "0.0.1" },
        { name: "plain-tool" }
      ],
      { availableTools: { node: true, "plain-tool": true }, toolVersions: { node: "24.0.0" } }
    ).status,
    "ready"
  );
  assert.equal(
    checkRequiredTools([{ name: "node", minVersion: "0.0.1" }], {}).status,
    "ready"
  );
});

test("execution and aggregate statuses cover empty, valid, invalid, warning, and blocked states", () => {
  assert.equal(checkExecutionMode("").check.status, "not_configured");
  assert.equal(checkExecutionMode("ask").check.status, "ready");
  assert.equal(checkExecutionMode("approve").report.status, "ready");
  assert.equal(checkExecutionMode("full-access").report.status, "ready");
  assert.equal(checkExecutionMode("sandbox").check.status, "invalid");
  assert.equal(aggregateStatus([{ id: "one", status: "ready", required: true, evidence: "ok" }]), "ready");
  assert.equal(aggregateStatus([{ id: "one", status: "warning", required: false, evidence: "warn" }]), "warning");
  assert.equal(aggregateStatus([{ id: "one", status: "missing", required: true, evidence: "missing" }]), "blocked");
});

test("readNpmVersion reports unavailable npm without throwing", () => {
  const originalPath = process.env.PATH;
  const emptyPath = mkdtempSync(join(tmpdir(), "ganesh-empty-path-"));
  try {
    process.env.PATH = emptyPath;
    assert.equal(readNpmVersion(), null);
  } finally {
    process.env.PATH = originalPath;
    rmSync(emptyPath, { recursive: true, force: true });
  }
});

test("project config and package readers return actionable results for malformed fixtures", () => {
  const root = mkdtempSync(join(tmpdir(), "ganesh-config-test-"));
  try {
    assert.deepEqual(readProjectConfig(root), { requiredTools: [] });
    writeFileSync(join(root, "ganesh.config.json"), "not json");
    assert.match(readProjectConfig(root).error ?? "", /not valid JSON/);

    writeFileSync(join(root, "ganesh.config.json"), "null");
    assert.match(readProjectConfig(root).error ?? "", /JSON object/);
    writeFileSync(join(root, "ganesh.config.json"), "{\"requiredTools\":{}}");
    assert.match(readProjectConfig(root).error ?? "", /must be an array/);
    writeFileSync(join(root, "ganesh.config.json"), "{\"requiredTools\":[\"node\"]}");
    assert.match(readProjectConfig(root).error ?? "", /invalid requiredTools entry/);
    writeFileSync(
      join(root, "ganesh.config.json"),
      JSON.stringify({
        executionMode: "ask",
        requiredTools: [{ name: "node", command: "node", minVersion: "24.0.0", required: false }]
      })
    );
    assert.deepEqual(readProjectConfig(root), {
      executionMode: "ask",
      requiredTools: [{ name: "node", command: "node", minVersion: "24.0.0", required: false }]
    });
    writeFileSync(join(root, "ganesh.config.json"), "{\"executionMode\":true}");
    assert.match(readProjectConfig(root).error ?? "", /executionMode must be a string/);

    assert.equal(readPackageJson(root), null);
    writeFileSync(join(root, "package.json"), "not json");
    assert.equal(readPackageJson(root), null);
    writeFileSync(join(root, "package.json"), "[]");
    assert.equal(readPackageJson(root), null);
    writeFileSync(join(root, "package.json"), "{\"dependencies\":null,\"devDependencies\":[]}");
    const packageJson = readPackageJson(root);
    assert.deepEqual(packageJson, { dependencies: null, devDependencies: [] });
    assert.equal(hasProjectDependencies(root, null), false);
    assert.equal(hasProjectDependencies(root, packageJson), true);
    assert.equal(hasProjectDependencies(root, { dependencies: { missing: "1.0.0" } }), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clean-install reports both successful and unavailable npm paths", () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "ganesh-clean-source-"));
  try {
    for (const path of ["package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "src"] as const) {
      cpSync(join(process.cwd(), path), join(fixtureRoot, path), { recursive: true });
    }
    mkdirSync(join(fixtureRoot, "test"));
    cpSync(join(process.cwd(), "test/baseline.test.ts"), join(fixtureRoot, "test/baseline.test.ts"));
    assert.equal(runCleanInstall(fixtureRoot), 0);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }

  const originalPath = process.env.PATH;
  const emptyPath = mkdtempSync(join(tmpdir(), "ganesh-no-npm-"));
  try {
    process.env.PATH = emptyPath;
    assert.equal(runCleanInstall(process.cwd()), 1);
  } finally {
    process.env.PATH = originalPath;
    rmSync(emptyPath, { recursive: true, force: true });
  }
});

test("preflight CLI handles JSON, fixture errors, and clean-install conflicts", () => {
  const run = (args: string[], env?: NodeJS.ProcessEnv) => spawnSync(
    execPath,
    ["dist/src/preflight-cli.js", ...args],
    { cwd: process.cwd(), encoding: "utf8", env: { ...process.env, ...env } }
  );

  const json = run(["--json"], { PATH: process.env.PATH });
  assert.equal(json.status, 0);
  assert.match(json.stdout, /\"schemaVersion\": 1/);

  const missingFixture = run(["--fixture"]);
  assert.equal(missingFixture.status, 2);
  assert.match(missingFixture.stderr, /requires unsupported-runtime/);

  const unknownFixture = run(["--fixture", "other"]);
  assert.equal(unknownFixture.status, 2);
  assert.match(unknownFixture.stderr, /unknown argument: other/);

  const conflict = run(["--clean-install", "--fixture", "unsupported-runtime"]);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /cannot be combined/);

  const emptyPath = mkdtempSync(join(tmpdir(), "ganesh-cli-no-npm-"));
  try {
    const cleanFailure = run(["--clean-install"], { PATH: emptyPath });
    assert.equal(cleanFailure.status, 1);
  } finally {
    rmSync(emptyPath, { recursive: true, force: true });
  }
});
