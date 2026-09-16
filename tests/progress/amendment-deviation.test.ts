// story: e12s02
// scenarios: SC-e12s02-P0-01, SC-e12s02-P0-02, SC-e12s02-P0-03, SC-e12s02-P1-04
import assert from "node:assert/strict";
import test from "node:test";
import {
  assessProtocolCurrency,
  assessReadiness,
  dispatchRun,
  bindProtocolInForce,
  checkLifecyclePolicy,
  createBranch,
  createDecisionPacket,
  createLifecycleOperation,
  createOwnerCapability,
  createWorkerCapabilities,
  inspectAmendments,
  inspectDeviations,
  inspectProtocol,
  listCommitments,
  listContracts,
  listImpacts,
  openProject,
  proposeContract,
  recordAmendment,
  recordDeviation,
  recordExternalAuthorization,
  recordOwnerDecision,
  recordProtocolVersion,
  recordProviderAttempt,
  recordRiskRegisterItem,
  updateBranchReference,
  authorizeContract,
  queueRun,
  ProjectStoreError
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";

function inForce(fixture: ReturnType<typeof projectFixture>) {
  const owner = createOwnerCapability("owner-test");
  const protocol = recordProtocolVersion(fixture.handle, owner, {
    versionLabel: "v1",
    procedureText: "Original protocol procedure",
    activity: "data-collection",
    population: "Adults",
    dataUse: "aggregate-survey"
  });
  updateBranchReference(fixture.handle, {
    branchId: "main", logicalId: "study-protocol", artifactVersionId: protocol.artifactVersionId,
    expectedVersion: 0, commandId: "e12s02-protocol-reference"
  });
  const packet = createDecisionPacket(fixture.handle, {
    question: "Adopt original protocol", branchId: "main", candidateVersionIds: [protocol.artifactVersionId]
  });
  const decision = recordOwnerDecision(fixture.handle, {
    packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [protocol.artifactVersionId],
    commandId: "e12s02-protocol-commitment", capability: owner
  });
  assert.ok(decision.commitmentId);
  assert.equal(bindProtocolInForce(fixture.handle, owner, {
    protocolVersionId: protocol.id, commitmentId: decision.commitmentId, commandId: "e12s02-protocol-bind"
  }).status, "in-force");
  return { owner, protocol, commitmentId: decision.commitmentId };
}

test("e12s02 amendment creates a successor and deviation remains a departure", () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol } = inForce(fixture);
    const amendment = recordAmendment(fixture.handle, owner, {
      fromProtocolVersionId: protocol.id,
      versionLabel: "v2",
      procedureText: "Amended protocol procedure for a new population",
      changeSummary: "Population and recruitment procedure changed",
      population: "Children",
      populationChanged: true,
      commandId: "e12s02-amendment"
    });
    assert.throws(() => recordDeviation(fixture.handle, owner, {
      protocolVersionId: protocol.id, summary: "Contradictory material flag", population: "Children", populationChanged: false,
      commandId: "e12s02-contradictory-deviation"
    }));
    const deviation = recordDeviation(fixture.handle, owner, {
      protocolVersionId: protocol.id,
      summary: "One scheduled visit departed from the original procedure",
      occurredOn: "2026-09-15",
      commandId: "e12s02-deviation"
    });
    assert.equal(inspectAmendments(fixture.handle, owner, { id: amendment.id })[0]?.status, "proposed");
    assert.equal(inspectDeviations(fixture.handle, owner, { id: deviation.id })[0]?.status, "recorded");
    assert.equal(inspectDeviations(fixture.handle, owner, { id: deviation.id })[0]?.protocolVersionId, protocol.id);
    assert.equal(inspectAmendments(fixture.handle, owner).length, 1);
    assert.equal(inspectDeviations(fixture.handle, owner).length, 1);
    assert.equal(inspectDeviations(fixture.handle, owner, { id: amendment.id }).length, 0);
    assert.equal(inspectDeviations(fixture.handle, owner, { protocolVersionId: protocol.id })[0]?.summary, deviation.summary);
    assert.equal((inspectAmendments(fixture.handle, owner)[0]?.successorProtocolVersionId ?? "") !== protocol.id, true);
    assert.equal((awaitableProtocol(fixture, amendment.successorProtocolVersionId)).procedureText, "Amended protocol procedure for a new population");
    assert.throws(() => fixture.handle.db.prepare("UPDATE protocol_versions SET procedure_text = 'tampered' WHERE id = ?").run(protocol.id));
    assert.throws(() => fixture.handle.db.prepare("UPDATE amendments SET change_summary = 'tampered' WHERE id = ?").run(amendment.id));
    assert.throws(() => recordAmendment(fixture.handle, owner, {
      fromProtocolVersionId: protocol.id, versionLabel: "v-invalid", population: "Children", populationChanged: false,
      changeSummary: "Contradictory material flag", commandId: "e12s02-contradictory-amendment"
    }));
  } finally {
    disposeFixture(fixture);
  }
});

function awaitableProtocol(fixture: ReturnType<typeof projectFixture>, id: string) {
  const owner = createOwnerCapability("owner-test");
  const rows = fixture.handle.db.prepare("SELECT procedure_text FROM protocol_versions WHERE id = ?").get(id) as { procedure_text: string } | undefined;
  assert.ok(rows);
  return { procedureText: rows.procedure_text, owner };
}

test("e12s02 amendment impacts mark readiness needs-review without blanket approval", () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol, commitmentId } = inForce(fixture);
    const risk = recordRiskRegisterItem(fixture.handle, owner, {
      activity: "data-collection",
      requirementText: "Protect participants",
      institutionOrCommunity: "Research participants",
      branchId: "main"
    });
    const amendment = recordAmendment(fixture.handle, owner, {
      fromProtocolVersionId: protocol.id,
      versionLabel: "v2",
      procedureText: "Updated protocol",
      changeSummary: "Sampling procedure changed",
      commandId: "e12s02-impact-amendment"
    });
    const impacts = listImpacts(fixture.handle, "main");
    assert.ok(impacts.some((impact) => impact.kind === "protocol-amendment" && impact.dependentVersionId === risk.artifactVersionId));
    assert.ok(impacts.some((impact) => impact.kind === "protocol-amendment" && impact.dependentVersionId === protocol.artifactVersionId));
    const readiness = assessReadiness(fixture.handle, { commitmentId, commandId: "e12s02-impact-readiness" });
    assert.equal(readiness.status, "needs-review");
    assert.equal(listCommitments(fixture.handle).filter((item) => item.status === "active").length, 1);
    assert.equal(amendment.status, "proposed");
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s02 impact completion is retryable after an injected impact failure", () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol } = inForce(fixture);
    fixture.handle.db.exec(`
      CREATE TRIGGER e12_test_fail_impact
      BEFORE INSERT ON impact_records
      WHEN NEW.command_id = 'e12s02-atomic-amendment'
      BEGIN SELECT RAISE(ABORT, 'injected impact failure'); END;
    `);
    const request = {
      fromProtocolVersionId: protocol.id,
      versionLabel: "v2",
      procedureText: "Retryable amended protocol",
      changeSummary: "Retryable impact write",
      commandId: "e12s02-atomic-amendment"
    };
    assert.throws(() => recordAmendment(fixture.handle, owner, request), /injected impact failure/);
    assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM amendments WHERE command_id = ?").get(request.commandId) as { count: number }).count, 1);
    assert.equal((fixture.handle.db.prepare("SELECT status FROM progress_operations WHERE command_id = ?").get(request.commandId) as { status: string }).status, "pending");
    assert.equal(listImpacts(fixture.handle, "main").filter((impact) => impact.kind === "protocol-amendment").length, 0);
    fixture.handle.db.exec("DROP TRIGGER e12_test_fail_impact");

    const retried = recordAmendment(fixture.handle, owner, request);
    assert.equal(retried.commandId, request.commandId);
    assert.ok(listImpacts(fixture.handle, "main").some((impact) => impact.kind === "protocol-amendment"));
    assert.equal((fixture.handle.db.prepare("SELECT status FROM progress_operations WHERE command_id = ?").get(request.commandId) as { status: string }).status, "complete");
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s02 dispatch rechecks protocol currency after admission wait", async () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol } = inForce(fixture);
    recordExternalAuthorization(fixture.handle, owner, {
      activities: ["data-collection"],
      populationOrDataUse: { population: "Adults", dataUse: "aggregate-survey", destination: "local", purpose: "study" },
      applicabilityBasis: "Institutional approval for adults"
    });
    const proposed = proposeContract(fixture.handle, owner, {
      id: "e12s02-race-contract", objective: "Race test", protocolVersionId: protocol.id,
      scope: { activity: "data-collection", population: "Adults", dataUse: "aggregate-survey", minProviderIntervalMs: 50 },
      permittedRoles: ["evidence"], destination: "local", purpose: "study", limits: { tokens: 10, calls: 1, timeMs: 1000 }
    });
    const contract = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
    const run = queueRun(fixture.handle, owner, { contractId: contract.id, commandId: "e12s02-race-run" });
    recordProviderAttempt(fixture.handle, run.id, {
      destination: "local", purpose: "study", attempt: 1, outcome: "ok", pricing: { status: "unknown" }
    });
    let starts = 0;
    const result = await dispatchRun(fixture.handle, owner, run.id, {
      start: async () => { starts += 1; return { status: "ok" }; }
    }, {
      minIntervalMs: 50,
      wait: async () => {
        recordAmendment(fixture.handle, owner, {
          fromProtocolVersionId: protocol.id, versionLabel: "v2", population: "Children", populationChanged: true,
          changeSummary: "Population changed during admission", commandId: "e12s02-race-amendment"
        });
      }
    });
    assert.equal(starts, 0);
    assert.equal(result.status, "blocked");
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s02 material amendment fences old scope, grants are not manufactured, and lifecycle resume is fenced", () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol } = inForce(fixture);
    recordExternalAuthorization(fixture.handle, owner, {
      activities: ["data-collection"],
      populationOrDataUse: { population: "Adults", dataUse: "aggregate-survey", destination: "local", purpose: "study" },
      applicabilityBasis: "Institutional approval for adults"
    });
    const proposed = proposeContract(fixture.handle, owner, {
      id: "e12s02-old-scope-contract", objective: "Collect approved data", protocolVersionId: protocol.id,
      scope: { activity: "data-collection", population: "Adults", dataUse: "aggregate-survey" },
      permittedRoles: ["evidence"], destination: "local", purpose: "study", limits: { tokens: 10, calls: 1, timeMs: 1000 }
    });
    const contract = authorizeContract(fixture.handle, owner, { contractId: proposed.id });
    assert.equal(listContracts(fixture.handle).find((item) => item.id === contract.id)?.status, "authorized");
    assert.ok(queueRun(fixture.handle, owner, { contractId: contract.id, commandId: "e12s02-before-change", activity: "data-collection" }).id);
    const authorizationCount = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM external_authorizations").get() as { count: number }).count;
    recordAmendment(fixture.handle, owner, {
      fromProtocolVersionId: protocol.id, versionLabel: "v2", procedureText: "Children protocol",
      changeSummary: "Population changed", population: "Children", populationChanged: true, commandId: "e12s02-material-amendment"
    });
    assert.throws(() => queueRun(fixture.handle, owner, {
      contractId: contract.id, commandId: "e12s02-old-scope-after-change", activity: "data-collection"
    }), (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden");
    assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM external_authorizations").get() as { count: number }).count, authorizationCount);
    const currency = assessProtocolCurrency(fixture.handle, owner, { protocolVersionId: protocol.id, population: "Adults", dataUse: "aggregate-survey", activity: "data-collection" });
    assert.equal(currency.status, "needs-review");
    assert.equal(currency.contextMatches, false);

    const operation = createLifecycleOperation(fixture.handle, {
      operationType: "study-work",
      inputSnapshot: { versionIds: [], protocolVersionId: protocol.id, activity: "data-collection", population: "Adults", dataUse: "aggregate-survey" }
    });
    assert.equal(checkLifecyclePolicy(fixture.handle, operation.id, "resume", { capability: owner }).status, "blocked");
    const malformed = createLifecycleOperation(fixture.handle, {
      operationType: "study-work",
      inputSnapshot: { versionIds: [], protocolVersionId: 42 }
    });
    assert.equal(checkLifecyclePolicy(fixture.handle, malformed.id, "resume", { capability: owner }).status, "blocked");
    const unknown = createLifecycleOperation(fixture.handle, {
      operationType: "study-work",
      inputSnapshot: { versionIds: [], protocolVersionId: "protocol-unknown" }
    });
    assert.equal(checkLifecyclePolicy(fixture.handle, unknown.id, "resume", { capability: owner }).status, "blocked");
  } finally {
    disposeFixture(fixture);
  }
});

test("e12s02 branch-local amendment cannot be adopted by a worker", () => {
  const fixture = projectFixture();
  try {
    const { owner, protocol } = inForce(fixture);
    const worker = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["*"] });
    assert.throws(() => bindProtocolInForce(fixture.handle, worker, { protocolVersionId: protocol.id }), /matching owner capability/);

    createBranch(fixture.handle, { branchId: "alternative", name: "alternative-protocol" });
    const alternative = recordProtocolVersion(fixture.handle, owner, {
      versionLabel: "v-alt", procedureText: "Alternative branch protocol", branchId: "alternative",
      commandId: "e12s02-branch-protocol"
    });
    updateBranchReference(fixture.handle, {
      branchId: "alternative", logicalId: "study-protocol", artifactVersionId: alternative.artifactVersionId,
      expectedVersion: 0, commandId: "e12s02-branch-reference"
    });
    const packet = createDecisionPacket(fixture.handle, {
      question: "Adopt alternative protocol", branchId: "alternative", candidateVersionIds: [alternative.artifactVersionId]
    });
    const decision = recordOwnerDecision(fixture.handle, {
      packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [alternative.artifactVersionId],
      commandId: "e12s02-branch-commitment", capability: owner
    });
    assert.ok(decision.commitmentId);
    bindProtocolInForce(fixture.handle, owner, {
      protocolVersionId: alternative.id, commitmentId: decision.commitmentId, commandId: "e12s02-branch-bind"
    });
    const amendment = recordAmendment(fixture.handle, owner, {
      fromProtocolVersionId: alternative.id, versionLabel: "v-alt-2", procedureText: "Alternative branch amended protocol",
      changeSummary: "Alternative branch exploration", branchId: "alternative", commandId: "e12s02-branch-amendment"
    });
    assert.equal(inspectAmendments(fixture.handle, owner, { id: amendment.id })[0]?.branchId, "alternative");
    assert.equal(inspectProtocol(fixture.handle, owner, { branchId: "main", status: "in-force" })[0]?.id, protocol.id);
  } finally {
    disposeFixture(fixture);
  }
});
