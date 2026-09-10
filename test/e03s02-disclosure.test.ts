// story: e03s02
// scenario: SC-e03s02-P0-01, SC-e03s02-P0-02, SC-e03s02-P1-03
import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyInput,
  createBranch,
  deriveMaterial,
  effectiveRestriction,
  getBranch,
  grantDataUse,
  inspectSnapshot,
  listDisclosureDecisions,
  registerArtifactVersion,
  requestDisclosure,
  updateBranchReference,
  withdrawDataUse,
  DISCLOSURE_OPERATIONS,
  type DisclosureOperationKind,
  ProjectStoreError
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

test("e03s02 disclosure request destination canonicalization and redacted decision", () => {
  const fixture = projectFixture();
  try {
    const doc = artifact(fixture.handle, "doc1.txt", "v1", "Sensitive patient notes");
    classifyInput(fixture.handle, doc.id, {
      sensitivity: "confidential",
      basis: "clinical trial protocol",
      actor: "clinician"
    });

    // Test invalid operation kind rejected with denial
    const invalidOp = requestDisclosure(fixture.handle, {
      sourceVersions: [doc.id],
      operation: "unsupported-op" as DisclosureOperationKind,
      destination: "local",
      purpose: "test"
    });
    assert.equal(invalidOp.status, "deny");
    assert.match(invalidOp.reason, /unsupported disclosure operation/i);

    // Test empty source versions rejected
    const emptySources = requestDisclosure(fixture.handle, {
      sourceVersions: [],
      operation: "summary",
      destination: "local",
      purpose: "test"
    });
    assert.equal(emptySources.status, "deny");
    assert.match(emptySources.reason, /no source versions specified/i);

    // Test deriveMaterial creates record with inherited restrictions
    const derived = deriveMaterial(fixture.handle, [doc.id], "summarize", "main");
    assert.ok(derived.id);
    assert.deepEqual(derived.sourceVersionIds, [doc.id]);
    assert.equal(derived.transformation, "summarize");
    assert.ok(derived.inheritedRestrictions.some((r) => r.includes("confidential")));

    // Test error on empty deriveMaterial inputs
    assert.throws(
      () => deriveMaterial(fixture.handle, [], "transform"),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
    );

    // Decisions are inspectable and redacted
    const decisions = listDisclosureDecisions(fixture.handle);
    assert.ok(decisions.length >= 2);
    for (const d of decisions) {
      assert.ok(!d.reason.includes("Sensitive patient notes"));
    }
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s02 inherit effective restrictions across dependency versions and branch isolation", () => {
  const fixture = projectFixture();
  try {
    // SC-e03s02-P0-01: Source material with dependency
    const rawData = artifact(fixture.handle, "raw_genomics.bam", "v1", "ACGT_RESTRICTED_DATA");
    classifyInput(fixture.handle, rawData.id, {
      sensitivity: "restricted",
      basis: "Genomic data policy",
      actor: "lab-admin"
    });

    // Derived artifact with dependency reference
    const derivedVariant = artifact(fixture.handle, "variants.vcf", "v1", "variant summary", [
      { versionId: rawData.id, relation: "derived-from" }
    ]);
    classifyInput(fixture.handle, derivedVariant.id, {
      sensitivity: "confidential",
      basis: "Variant table",
      actor: "bioinformatician"
    });

    // Check effective restriction: must inherit highest sensitivity ("restricted") from rawData
    const effective = effectiveRestriction(fixture.handle, [derivedVariant.id]);
    assert.equal(effective.highestSensitivity, "restricted");
    assert.ok(effective.allResolvedVersionIds.includes(rawData.id));
    assert.ok(effective.allResolvedVersionIds.includes(derivedVariant.id));
    assert.equal(effective.isLocalOnly, true); // rawData has no external grant

    // External disclosure of derived variant is denied due to inherited restriction
    const remoteAttempt = requestDisclosure(fixture.handle, {
      sourceVersions: [derivedVariant.id],
      operation: "export",
      destination: "external-repo",
      purpose: "publication"
    });
    assert.equal(remoteAttempt.status, "deny");
    assert.match(remoteAttempt.reason, /restricted to local-only/i);

    // Now grant permission covering both raw and derived for export
    grantDataUse(fixture.handle, {
      inputVersion: rawData.id,
      destination: "external-repo",
      purpose: "publication",
      authority: "data-access-committee"
    });
    grantDataUse(fixture.handle, {
      inputVersion: derivedVariant.id,
      destination: "external-repo",
      purpose: "publication",
      authority: "data-access-committee"
    });

    const allowedExport = requestDisclosure(fixture.handle, {
      sourceVersions: [derivedVariant.id],
      operation: "export",
      destination: "external-repo",
      purpose: "publication"
    });
    assert.equal(allowedExport.status, "allow");
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s02 route prompt attach summary compact snippet embed telemetry export diagnostic analysis through gateway", () => {
  const fixture = projectFixture();
  try {
    const doc = artifact(fixture.handle, "experiment.log", "v1", "Step 1: temperature 300K\nStep 2: reaction completed");
    classifyInput(fixture.handle, doc.id, {
      sensitivity: "confidential",
      basis: "Internal Lab Note",
      actor: "researcher-1"
    });

    const grant = grantDataUse(fixture.handle, {
      inputVersion: doc.id,
      destination: "cloud-analyser",
      purpose: "research-synthesis",
      authority: "pi-approval"
    });
    assert.ok(grant.id);

    // All 10 operations must be supported through gateway
    for (const op of DISCLOSURE_OPERATIONS) {
      // 1. Local destination allowed
      const localResult = requestDisclosure(fixture.handle, {
        sourceVersions: [doc.id],
        operation: op,
        destination: "local",
        purpose: "research-synthesis"
      });
      assert.equal(localResult.status, "allow", `local operation '${op}' should be allowed`);

      // 2. Permitted remote destination allowed
      const remoteResult = requestDisclosure(fixture.handle, {
        sourceVersions: [doc.id],
        operation: op,
        destination: "cloud-analyser",
        purpose: "research-synthesis"
      });
      assert.equal(remoteResult.status, "allow", `remote operation '${op}' with grant should be allowed`);

      // 3. Unpermitted remote destination denied
      const unpermittedResult = requestDisclosure(fixture.handle, {
        sourceVersions: [doc.id],
        operation: op,
        destination: "unauthorized-cloud",
        purpose: "research-synthesis"
      });
      assert.equal(unpermittedResult.status, "deny", `remote operation '${op}' to unpermitted destination should be denied`);
    }

    const filtered = listDisclosureDecisions(fixture.handle, { operation: "prompt" });
    assert.ok(filtered.length >= 3);
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s02 cross-branch revoke blocks future requests with no fallback and offline redact decisions", () => {
  const fixture = projectFixture();
  try {
    // SC-e03s02-P0-02: Cross-branch revocation
    const sharedData = artifact(fixture.handle, "cohort.json", "v1", '{"cohort_size": 500}');
    classifyInput(fixture.handle, sharedData.id, {
      sensitivity: "participant-identifiable",
      basis: "Cohort Registry",
      actor: "study-lead"
    });

    const grant = grantDataUse(fixture.handle, {
      inputVersion: sharedData.id,
      destination: "stats-cluster",
      purpose: "power-analysis",
      authority: "irb-board"
    });

    // Create two separate branches referencing sharedData
    const branchA = createBranch(fixture.handle, { name: "analysis-branch-a" });
    const branchB = createBranch(fixture.handle, { name: "analysis-branch-b" });
    assert.ok(branchA);
    assert.ok(branchB);

    updateBranchReference(fixture.handle, {
      branchId: branchA.id,
      logicalId: "cohort.json",
      artifactVersionId: sharedData.id,
      expectedVersion: 0,
      commandId: "attach-branch-a"
    });

    updateBranchReference(fixture.handle, {
      branchId: branchB.id,
      logicalId: "cohort.json",
      artifactVersionId: sharedData.id,
      expectedVersion: 0,
      commandId: "attach-branch-b"
    });

    // Initial requests from both branches: ALLOW
    const reqA = requestDisclosure(fixture.handle, {
      sourceVersions: [sharedData.id],
      operation: "analysis",
      destination: "stats-cluster",
      purpose: "power-analysis",
      branchId: branchA.id
    });
    assert.equal(reqA.status, "allow");

    const reqB = requestDisclosure(fixture.handle, {
      sourceVersions: [sharedData.id],
      operation: "analysis",
      destination: "stats-cluster",
      purpose: "power-analysis",
      branchId: branchB.id
    });
    assert.equal(reqB.status, "allow");

    // Withdraw permission
    withdrawDataUse(fixture.handle, grant.id, "Withdrawn consent by participant group", "study-lead");

    // Now requests from BOTH branches are DENIED
    const reqAAfterRevoke = requestDisclosure(fixture.handle, {
      sourceVersions: [sharedData.id],
      operation: "analysis",
      destination: "stats-cluster",
      purpose: "power-analysis",
      branchId: branchA.id
    });
    assert.equal(reqAAfterRevoke.status, "deny");
    assert.match(reqAAfterRevoke.reason, /was withdrawn/i);

    const reqBAfterRevoke = requestDisclosure(fixture.handle, {
      sourceVersions: [sharedData.id],
      operation: "analysis",
      destination: "stats-cluster",
      purpose: "power-analysis",
      branchId: branchB.id
    });
    assert.equal(reqBAfterRevoke.status, "deny");
    assert.match(reqBAfterRevoke.reason, /was withdrawn/i);

    // SC-e03s02-P1-03: No remote fallback on denial
    // Check that historical snapshots on branch A and B remain intact
    const currentBranchA = getBranch(fixture.handle, branchA.id);
    const snapA = inspectSnapshot(fixture.handle, currentBranchA.currentSnapshotId);
    assert.ok(snapA.references.some((r) => r.artifactVersionId === sharedData.id));

    const currentBranchB = getBranch(fixture.handle, branchB.id);
    const snapB = inspectSnapshot(fixture.handle, currentBranchB.currentSnapshotId);
    assert.ok(snapB.references.some((r) => r.artifactVersionId === sharedData.id));

    // Offline decision records are inspectable and contain no raw content
    const decisions = listDisclosureDecisions(fixture.handle, { branchId: branchA.id });
    assert.ok(decisions.length >= 2);
    for (const d of decisions) {
      assert.ok(!d.reason.includes("cohort_size"));
    }
  } finally {
    disposeFixture(fixture);
  }
});
