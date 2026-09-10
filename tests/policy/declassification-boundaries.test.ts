// story: e03s05
// scenario: SC-e03s05-P0-01, SC-e03s05-P0-02, SC-e03s05-P1-03
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createProject,
  openProject,
  registerArtifactVersion,
  classifyInput,
  grantDataUse,
  withdrawDataUse,
  requestDeclassification,
  getDeclassification,
  listDeclassifications,
  updateDeclassificationStatus,
  authorizeTransformedDisclosure,
  runAdversarialBoundarySuite,
  inspectPolicyAudit,
  createLifecycleOperation,
  checkLifecyclePolicy,
  fenceRevokedOperation
} from "../../src/index.js";

function makeFixture(): { root: string; cleanup: () => void } {
  const root = mkdtempSync(join(tmpdir(), "ganesh-declassification-"));
  return {
    root,
    cleanup: () => {
      try {
        rmSync(root, { recursive: true, force: true });
      } catch {}
    }
  };
}

test("declass transform residual audit records exact input versions and reviewable status", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "sensitive-transcript",
      version: "1.0.0",
      content: "participant: Bob, age: 42, condition: diabetic",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "participant-identifiable",
      basis: "Interview transcript"
    });

    const declass = requestDeclassification(handle, {
      inputVersionIds: [art.id],
      transformation: "anonymize-participant-identifiers",
      destination: "public-archive",
      purpose: "open-science-sharing",
      authority: "irb-declass-001",
      residualRisk: "low-indirect-reidentification-risk",
      validityConditions: { maxDisclosureCount: 10 }
    });

    assert.ok(declass.id);
    assert.deepEqual(declass.inputVersionIds, [art.id]);
    assert.equal(declass.transformation, "anonymize-participant-identifiers");
    assert.equal(declass.destination, "public-archive");
    assert.equal(declass.purpose, "open-science-sharing");
    assert.equal(declass.authority, "irb-declass-001");
    assert.equal(declass.residualRisk, "low-indirect-reidentification-risk");
    assert.equal(declass.status, "approved");

    const fetched = getDeclassification(handle, declass.id);
    assert.ok(fetched);
    assert.equal(fetched.id, declass.id);
    assert.equal(fetched.residualRisk, "low-indirect-reidentification-risk");

    const list = listDeclassifications(handle);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, declass.id);

    updateDeclassificationStatus(handle, declass.id, "revoked");
    const updated = getDeclassification(handle, declass.id);
    assert.equal(updated?.status, "revoked");

    handle.close();
  } finally {
    fixture.cleanup();
  }
});

test("authorize current restriction lifecycle gates validate transformed disclosure against policy", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "genomic-summary",
      version: "1.0.0",
      content: "allele variations and phenotypic correlations",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "confidential",
      basis: "Genomic dataset"
    });

    const grant = grantDataUse(handle, {
      inputVersion: art.id,
      destination: "partner-consortium",
      purpose: "meta-analysis",
      authority: "irb-consortium-01"
    });

    const declass = requestDeclassification(handle, {
      inputVersionIds: [art.id],
      transformation: "k-anonymity-filter",
      destination: "partner-consortium",
      purpose: "meta-analysis",
      authority: "data-steward-carol",
      residualRisk: "minimal-aggregate-disclosure"
    });

    // 1. Mismatched destination denied
    const badDest = authorizeTransformedDisclosure(handle, declass.id, {
      declassificationId: declass.id,
      inputVersionIds: [art.id],
      transformation: "k-anonymity-filter",
      destination: "unauthorized-cloud",
      purpose: "meta-analysis"
    });
    assert.equal(badDest.authorized, false);
    assert.match(badDest.reason, /destination does not match/i);

    // 2. Mismatched purpose denied
    const badPurpose = authorizeTransformedDisclosure(handle, declass.id, {
      declassificationId: declass.id,
      inputVersionIds: [art.id],
      transformation: "k-anonymity-filter",
      destination: "partner-consortium",
      purpose: "commercial-resell"
    });
    assert.equal(badPurpose.authorized, false);
    assert.match(badPurpose.reason, /purpose does not match/i);

    // 3. Mismatched transformation denied
    const badTransform = authorizeTransformedDisclosure(handle, declass.id, {
      declassificationId: declass.id,
      inputVersionIds: [art.id],
      transformation: "raw-unfiltered-export",
      destination: "partner-consortium",
      purpose: "meta-analysis"
    });
    assert.equal(badTransform.authorized, false);
    assert.match(badTransform.reason, /transformation does not match/i);

    // 4. Withdrawal of source permission immediately blocks disclosure
    withdrawDataUse(handle, grant.id, "Consent withdrawn by donor", "owner-alice");
    const blockedWithdrawal = authorizeTransformedDisclosure(handle, declass.id, {
      declassificationId: declass.id,
      inputVersionIds: [art.id],
      transformation: "k-anonymity-filter",
      destination: "partner-consortium",
      purpose: "meta-analysis"
    });
    assert.equal(blockedWithdrawal.authorized, false);
    assert.match(blockedWithdrawal.reason, /withdrawn/i);

    // 5. Permitted transformed disclosure with matching scope succeeds
    const art2 = registerArtifactVersion(handle, {
      logicalId: "aggregated-stats",
      version: "1.0.0",
      content: "mean age: 45.2, variance: 3.1",
      access: "full-text"
    });
    classifyInput(handle, art2.id, {
      sensitivity: "confidential",
      basis: "Aggregate statistics"
    });
    grantDataUse(handle, {
      inputVersion: art2.id,
      destination: "consortium-node",
      purpose: "benchmark",
      authority: "admin-auth"
    });
    const declass2 = requestDeclassification(handle, {
      inputVersionIds: [art2.id],
      transformation: "differential-noise",
      destination: "consortium-node",
      purpose: "benchmark",
      authority: "ethics-board",
      residualRisk: "epsilon-bounded-leakage"
    });
    const goodAuth = authorizeTransformedDisclosure(handle, declass2.id, {
      declassificationId: declass2.id,
      inputVersionIds: [art2.id],
      transformation: "differential-noise",
      destination: "consortium-node",
      purpose: "benchmark"
    });
    assert.equal(goodAuth.authorized, true);
    assert.equal(goodAuth.status, "authorized");

    handle.close();
  } finally {
    fixture.cleanup();
  }
});

test("adversarial forged credential cross.project script side.effect fixtures fail at actual boundaries", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const report = runAdversarialBoundarySuite(handle);

    assert.equal(report.passed, true);
    assert.equal(report.totalSideEffects, 0);
    assert.equal(report.totalDenied, report.totalTests);
    assert.ok(report.totalTests >= 6);

    for (const res of report.results) {
      assert.equal(res.denied, true, `Expected attack ${res.name} to be denied`);
      assert.equal(res.sideEffectObserved, false, `Expected attack ${res.name} to have zero side effect`);
      assert.ok(res.reason.length > 0);
    }

    handle.close();
  } finally {
    fixture.cleanup();
  }
});

test("redact regression provenance inspect audit packet exposes safe decisions without payloads", () => {
  const fixture = makeFixture();
  try {
    const handle = createProject({ rootPath: fixture.root, ownerId: "owner-alice" });

    const art = registerArtifactVersion(handle, {
      logicalId: "private-record",
      version: "1.0.0",
      content: "TOP_SECRET_PATIENT_IDENTITY_DOE_JANE",
      access: "full-text"
    });

    classifyInput(handle, art.id, {
      sensitivity: "participant-identifiable",
      basis: "Medical chart record"
    });

    const op = createLifecycleOperation(handle, {
      operationType: "clinical-audit",
      inputSnapshot: {
        versionIds: [art.id],
        payload: "RAW_UNREDACTED_PATIENT_NOTES_CONFIDENTIAL"
      },
      status: "running"
    });

    const checkpoint = checkLifecyclePolicy(handle, op.id, "external", {
      destination: "local",
      purpose: "audit"
    });
    assert.ok(checkpoint);

    fenceRevokedOperation(handle, op.id, "Audit inspection fence test", "owner-alice");

    requestDeclassification(handle, {
      inputVersionIds: [art.id],
      transformation: "redact-patient-identifiers",
      destination: "audit-sink",
      purpose: "compliance",
      authority: "chief-compliance-officer",
      residualRisk: "zero-identifying-residual"
    });

    const auditPacket = inspectPolicyAudit(handle, op.id);

    assert.equal(auditPacket.projectId, handle.project.id);
    assert.equal(auditPacket.operationId, op.id);
    assert.ok(auditPacket.operations.length >= 1);
    assert.ok(auditPacket.checkpoints.length >= 1);
    assert.ok(auditPacket.fences.length >= 1);
    assert.ok(auditPacket.declassifications.length >= 1);

    // Verify redaction: serialized audit packet must not leak sensitive strings
    const serialized = JSON.stringify(auditPacket);

    assert.equal(serialized.includes("RAW_UNREDACTED_PATIENT_NOTES_CONFIDENTIAL"), false);
    assert.equal(serialized.includes("TOP_SECRET_PATIENT_IDENTITY_DOE_JANE"), false);

    // Provenance, statuses, and authority are preserved
    assert.ok(serialized.includes("participant-identifiable") || serialized.includes("clinical-audit"));
    assert.ok(serialized.includes("chief-compliance-officer"));
    assert.ok(serialized.includes("zero-identifying-residual"));
    assert.ok(serialized.includes("Audit inspection fence test"));

    handle.close();
  } finally {
    fixture.cleanup();
  }
});
