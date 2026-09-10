// story: e03s04
// scenario: SC-e03s04-P0-01, SC-e03s04-P0-02, SC-e03s04-P1-03
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  openProject,
  registerArtifactVersion,
  createBranch,
  classifyInput,
  grantDataUse,
  withdrawDataUse,
  createOwnerCapability,
  createWorkerCapabilities,
  createLifecycleOperation,
  getLifecycleOperation,
  updateLifecycleOperationStatus,
  checkLifecyclePolicy,
  fenceRevokedOperation,
  acceptCandidate,
  resumeOperation,
  listCheckpoints,
  listFences,
  listQuarantinedOutputs,
  listLifecycleOperations
} from "../../src/index.js";

function makeFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ganesh-lifecycle-"));
  return {
    root,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  };
}

test("operation checkpoint fence quarantine lifecycle records survive offline reload", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "protocol-spec",
      version: "1.0.0",
      content: "secret protocol details",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "confidential",
      basis: "Internal design document"
    });

    grantDataUse(handle, {
      inputVersion: art.id,
      destination: "local-analysis",
      purpose: "validation",
      authority: "irb-01"
    });

    const op = createLifecycleOperation(handle, {
      operationType: "analysis",
      inputSnapshot: { versionIds: [art.id] },
      status: "queued"
    });

    assert.equal(op.status, "queued");
    assert.equal(op.operationType, "analysis");

    const fetchedOp = getLifecycleOperation(handle, op.id);
    assert.ok(fetchedOp);
    assert.equal(fetchedOp.id, op.id);

    const checkpoint = checkLifecyclePolicy(handle, op.id, "dispatch", {
      destination: "local-analysis",
      purpose: "validation"
    });
    assert.equal(checkpoint.status, "passed");

    const fence = fenceRevokedOperation(handle, op.id, "Policy withdrawn during test", "owner-alice");
    assert.equal(fence.operationId, op.id);
    assert.equal(fence.reason, "Policy withdrawn during test");

    const postFenceCheck = checkLifecyclePolicy(handle, op.id, "external");
    assert.equal(postFenceCheck.status, "blocked");
    assert.match(postFenceCheck.reason, /fenced/i);

    const candidateResult = acceptCandidate(handle, op.id, {
      candidateId: "cand-out-1",
      payload: { result: "some output" }
    });
    assert.equal(candidateResult.status, "quarantined");

    const allOps = listLifecycleOperations(handle);
    assert.equal(allOps.length, 1);
    assert.equal(allOps[0].status, "fenced");

    const allCheckpoints = listCheckpoints(handle, op.id);
    assert.ok(allCheckpoints.length >= 2);

    const allFences = listFences(handle, op.id);
    assert.equal(allFences.length, 1);

    const allQuarantined = listQuarantinedOutputs(handle, op.id);
    assert.equal(allQuarantined.length, 1);
    assert.equal(allQuarantined[0].candidateId, "cand-out-1");

    handle.close();

    // Reopen offline and confirm durable persistence
    const reopened = openProject(fixture.root);
    const persistedOp = getLifecycleOperation(reopened, op.id);
    assert.ok(persistedOp);
    assert.equal(persistedOp.status, "fenced");

    const persistedCheckpoints = listCheckpoints(reopened, op.id);
    assert.equal(persistedCheckpoints.length, allCheckpoints.length);

    const persistedFences = listFences(reopened, op.id);
    assert.equal(persistedFences.length, 1);
    assert.equal(persistedFences[0].reason, "Policy withdrawn during test");

    const persistedQuarantined = listQuarantinedOutputs(reopened, op.id);
    assert.equal(persistedQuarantined.length, 1);
    assert.equal(persistedQuarantined[0].candidateId, "cand-out-1");

    reopened.close();
  } finally {
    fixture.cleanup();
  }
});

test("dispatch external effect gates evaluate current policy capability and input protection", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "raw-data",
      version: "1.0.0",
      content: "participant observations",
      access: "full-text"
    });

    // 1. Unclassified input blocks dispatch
    const op1 = createLifecycleOperation(handle, {
      operationType: "synthesis",
      inputSnapshot: { versionIds: [art.id] }
    });

    const chk1 = checkLifecyclePolicy(handle, op1.id, "dispatch");
    assert.equal(chk1.status, "blocked");
    assert.match(chk1.reason, /unclassified/i);

    // Classify as confidential
    classifyInput(handle, art.id, {
      sensitivity: "confidential",
      basis: "Research participant consent form"
    });

    // 2. Unpermitted external destination denied
    const chk2 = checkLifecyclePolicy(handle, op1.id, "dispatch", {
      destination: "remote-cloud",
      purpose: "cloud-synthesis"
    });
    assert.equal(chk2.status, "denied");

    // 3. Grant destination & purpose -> passes dispatch
    const grant = grantDataUse(handle, {
      inputVersion: art.id,
      destination: "local-eval",
      purpose: "analysis",
      authority: "ethics-board"
    });

    const chk3 = checkLifecyclePolicy(handle, op1.id, "dispatch", {
      destination: "local-eval",
      purpose: "analysis"
    });
    assert.equal(chk3.status, "passed");

    // 4. External effect check with command execution
    const chk4 = checkLifecyclePolicy(handle, op1.id, "external", {
      destination: "local-eval",
      purpose: "analysis",
      command: "rm -rf /"
    });
    assert.equal(chk4.status, "denied");
    assert.match(chk4.reason, /denied/i);

    // 5. Withdrawal blocks future external effect immediately
    withdrawDataUse(handle, grant.id, "Consent withdrawn by participant", "owner-alice");
    const chk5 = checkLifecyclePolicy(handle, op1.id, "external", {
      destination: "local-eval",
      purpose: "analysis"
    });
    assert.equal(chk5.status, "blocked");
    assert.match(chk5.reason, /withdrawn/i);

    handle.close();
  } finally {
    fixture.cleanup();
  }
});

test("revoke cancel fence blocks late branch candidate accept and quarantines output", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "clinical-study",
      version: "1.0.0",
      content: "cohort outcomes",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "participant-identifiable",
      basis: "Clinical participant trial"
    });

    const grant = grantDataUse(handle, {
      inputVersion: art.id,
      destination: "local-processor",
      purpose: "model-training",
      authority: "irb-approved"
    });

    // Create a branch to test cross-branch isolation
    const branchB = createBranch(handle, { name: "feature-worker" });

    // Create running operation on branch
    const op = createLifecycleOperation(handle, {
      operationType: "model-training",
      branchId: branchB.id,
      inputSnapshot: { versionIds: [art.id] },
      status: "running"
    });

    // Worker capability with canonical write authority
    const workerCap = createWorkerCapabilities({
      projectId: handle.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["canonical-project-write", "local-processor"]
    });

    // In-flight revocation: permission is withdrawn while worker is processing
    withdrawDataUse(handle, grant.id, "Participant requested withdrawal", "owner-alice");

    // Worker finishes and attempts to accept candidate output
    const lateCandidate = {
      candidateId: "model-weights-v1",
      payload: { weights: "w12345" },
      branchId: branchB.id
    };

    const acceptRes = acceptCandidate(handle, op.id, lateCandidate, {
      capability: workerCap,
      destination: "local-processor",
      purpose: "model-training"
    });

    assert.equal(acceptRes.status, "quarantined");
    assert.match(acceptRes.reason, /withdrawn/i);

    // Operation was automatically fenced
    const opState = getLifecycleOperation(handle, op.id);
    assert.equal(opState?.status, "fenced");

    const quarantined = listQuarantinedOutputs(handle, op.id);
    assert.equal(quarantined.length, 1);
    assert.equal(quarantined[0].candidateId, "model-weights-v1");

    // Cancelled operation also fences/quarantines late output
    const op2 = createLifecycleOperation(handle, {
      operationType: "secondary-analysis",
      inputSnapshot: { versionIds: [art.id] },
      status: "running"
    });
    updateLifecycleOperationStatus(handle, op2.id, "cancelled");

    const lateCandidate2 = {
      candidateId: "cancelled-run-result",
      payload: { result: "discarded" }
    };
    const acceptRes2 = acceptCandidate(handle, op2.id, lateCandidate2, {
      capability: workerCap
    });
    assert.equal(acceptRes2.status, "quarantined");
    assert.match(acceptRes2.reason, /cancelled/i);

    handle.close();
  } finally {
    fixture.cleanup();
  }
});

test("resume stale branch snapshot rechecks current policy acceptance checkpoint after restart", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "shared-material",
      version: "1.0.0",
      content: "shared input",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "confidential",
      basis: "NDA governed source"
    });

    const grant = grantDataUse(handle, {
      inputVersion: art.id,
      destination: "local-worker",
      purpose: "indexing",
      authority: "admin-grant"
    });

    const op = createLifecycleOperation(handle, {
      operationType: "indexing",
      inputSnapshot: { versionIds: [art.id] },
      status: "queued"
    });

    // Withdraw permission before resume
    withdrawDataUse(handle, grant.id, "Permission revoked", "owner-alice");

    // Close and reopen to simulate process restart
    handle.close();

    const reopened = openProject(fixture.root);

    // Attempting to resume with withdrawn policy fails
    const resumeRes1 = resumeOperation(reopened, op.id, {
      destination: "local-worker",
      purpose: "indexing"
    });
    assert.equal(resumeRes1.status, "blocked");
    assert.match(resumeRes1.reason ?? "", /withdrawn/i);

    // Regrant permission
    grantDataUse(reopened, {
      inputVersion: art.id,
      destination: "local-worker",
      purpose: "indexing",
      authority: "reinstated-grant"
    });

    // Note: since it was fenced upon withdrawal, clear fence or use fresh operation to demonstrate fresh resume check
    const opFresh = createLifecycleOperation(reopened, {
      operationType: "indexing-retry",
      inputSnapshot: { versionIds: [art.id] },
      status: "queued"
    });

    const resumeRes2 = resumeOperation(reopened, opFresh.id, {
      destination: "local-worker",
      purpose: "indexing"
    });
    assert.equal(resumeRes2.status, "resumed");
    assert.equal(resumeRes2.checkpoint.status, "passed");

    // Now test acceptance capability check: worker without canonical-write cannot accept
    const restrictedWorker = createWorkerCapabilities({
      projectId: reopened.project.id,
      projectRoot: fixture.root,
      allowedOperations: ["local-worker"] // lacks "canonical-project-write"
    });

    const acceptRes1 = acceptCandidate(reopened, opFresh.id, {
      candidateId: "index-cand-1"
    }, {
      capability: restrictedWorker,
      destination: "local-worker",
      purpose: "indexing"
    });
    assert.equal(acceptRes1.status, "quarantined");
    assert.match(acceptRes1.reason, /lacks canonical-project-write/i);

    // With owner capability: succeeds
    const ownerCap = createOwnerCapability("owner-alice");
    const acceptRes2 = acceptCandidate(reopened, opFresh.id, {
      candidateId: "index-cand-2"
    }, {
      capability: ownerCap,
      destination: "local-worker",
      purpose: "indexing"
    });
    assert.equal(acceptRes2.status, "accepted");

    reopened.close();
  } finally {
    fixture.cleanup();
  }
});
