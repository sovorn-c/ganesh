// story: e10s04
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  openProject,
  recordExternalAuthorization,
  inspectAuthorization,
  withdrawExternalAuthorization,
  expireExternalAuthorization,
  assessActivityAuthorization,
  acceptCandidate,
  evaluateCommitmentGates,
  createDecisionPacket,
  assessReadiness,
  classifyInput,
  grantDataUse,
  recordOwnerDecision,
  recordScholarlyFinding,
  recordReasonedOverride,
  createBranch,
  createLifecycleOperation,
  checkLifecyclePolicy,
  proposeContract,
  authorizeContract,
  queueRun,
  updateRun,
  retryRun,
  ProjectStoreError,
  createOwnerCapability,
  createWorkerCapabilities,
  registerArtifactVersion,
  updateBranchReference
} from "../../src/index.js";
import {
  createEthicsFixture,
  disposeEthicsFixture
} from "../support/ethics-fixtures.js";
import { discardArtifactVersion } from "../../src/artifacts/artifact-store.js";

describe("e10s04 external authorization registry and work blocking", () => {
  it("e10s04 grant scope applicability expires and reopen survive close with owner authority (SC-e10s04-P0-01)", () => {
    const fixture = createEthicsFixture();
    try {
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "evidence-hdec-approval", version: "1.0",
        content: "Formal HDEC approval notice ref 26/NTX/99", origin: "source-import", access: "metadata-only"
      });

      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection", "participant-recruitment"],
        populationOrDataUse: { population: "Adult participants aged 18-65 residing in Auckland", dataClasses: ["survey-metrics"] },
        applicabilityBasis: "Approved by Northern B Health and Disability Ethics Committee",
        evidenceVersionIds: [evidence.id],
        expiresAt: "2028-12-31T23:59:59Z"
      });

      assert.ok(grant.id.startsWith("auth_"));
      assert.deepEqual(grant.activities, ["data-collection", "participant-recruitment"]);
      assert.equal(grant.status, "documented-approved");
      assert.equal(grant.applicabilityBasis, "Approved by Northern B Health and Disability Ethics Committee");
      assert.deepEqual(grant.evidenceVersionIds, [evidence.id]);
      assert.equal(grant.expiresAt, "2028-12-31T23:59:59Z");
      assert.equal(grant.attribution, "human-stated");
      assert.equal(grant.origin, "owner-recorded");

      const list = inspectAuthorization(fixture.handle, fixture.ownerCap, { activity: "data-collection" });
      assert.equal(list.length, 1);
      assert.equal(list[0].id, grant.id);

      // Close and reopen handle; must return identical grant
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedList = inspectAuthorization(reopened, fixture.ownerCap, { activity: "data-collection" });
        assert.equal(reopenedList.length, 1);
        assert.equal(reopenedList[0].id, grant.id);
        assert.equal(reopenedList[0].status, "documented-approved");
      } finally {
        reopened.close();
      }
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 approved basis and named-activity context are fail-closed with local evidence", () => {
    const fixture = createEthicsFixture();
    try {
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "auth-evidence", version: "1.0", content: "authorization evidence", origin: "source-import", access: "metadata-only"
      });
      const grantRequest = {
        activities: ["data-collection"] as const,
        populationOrDataUse: { population: "Adults", dataClasses: ["survey"], destination: "local", purpose: "research", conditions: ["local-only"] },
        applicabilityBasis: "  Board   approval  ", evidenceVersionIds: [evidence.id], commandId: "cmd-auth-replay"
      };
      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, grantRequest);
      assert.equal(recordExternalAuthorization(fixture.handle, fixture.ownerCap, grantRequest).id, grant.id);
      assert.equal(grant.applicabilityBasis, "Board approval");
      assert.equal(assessActivityAuthorization(fixture.handle, { activity: "data-collection" }).permitted, false);
      assert.equal(assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Adults", dataClasses: ["survey"], destination: "local", purpose: "research", conditions: ["local-only"]
      }).permitted, true);
      assert.throws(
        () => recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
          activities: ["data-collection"], populationOrDataUse: "Adults", applicabilityBasis: "   "
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      assert.throws(
        () => recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
          activities: ["data-collection"], populationOrDataUse: "Adults", applicabilityBasis: "Board approval", evidenceVersionIds: ["artifact-from-another-project"]
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "artifact-not-found"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 structured authorization scopes compare arrays and condition values without widening", () => {
    const fixture = createEthicsFixture();
    try {
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: { dataUse: ["aggregate survey", "identifiable survey"] },
        applicabilityBasis: "Committee approval for survey analysis"
      });
      assert.equal(assessActivityAuthorization(fixture.handle, {
        activity: "data-collection",
        dataUse: " IDENTIFIABLE   SURVEY "
      }).permitted, true);

      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["participant-recruitment"],
        populationOrDataUse: {
          population: "Adults",
          conditions: [{ region: "Auckland", mode: "local" }]
        },
        applicabilityBasis: "Recruitment approval"
      });
      assert.equal(assessActivityAuthorization(fixture.handle, {
        activity: "participant-recruitment",
        population: "Adults",
        conditions: [{ mode: "local", region: "Auckland" }]
      }).permitted, true);

      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["identifiable-analysis"],
        populationOrDataUse: { dataUse: "identifiable survey", conditions: "local-only" },
        applicabilityBasis: "Analysis approval"
      });
      assert.equal(assessActivityAuthorization(fixture.handle, {
        activity: "identifiable-analysis",
        dataUse: "identifiable survey",
        conditions: ["remote", "LOCAL-ONLY"]
      }).permitted, false);
      assert.equal(assessActivityAuthorization(fixture.handle, {
        activity: "identifiable-analysis",
        dataUse: "identifiable survey",
        conditions: ["LOCAL-ONLY"]
      }).permitted, true);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 malformed authorization scope fails closed for assessment and queue admission", () => {
    const fixture = createEthicsFixture();
    try {
      assert.throws(
        () => recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
          activities: ["data-collection"],
          populationOrDataUse: { population: undefined, destination: "local", purpose: "research" },
          applicabilityBasis: "Committee approval"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "malformed-scope-evidence", version: "1.0", content: "approval", origin: "source-import", access: "metadata-only"
      });
      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: { population: "Adults", destination: "local", purpose: "research" },
        applicabilityBasis: "Committee approval", evidenceVersionIds: [evidence.id]
      });
      fixture.handle.db.prepare("UPDATE external_authorizations SET population_or_data_use = ? WHERE id = ?").run("{}", grant.id);

      const assessment = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Adults", destination: "local", purpose: "research"
      });
      assert.equal(assessment.permitted, false);
      assert.equal(assessment.status, "needs-review");

      const proposed = proposeContract(fixture.handle, fixture.ownerCap, {
        id: "malformed-scope-contract", objective: "Run data collection", scope: { activity: "data-collection", population: "Adults" },
        permittedRoles: ["evidence"], destination: "local", purpose: "research", limits: { tokens: 10, calls: 1, timeMs: 1000 }
      });
      const contract = authorizeContract(fixture.handle, fixture.ownerCap, { contractId: proposed.id });
      assert.throws(
        () => queueRun(fixture.handle, fixture.ownerCap, { contractId: contract.id, commandId: "cmd-malformed-scope-run", activity: "data-collection" }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 lifecycle acceptance requires scoped authority and is terminally idempotent", () => {
    const fixture = createEthicsFixture();
    try {
      const foreignOwner = createOwnerCapability("foreign-owner");
      const foreignOperation = createLifecycleOperation(fixture.handle, {
        operationType: "candidate-acceptance", inputSnapshot: { versionIds: [] }
      });
      const foreignCheckpoint = checkLifecyclePolicy(fixture.handle, foreignOperation.id, "acceptance", {
        capability: foreignOwner, requireCanonicalWrite: true
      });
      assert.equal(foreignCheckpoint.status, "denied");
      assert.match(foreignCheckpoint.reason, /does not belong/i);

      const untrustedOperation = createLifecycleOperation(fixture.handle, {
        operationType: "candidate-acceptance", inputSnapshot: { versionIds: [] }
      });
      const untrustedCheckpoint = checkLifecyclePolicy(fixture.handle, untrustedOperation.id, "acceptance", {
        allowCandidateSubmission: true
      });
      assert.equal(untrustedCheckpoint.status, "denied");
      assert.match(untrustedCheckpoint.reason, /scoped capability/i);

      const terminalOperation = createLifecycleOperation(fixture.handle, {
        operationType: "candidate-acceptance", inputSnapshot: { versionIds: [] }
      });
      const first = acceptCandidate(fixture.handle, terminalOperation.id, { candidateId: "candidate-1" }, {
        capability: fixture.ownerCap
      });
      assert.equal(first.status, "accepted");
      const replay = acceptCandidate(fixture.handle, terminalOperation.id, { candidateId: "candidate-2" }, {
        capability: fixture.ownerCap
      });
      assert.equal(replay.status, "blocked");
      assert.match(replay.reason, /already accepted/i);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 authorization and operation rows commit atomically for replay", () => {
    const fixture = createEthicsFixture();
    try {
      const request = {
        activities: ["data-collection"] as const,
        populationOrDataUse: { population: "Adults" },
        applicabilityBasis: "Committee approval",
        commandId: "cmd-atomic-authorization"
      };
      fixture.handle.db.exec(`
        CREATE TRIGGER fail_authorization_operation
        BEFORE INSERT ON ethics_operations
        WHEN NEW.kind = 'external-authorization'
        BEGIN SELECT RAISE(ABORT, 'injected authorization failure'); END;
      `);
      assert.throws(() => recordExternalAuthorization(fixture.handle, fixture.ownerCap, request), /injected authorization failure/);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM external_authorizations").get() as { count: number }).count, 0);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM ethics_operations").get() as { count: number }).count, 0);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count, 0);
      fixture.handle.db.exec("DROP TRIGGER fail_authorization_operation");
      const authorization = recordExternalAuthorization(fixture.handle, fixture.ownerCap, request);
      assert.equal(authorization.status, "documented-approved");
      assert.equal(inspectAuthorization(fixture.handle, fixture.ownerCap, { id: authorization.id }).length, 1);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 artifact compensation refuses symlinked cleanup paths", () => {
    const fixture = createEthicsFixture();
    const outside = mkdtempSync(join(tmpdir(), "ganesh-artifact-outside-"));
    const escapedDirectory = join(fixture.handle.project.artifactRoot, "escaped");
    const internalTarget = join(fixture.handle.project.artifactRoot, "internal-target");
    const internalLink = join(fixture.handle.project.artifactRoot, "internal-link");
    const victim = join(outside, "victim.artifact");
    const internalVictim = join(internalTarget, "victim.artifact");
    try {
      const artifact = registerArtifactVersion(fixture.handle, {
        logicalId: "artifact-cleanup-path", version: "1.0", content: "metadata", access: "metadata-only"
      });
      writeFileSync(victim, "must survive");
      symlinkSync(outside, escapedDirectory, "dir");
      fixture.handle.db.prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?").run("escaped/victim.artifact", artifact.id);
      assert.throws(
        () => discardArtifactVersion(fixture.handle, artifact.id),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "path-escape"
      );
      assert.equal(existsSync(victim), true);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE id = ?").get(artifact.id) as { count: number }).count, 1);

      unlinkSync(escapedDirectory);
      mkdirSync(internalTarget, { recursive: true });
      writeFileSync(internalVictim, "also must survive");
      symlinkSync(internalTarget, internalLink, "dir");
      fixture.handle.db.prepare("UPDATE artifact_versions SET storage_path = ? WHERE id = ?").run("internal-link/victim.artifact", artifact.id);
      assert.throws(
        () => discardArtifactVersion(fixture.handle, artifact.id),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "path-escape"
      );
      assert.equal(existsSync(internalVictim), true);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions WHERE id = ?").get(artifact.id) as { count: number }).count, 1);
    } finally {
      if (existsSync(escapedDirectory)) {
        unlinkSync(escapedDirectory);
      }
      if (existsSync(internalLink)) {
        unlinkSync(internalLink);
      }
      rmSync(outside, { recursive: true, force: true });
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 named-activity commitment-gate fails without grant and override cannot manufacture documented-approved (SC-e10s04-P0-02)", () => {
    const fixture = createEthicsFixture();
    try {
      const art = registerArtifactVersion(fixture.handle, {
        logicalId: "study-protocol-v1",
        version: "1.0",
        content: "Observational participant protocol",
        origin: "source-import",
        access: "metadata-only"
      });

      const packet = createDecisionPacket(fixture.handle, {
        branchId: "main",
        question: "Observational data collection protocol decision",
        candidateVersionIds: [art.id]
      });

      // 1. Evaluate commitment gates with named activity but NO grant in registry
      // Caller asserts externalAuthorization: documented-approved
      const gateResult = evaluateCommitmentGates(fixture.handle, {
        packetId: packet.id,
        activity: "data-collection",
        externalAuthorization: "documented-approved",
        ownerCapability: fixture.ownerCap
      });

      assert.equal(gateResult.allowed, false);
      const authGate = gateResult.gates.find((g) => g.gate === "external-authorization");
      assert.ok(authGate);
      assert.equal(authGate.passed, false, "cannot manufacture permission via caller claim");

      // 2. Reasoned override attempting to bypass external authorization gate also fails
      const finding = recordScholarlyFinding(fixture.handle, {
        affectedVersionIds: [art.id],
        sourceBasis: "reviewer paper DOI:10.0000/example",
        rationale: "The reviewer disputes protocol safety",
        reviewerId: "reviewer-1",
        methodologyPosition: "Preregister safety measures"
      });
      const override = recordReasonedOverride(fixture.handle, {
        findingId: finding.id,
        packetId: packet.id,
        candidateVersionId: art.id,
        rationale: "Owner reasons why exception is defensible",
        commandId: "cmd_reasoned_override_1",
        ownerCapability: fixture.ownerCap
      });
      assert.equal(override.status, "recorded");
      const gateWithOverride = evaluateCommitmentGates(fixture.handle, {
        packetId: packet.id,
        overrideId: override.id,
        activity: "data-collection",
        externalAuthorization: "documented-approved",
        ownerCapability: fixture.ownerCap
      });
      assert.equal(gateWithOverride.allowed, false, "scholarly override cannot manufacture external authorization");
      const authGateWithOverride = gateWithOverride.gates.find((g) => g.gate === "external-authorization");
      assert.ok(authGateWithOverride);
      assert.equal(authGateWithOverride.passed, false);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 withdraw fence queueRun branch isolation needs-review and cannot-recall reporting (SC-e10s04-P0-03)", () => {
    const fixture = createEthicsFixture();
    try {
      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: { population: "Adult outpatient clinic attendees", destination: "local", purpose: "clinical-audit" },
        applicabilityBasis: "Institutional ethics committee approval 2026-001"
      });

      const branchAlpha = createBranch(fixture.handle, { name: "branch-alpha" });

      // Assessment before withdrawal is permitted
      const initialAssessment = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection",
        population: "Adult outpatient clinic attendees",
        destination: "local",
        purpose: "clinical-audit"
      });
      assert.equal(initialAssessment.permitted, true);

      // Lifecycle operation on branch-alpha
      const op = createLifecycleOperation(fixture.handle, {
        id: "op_test_lifecycle_1",
        operationType: "data-collection-run",
        branchId: branchAlpha.id,
        inputSnapshot: JSON.stringify({ versionIds: [], activity: "data-collection" }),
        status: "queued"
      });
      const mismatchOp = createLifecycleOperation(fixture.handle, {
        id: "op_test_lifecycle_mismatch",
        operationType: "data-collection-run",
        branchId: branchAlpha.id,
        inputSnapshot: JSON.stringify({ versionIds: [], activity: "data-collection" }),
        status: "queued"
      });
      const incompleteSnapshotCheckpoint = checkLifecyclePolicy(fixture.handle, op.id, "acceptance", {
        activity: "data-collection",
        population: "Adult outpatient clinic attendees",
        destination: "local",
        purpose: "clinical-audit"
      });
      assert.equal(incompleteSnapshotCheckpoint.status, "blocked");
      assert.match(incompleteSnapshotCheckpoint.reason, /explicit population|operation snapshot/);
      const mismatchCheckpoint = checkLifecyclePolicy(fixture.handle, mismatchOp.id, "acceptance", {
        activity: "literature-only"
      });
      assert.equal(mismatchCheckpoint.status, "blocked");
      assert.ok(mismatchCheckpoint.reason.includes("does not match operation snapshot"));

      // Work contract
      const proposed = proposeContract(fixture.handle, fixture.ownerCap, {
        id: "survey-contract",
        objective: "Clinic survey run",
        scope: { activity: "data-collection", population: "Adult outpatient clinic attendees" },
        permittedRoles: ["evidence"],
        destination: "local",
        purpose: "clinical-audit",
        limits: { tokens: 1000, calls: 10, timeMs: 10000 }
      });
      const contract = authorizeContract(fixture.handle, fixture.ownerCap, { contractId: proposed.id });

      // Queue run works before withdrawal
      const run = queueRun(fixture.handle, fixture.ownerCap, {
        contractId: contract.id,
        commandId: "cmd_run_survey_1",
        activity: "data-collection"
      });
      assert.ok(run.id);

      // Now withdraw external authorization. Replays return the same transition
      // without creating another immutable artifact; a conflicting replay fails
      // before any artifact write.
      const beforeTransitionArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      const withdrawRequest = {
        authorizationId: grant.id,
        reason: "Sponsor withdrawn consent after protocol revision",
        commandId: "cmd_withdraw_sponsor"
      };
      const withdrawn = withdrawExternalAuthorization(fixture.handle, fixture.ownerCap, withdrawRequest);
      const replayedWithdraw = withdrawExternalAuthorization(fixture.handle, fixture.ownerCap, withdrawRequest);
      assert.equal(replayedWithdraw.id, withdrawn.id);
      const afterReplayArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      assert.equal(afterReplayArtifacts, beforeTransitionArtifacts + 1);
      assert.throws(
        () => withdrawExternalAuthorization(fixture.handle, fixture.ownerCap, {
          ...withdrawRequest,
          reason: "Conflicting reason"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
      );
      const afterConflictArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      assert.equal(afterConflictArtifacts, afterReplayArtifacts);

      // 1. Re-assessment shows withdrawn
      const afterWithdraw = assessActivityAuthorization(fixture.handle, { activity: "data-collection" });
      assert.equal(afterWithdraw.permitted, false);
      assert.equal(afterWithdraw.status, "withdrawn");

      // 2. Lifecycle check is blocked and fenced across branches with cannot-recall reported
      const checkpoint = checkLifecyclePolicy(fixture.handle, op.id, "external", {
        activity: "data-collection",
        destination: "remote-archive",
        purpose: "offsite-backup"
      });
      assert.equal(checkpoint.status, "blocked");
      assert.ok(checkpoint.reason.includes("cannot-recall"), "reports cannot-recall for external phase");

      // 3. Queue run is blocked across branches
      assert.throws(
        () =>
          queueRun(fixture.handle, fixture.ownerCap, {
            contractId: contract.id,
            commandId: "cmd_run_survey_2",
            activity: "data-collection",
            branchId: branchAlpha.id
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 4. Material population change marks needs-review
      const newGrant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["participant-contact"],
        populationOrDataUse: { population: "Healthy adults aged 18-35" },
        applicabilityBasis: "Ethics approved scope"
      });
      assert.ok(newGrant.id);

      const materialChangeAssessment = assessActivityAuthorization(fixture.handle, {
        activity: "participant-contact",
        population: "Pediatric cohort under 12"
      });
      assert.equal(materialChangeAssessment.status, "needs-review");
      assert.equal(materialChangeAssessment.permitted, false);
      const broaderPopulationAssessment = assessActivityAuthorization(fixture.handle, {
        activity: "participant-contact",
        population: "Healthy adults"
      });
      assert.equal(broaderPopulationAssessment.permitted, false);
      const narrowerPopulationAssessment = assessActivityAuthorization(fixture.handle, {
        activity: "participant-contact",
        population: "Healthy adults aged 18-35 plus controls"
      });
      assert.equal(narrowerPopulationAssessment.permitted, false);
      const exactPopulationAssessment = assessActivityAuthorization(fixture.handle, {
        activity: "participant-contact",
        population: "Healthy adults aged 18-35"
      });
      assert.equal(exactPopulationAssessment.permitted, true);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 expiry command blocks assessment lifecycle queue and retry deterministically (SC-e10s04-P0-04)", () => {
    const fixture = createEthicsFixture();
    try {
      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: { population: "Adult participants", destination: "local", purpose: "research-analysis" },
        applicabilityBasis: "Committee approval for the study"
      });
      const proposed = proposeContract(fixture.handle, fixture.ownerCap, {
        id: "expiry-contract",
        objective: "Run the approved data collection",
        scope: { activity: "data-collection", population: "Adult participants" },
        permittedRoles: ["evidence"],
        destination: "local",
        purpose: "research-analysis",
        limits: { tokens: 1000, calls: 10, timeMs: 10000 }
      });
      const contract = authorizeContract(fixture.handle, fixture.ownerCap, { contractId: proposed.id });
      const run = queueRun(fixture.handle, fixture.ownerCap, {
        contractId: contract.id,
        commandId: "cmd_expiry_run",
        activity: "data-collection"
      });
      const malformedRetry = queueRun(fixture.handle, fixture.ownerCap, {
        contractId: contract.id,
        commandId: "cmd_malformed_retry",
        activity: "data-collection",
        reservation: { tokens: 0, calls: 1, timeMs: 0 }
      });
      updateRun(fixture.handle, malformedRetry.id, "failed", "prepare malformed snapshot regression");
      fixture.handle.db.prepare("UPDATE lifecycle_operations SET input_snapshot = ? WHERE id = ?").run("not-json", malformedRetry.operationId);
      assert.throws(
        () => retryRun(fixture.handle, fixture.ownerCap, malformedRetry.id, "cmd_malformed_retry_attempt"),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      const beforeExpireArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      const expireRequest = {
        authorizationId: grant.id,
        reason: "Approval period ended",
        commandId: "cmd_expire_approval"
      };
      const expired = expireExternalAuthorization(fixture.handle, fixture.ownerCap, expireRequest);
      const replayedExpire = expireExternalAuthorization(fixture.handle, fixture.ownerCap, expireRequest);
      assert.equal(expired.status, "expired");
      assert.equal(replayedExpire.id, expired.id);
      const afterExpireReplayArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      assert.equal(afterExpireReplayArtifacts, beforeExpireArtifacts + 1);
      assert.throws(
        () => expireExternalAuthorization(fixture.handle, fixture.ownerCap, {
          ...expireRequest,
          reason: "Conflicting expiry reason"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
      );
      const afterExpireConflictArtifacts = (fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count;
      assert.equal(afterExpireConflictArtifacts, afterExpireReplayArtifacts);
      const assessment = assessActivityAuthorization(fixture.handle, { activity: "data-collection" });
      assert.equal(assessment.status, "expired");
      assert.equal(assessment.permitted, false);

      const checkpoint = checkLifecyclePolicy(fixture.handle, run.operationId, "external", {
        activity: "data-collection"
      });
      assert.equal(checkpoint.status, "blocked");
      assert.ok(checkpoint.reason.includes("expired"));
      assert.ok(checkpoint.reason.includes("cannot-recall"));

      assert.throws(
        () => queueRun(fixture.handle, fixture.ownerCap, {
          contractId: contract.id,
          commandId: "cmd_expiry_run_again",
          activity: "data-collection"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      updateRun(fixture.handle, run.id, "failed", "provider failed after expiry test setup");
      assert.throws(
        () => retryRun(fixture.handle, fixture.ownerCap, run.id, "cmd_expiry_retry"),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 invalid persisted authorization status fails closed (SC-e10s04-P0-05)", () => {
    const fixture = createEthicsFixture();
    try {
      const grant = recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: "Adult participants",
        applicabilityBasis: "Committee approval"
      });
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["participant-contact"],
        populationOrDataUse: "Adult participants",
        applicabilityBasis: "Pending committee response",
        status: "unknown"
      });
      const unknownAssessment = assessActivityAuthorization(fixture.handle, { activity: "participant-contact" });
      assert.equal(unknownAssessment.status, "unknown");
      assert.equal(unknownAssessment.permitted, false);
      fixture.handle.db.prepare("UPDATE external_authorizations SET status = ? WHERE id = ?").run("invented-status", grant.id);
      const assessment = assessActivityAuthorization(fixture.handle, { activity: "data-collection" });
      assert.equal(assessment.permitted, false);
      assert.equal(assessment.status, "unauthorized");
      assert.throws(
        () => inspectAuthorization(fixture.handle, fixture.ownerCap, { activity: "data-collection" }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 not-required basis star worker denied and omit-activity regression passes (SC-e10s04-P1-04)", () => {
    const fixture = createEthicsFixture();
    try {
      // 1. not-required without applicability basis throws
      assert.throws(
        () =>
          recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
            activities: ["literature-only"],
            populationOrDataUse: "Public literature",
            status: "not-required",
            applicabilityBasis: "   " // empty
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: { population: "Adults", dataClasses: ["survey"] },
        status: "not-required",
        applicabilityBasis: "Activity does not meet the committee's jurisdiction"
      });
      const mismatchedNotRequired = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Children", dataClasses: ["survey"]
      });
      assert.equal(mismatchedNotRequired.permitted, false);
      assert.equal(mismatchedNotRequired.status, "needs-review");
      const matchingNotRequired = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Adults", dataClasses: ["survey"]
      });
      assert.equal(matchingNotRequired.permitted, true);
      assert.equal(matchingNotRequired.status, "not-required");

      // 2. Star worker cannot record documented-approved
      const starWorker = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["*"]
      });
      assert.throws(
        () =>
          recordExternalAuthorization(fixture.handle, starWorker, {
            activities: ["data-collection"],
            populationOrDataUse: "All participants",
            applicabilityBasis: "Claimed self-approval"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 3. Existing omit-activity E04 caller-supplied path passes without regression
      const art = registerArtifactVersion(fixture.handle, {
        logicalId: "e04-compat-artifact", version: "1.0",
        content: "Analysis notes", origin: "source-import", access: "metadata-only"
      });
      updateBranchReference(fixture.handle, {
        branchId: "main", logicalId: "e04-compat-artifact", artifactVersionId: art.id,
        expectedVersion: 0, commandId: "ref-compat-1"
      });

      const packet = createDecisionPacket(fixture.handle, {
        branchId: "main", question: "E04 omit-activity compatibility packet", candidateVersionIds: [art.id]
      });

      const omitActivityGate = evaluateCommitmentGates(fixture.handle, {
        packetId: packet.id,
        // activity omitted!
        destination: undefined,
        ownerCapability: fixture.ownerCap
      });
      assert.equal(omitActivityGate.allowed, true);
      const authGate = omitActivityGate.gates.find((g) => g.gate === "external-authorization");
      assert.ok(authGate);
      assert.equal(authGate.passed, true);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 lifecycle binds structured snapshot context and checks current permissions", () => {
    const fixture = createEthicsFixture();
    try {
      const input = registerArtifactVersion(fixture.handle, {
        logicalId: "structured-lifecycle-input", version: "1.0", content: "structured input",
        origin: "source-import", access: "metadata-only"
      });
      classifyInput(fixture.handle, input.id, { sensitivity: "public", basis: "lifecycle coverage" });
      grantDataUse(fixture.handle, {
        inputVersion: input.id, destination: "local", purpose: "structured-study", authority: "owner-test"
      });
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: {
          population: "Adults", dataClasses: ["survey"], dataUse: "research",
          destination: "local", purpose: "structured-study", conditions: [{ region: "Auckland" }]
        },
        applicabilityBasis: "Structured lifecycle approval"
      });
      const operation = createLifecycleOperation(fixture.handle, {
        operationType: "data-collection",
        inputSnapshot: {
          versionIds: [input.id], activity: "data-collection", population: "Adults",
          dataClasses: ["survey"], dataUse: "research", destination: "local",
          purpose: "structured-study", conditions: [{ region: "Auckland" }]
        }
      });
      const candidateWorker = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["work:submit-candidate"]
      });
      const checkpoint = checkLifecyclePolicy(fixture.handle, operation.id, "acceptance", {
        capability: candidateWorker,
        activity: "data-collection", population: "Adults", dataClasses: ["survey"],
        dataUse: "research", conditions: [{ region: "Auckland" }], allowCandidateSubmission: true
      });
      assert.equal(checkpoint.status, "passed");
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 preserves raw E03 artifact snapshots while binding structured activities", () => {
    const fixture = createEthicsFixture();
    try {
      const art = registerArtifactVersion(fixture.handle, {
        logicalId: "raw-e03-input", version: "1.0", content: "raw input", origin: "source-import", access: "full-text"
      });
      classifyInput(fixture.handle, art.id, { sensitivity: "confidential", basis: "raw snapshot regression" });
      grantDataUse(fixture.handle, {
        inputVersion: art.id, destination: "local", purpose: "test", authority: "owner-test"
      });
      const operation = createLifecycleOperation(fixture.handle, {
        operationType: "analysis", inputSnapshot: art.id, status: "queued"
      });
      assert.equal(checkLifecyclePolicy(fixture.handle, operation.id, "dispatch", {
        destination: "local", purpose: "test"
      }).status, "passed");
      const forgedOperation = { ...operation, inputSnapshot: JSON.stringify({ versionIds: ["missing"], activity: "data-collection" }), status: "cancelled" as const };
      assert.equal(checkLifecyclePolicy(fixture.handle, forgedOperation, "dispatch", {
        destination: "local", purpose: "test"
      }).status, "passed");
      const arrayOperation = createLifecycleOperation(fixture.handle, {
        operationType: "analysis", inputSnapshot: JSON.stringify([art.id]), status: "queued"
      });
      assert.equal(checkLifecyclePolicy(fixture.handle, arrayOperation.id, "dispatch", {
        destination: "local", purpose: "test"
      }).status, "passed");
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 binds authorization destination, purpose, data use, and conditions at work admission", () => {
    const fixture = createEthicsFixture();
    try {
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"],
        populationOrDataUse: {
          population: "Adults",
          dataUse: "identifiable-survey",
          destination: "approved-destination",
          purpose: "approved-purpose",
          conditions: ["local-only"]
        },
        applicabilityBasis: "Board approval"
      });
      const proposed = proposeContract(fixture.handle, fixture.ownerCap, {
        id: "scope-mismatch-contract",
        objective: "collect data",
        scope: { activity: "data-collection", population: "Adults", dataUse: "identifiable-survey", conditions: ["local-only"] },
        permittedRoles: ["evidence"],
        destination: "other-destination",
        purpose: "other-purpose",
        limits: { tokens: 10, calls: 1, timeMs: 1000 }
      });
      const contract = authorizeContract(fixture.handle, fixture.ownerCap, { contractId: proposed.id });
      assert.throws(
        () => queueRun(fixture.handle, fixture.ownerCap, {
          contractId: contract.id, commandId: "scope-mismatch-run", activity: "data-collection"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden" && /destination/.test(error.message)
      );

      const directMismatch = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Adults", dataUse: "aggregate",
        destination: "approved-destination", purpose: "approved-purpose", conditions: ["local-only"]
      });
      assert.equal(directMismatch.status, "needs-review");
      assert.equal(directMismatch.permitted, false);
      const directConditionMismatch = assessActivityAuthorization(fixture.handle, {
        activity: "data-collection", population: "Adults", dataUse: "identifiable-survey",
        destination: "approved-destination", purpose: "approved-purpose", conditions: ["remote"]
      });
      assert.equal(directConditionMismatch.status, "needs-review");
      assert.equal(directConditionMismatch.permitted, false);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s04 records external authorization changes in readiness without inventing context", () => {
    const fixture = createEthicsFixture();
    try {
      const art = registerArtifactVersion(fixture.handle, {
        logicalId: "readiness-activity", version: "1.0", content: "protocol", origin: "source-import", access: "full-text"
      });
      updateBranchReference(fixture.handle, {
        branchId: "main", logicalId: "readiness-activity", artifactVersionId: art.id,
        expectedVersion: 0, commandId: "readiness-activity-ref"
      });
      classifyInput(fixture.handle, art.id, { sensitivity: "confidential", basis: "readiness test" });
      grantDataUse(fixture.handle, {
        inputVersion: art.id, destination: "local", purpose: "review", authority: "owner-test"
      });
      const packet = createDecisionPacket(fixture.handle, {
        branchId: "main", question: "activity readiness", candidateVersionIds: [art.id]
      });
      const decision = recordOwnerDecision(fixture.handle, {
        packetId: packet.id, disposition: "approved", selectedCandidateVersionIds: [art.id],
        commandId: "readiness-activity-approval", capability: fixture.ownerCap
      });
      recordExternalAuthorization(fixture.handle, fixture.ownerCap, {
        activities: ["data-collection"], populationOrDataUse: { population: "Adults" }, applicabilityBasis: "Board approval"
      });

      const missingContext = assessReadiness(fixture.handle, {
        commitmentId: decision.commitmentId, activity: "data-collection", commandId: "readiness-missing-context"
      });
      assert.equal(missingContext.status, "needs-review");
      assert.match(missingContext.reason, /explicit population|external authorization/i);
      const changedContext = assessReadiness(fixture.handle, {
        commitmentId: decision.commitmentId, activity: "data-collection", population: "Children",
        commandId: "readiness-changed-context"
      });
      assert.equal(changedContext.status, "needs-review");
      assert.match(changedContext.reason, /external authorization|outside authorized/i);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });
});
