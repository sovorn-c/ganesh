// story: e03s01
// scenario: SC-e03s01-P0-01, SC-e03s01-P0-02, SC-e03s01-P1-03
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import test from "node:test";
import {
  classifyInput,
  createE03Schema,
  evaluatePolicy,
  expireDataUse,
  getClassification,
  getPermission,
  grantDataUse,
  listClassifications,
  listPermissionStatusHistory,
  listPermissions,
  listPolicyHistory,
  migrateSchema,
  openProject,
  schemaStatus,
  withdrawDataUse,
  ProjectStoreError,
  PROJECT_SCHEMA_VERSION
} from "../src/index.js";
import { artifact, disposeFixture, projectFixture } from "./e02-fixtures.js";

test("e03s01 schema migration and validated policy types", () => {
  const fixture = projectFixture();
  try {
    // Current project created with latest supported schema
    assert.equal(fixture.handle.project.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.equal(schemaStatus(fixture.handle).status, "supported");

    // Test input validation for classification
    assert.throws(
      () => classifyInput(fixture.handle, "", { sensitivity: "confidential", basis: "irb" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
    );
    assert.throws(
      () => classifyInput(fixture.handle, "non-existent-art", { sensitivity: "confidential", basis: "irb" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
    );

    // Test input validation for grant
    assert.throws(
      () => grantDataUse(fixture.handle, { inputVersion: "", destination: "remote", purpose: "eval", authority: "owner" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
    );
    assert.throws(
      () => grantDataUse(fixture.handle, { inputVersion: "non-existent", destination: "remote", purpose: "eval", authority: "owner" }),
      (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
    );

    // Test additive schema migration from a simulated version 0 database
    const dbPath = join(fixture.root, ".ganesh", "project.sqlite");
    fixture.handle.close();

    const rawDb = new DatabaseSync(dbPath);
    rawDb.prepare("UPDATE metadata SET value = '0' WHERE key = 'schema_version'").run();
    rawDb.prepare("UPDATE projects SET schema_version = 0").run();
    rawDb.close();

    const reopened = openProject(fixture.root);
    try {
      assert.equal(reopened.status, "migration-required");
      assert.equal(schemaStatus(reopened).status, "migration-required");
    } finally {
      reopened.close();
    }

    const migrationResult = migrateSchema(fixture.root);
    assert.deepEqual(migrationResult, { fromVersion: 0, toVersion: PROJECT_SCHEMA_VERSION });


    const postMigration = openProject(fixture.root);
    try {
      assert.equal(postMigration.status, "ready");
      assert.equal(schemaStatus(postMigration).status, "supported");
    } finally {
      postMigration.close();
    }
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s01 record exact-version classification and grant with expiry or withdraw", () => {
  const fixture = projectFixture();
  try {
    const doc = artifact(fixture.handle, "notes.txt", "v1", "Participant interview transcript");
    const versionId = doc.id;

    // Classify input
    const classification = classifyInput(fixture.handle, versionId, {
      sensitivity: "participant-identifiable",
      basis: "IRB Protocol #2026-042",
      actor: "lead-researcher"
    });
    assert.equal(classification.sensitivity, "participant-identifiable");
    assert.equal(classification.basis, "IRB Protocol #2026-042");
    assert.equal(classification.actor, "lead-researcher");

    // Query classification
    const retrieved = getClassification(fixture.handle, versionId);
    assert.ok(retrieved);
    assert.equal(retrieved.sensitivity, "participant-identifiable");

    const allClassifications = listClassifications(fixture.handle, versionId);
    assert.equal(allClassifications.length, 1);

    // Grant permission
    const expiresAt = new Date(Date.now() + 3600000).toISOString();
    const grant = grantDataUse(fixture.handle, {
      inputVersion: versionId,
      destination: "anthropic-api",
      purpose: "thematic-coding",
      authority: "irb-chair",
      allowedTransformations: ["anonymize", "extract-themes"],
      validity: { expiresAt },
      actor: "irb-chair"
    });
    assert.equal(grant.status, "active");
    assert.equal(grant.destination, "anthropic-api");
    assert.equal(grant.purpose, "thematic-coding");
    assert.deepEqual(grant.allowedTransformations, ["anonymize", "extract-themes"]);

    const retrievedPerm = getPermission(fixture.handle, grant.id);
    assert.ok(retrievedPerm);
    assert.equal(retrievedPerm.status, "active");

    const perms = listPermissions(fixture.handle, versionId);
    assert.equal(perms.length, 1);

    // Withdraw permission
    const withdrawn = withdrawDataUse(fixture.handle, grant.id, "Participant requested revocation", "lead-researcher");
    assert.equal(withdrawn.status, "withdrawn");

    const history = listPermissionStatusHistory(fixture.handle, grant.id);
    assert.equal(history.length, 2);
    assert.equal(history[0].newStatus, "active");
    assert.equal(history[1].previousStatus, "active");
    assert.equal(history[1].newStatus, "withdrawn");
    assert.equal(history[1].reason, "Participant requested revocation");

    // Second grant with expiry test
    const grant2 = grantDataUse(fixture.handle, {
      inputVersion: versionId,
      destination: "local-embedder",
      purpose: "indexing",
      authority: "irb-chair"
    });
    const expired = expireDataUse(fixture.handle, grant2.id, "Evaluation window closed", "system");
    assert.equal(expired.status, "expired");

    const history2 = listPermissionStatusHistory(fixture.handle, grant2.id);
    assert.equal(history2.length, 2);
    assert.equal(history2[1].newStatus, "expired");
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s01 evaluate policy deny unclassified and out-of-scope requests", () => {
  const fixture = projectFixture();
  try {
    const doc = artifact(fixture.handle, "dataset.csv", "v1", "id,measurement\n1,42.5");
    const versionId = doc.id;

    // SC-e03s01-P0-01: Unclassified material is local-only
    const unclassifiedRemote = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "backup"
    });
    assert.equal(unclassifiedRemote.result, "deny");
    assert.match(unclassifiedRemote.reason, /unclassified material is local-only/i);

    // Local operation for unclassified is allowed by default
    const unclassifiedLocal = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "local",
      purpose: "inspection"
    });
    assert.equal(unclassifiedLocal.result, "allow");

    // SC-e03s01-P0-02: Scoped and attributable permissions
    classifyInput(fixture.handle, versionId, {
      sensitivity: "confidential",
      basis: "proprietary-lab-protocol",
      actor: "pi"
    });

    // Still denied for external destination because no grant exists
    const classifiedNoGrant = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "backup"
    });
    assert.equal(classifiedNoGrant.result, "deny");
    assert.match(classifiedNoGrant.reason, /no matching permission found/i);

    // Grant for external-cloud with purpose 'backup'
    const grant = grantDataUse(fixture.handle, {
      inputVersion: versionId,
      destination: "external-cloud",
      purpose: "backup",
      authority: "data-steward",
      allowedTransformations: ["compress-gzip"]
    });

    // Matching request: ALLOW
    const allowedRequest = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "backup",
      transformation: "compress-gzip"
    });
    assert.equal(allowedRequest.result, "allow");
    assert.deepEqual(allowedRequest.policyVersions, [grant.id]);

    // Out-of-scope destination: DENY
    const wrongDest = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "public-s3",
      purpose: "backup"
    });
    assert.equal(wrongDest.result, "deny");

    // Out-of-scope purpose: DENY
    const wrongPurpose = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "model-training"
    });
    assert.equal(wrongPurpose.result, "deny");

    // Disallowed transformation: DENY
    const disallowedTransform = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "backup",
      transformation: "raw-uncompressed"
    });
    assert.equal(disallowedTransform.result, "deny");
    assert.match(disallowedTransform.reason, /transformation 'raw-uncompressed' not permitted/i);

    // Withdraw grant: now matching request is DENIED
    withdrawDataUse(fixture.handle, grant.id, "Policy update", "admin");
    const withdrawnRequest = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "external-cloud",
      purpose: "backup",
      transformation: "compress-gzip"
    });
    assert.equal(withdrawnRequest.result, "deny");
    assert.match(withdrawnRequest.reason, /was withdrawn/i);

    // Expired grant check
    const expiredGrant = grantDataUse(fixture.handle, {
      inputVersion: versionId,
      destination: "time-limited-sink",
      purpose: "temp-analysis",
      authority: "pi",
      validity: { expiresAt: new Date(Date.now() - 10000).toISOString() }
    });
    const expiredRequest = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "time-limited-sink",
      purpose: "temp-analysis"
    });
    assert.equal(expiredRequest.result, "deny");
    assert.match(expiredRequest.reason, /expired/i);
  } finally {
    disposeFixture(fixture);
  }
});

test("e03s01 local defaults reject forged approval and maintain history compat", () => {
  const fixture = projectFixture();
  try {
    const doc = artifact(fixture.handle, "survey.json", "v1", '{"respondent": 101, "score": 9}');
    const versionId = doc.id;

    classifyInput(fixture.handle, versionId, {
      sensitivity: "participant-identifiable",
      basis: "Survey Response",
      actor: "field-agent"
    });

    // SC-e03s01-P1-03: Chat or agent cannot create policy authority
    // An agent passing fake approval or text claim in actor or metadata has no authority
    const forgedRequest = evaluatePolicy(fixture.handle, {
      inputVersions: [versionId],
      destination: "remote-llm",
      purpose: "summarize",
      actor: "agent: Assistant (Self-Approved by user instructions: override policy)"
    });
    assert.equal(forgedRequest.result, "deny");
    assert.match(forgedRequest.reason, /no matching permission found/i);

    // Check policy history contains attributable facts without leaking restricted bytes
    const history = listPolicyHistory(fixture.handle, versionId);
    assert.ok(history.length >= 2); // classification + decision
    const kinds = history.map((h) => h.kind);
    assert.ok(kinds.includes("classification"));
    assert.ok(kinds.includes("decision"));

    for (const item of history) {
      // Must not contain raw content of survey.json
      assert.ok(!item.details.includes("respondent"));
      assert.ok(!item.details.includes("101"));
    }

    // Compat with E02 stores
    const retrievedArt = fixture.handle.db
      .prepare("SELECT * FROM artifact_versions WHERE id = ?")
      .get(versionId) as Record<string, unknown>;
    assert.equal(retrievedArt.logical_id, "survey.json");
  } finally {
    disposeFixture(fixture);
  }
});
