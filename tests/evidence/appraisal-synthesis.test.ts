// story: e07s04
// scenario: SC-e07s04-P0-01, SC-e07s04-P0-02, SC-e07s04-P0-03, SC-e07s04-P1-04
import { strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  ProjectStoreError,
  applySourceNotice,
  getAppraisal,
  getSynthesis,
  listCommitments,
  listScholarlyFindings,
  linkClaimEvidence,
  recordAppraisal,
  recordClaim,
  recordEvidenceItem,
  synthesizeClaims
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { evidenceWorker, importText } from "../support/evidence-fixtures.js";

test("e07s04 thematic appraisal treats kappa and power as not applicable", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s04-thematic");
    const appraisal = recordAppraisal(fixture.handle, evidenceWorker(fixture.handle), {
      commandId: "e07s04-thematic-appraisal", sourceVersionId: imported.result.artifactVersionId, methodKind: "reflexive-thematic-analysis"
    });
    strictEqual(appraisal.result, "pass");
    strictEqual(appraisal.findings.every((finding) => finding.result === "not-applicable"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s04 appraisal and synthesis require command identity and schema", () => {
  const fixture = projectFixture();
  try {
    const source = importText(fixture.handle, "e07s04-command-guards");
    const capability = evidenceWorker(fixture.handle);
    const invalid = (error: unknown) => error instanceof ProjectStoreError && error.code === "invalid-command";
    throws(() => recordAppraisal(fixture.handle, capability, {
      commandId: "", sourceVersionId: source.result.artifactVersionId, methodKind: "unspecified"
    }), invalid);
    throws(() => synthesizeClaims(fixture.handle, capability, { commandId: "" }), invalid);

    fixture.handle.db.exec("DROP TABLE claims");
    const unavailable = (error: unknown) => error instanceof ProjectStoreError && error.code === "evidence-schema-unavailable";
    throws(() => getAppraisal(fixture.handle, capability, "missing"), unavailable);
    throws(() => getSynthesis(fixture.handle, capability, "missing"), unavailable);
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s04 appraisal provenance and retries remain bounded", () => {
  const fixture = projectFixture();
  try {
    const source = importText(fixture.handle, "e07s04-retry");
    const capability = evidenceWorker(fixture.handle);
    const first = recordAppraisal(fixture.handle, capability, {
      commandId: "e07s04-appraisal-retry", sourceVersionId: source.result.artifactVersionId,
      methodKind: "reflexive-thematic-analysis", origin: "owner-recorded"
    });
    strictEqual(first.origin, "specialist-proposed");
    strictEqual(recordAppraisal(fixture.handle, capability, {
      commandId: "e07s04-appraisal-retry", sourceVersionId: source.result.artifactVersionId,
      methodKind: "reflexive-thematic-analysis", origin: "owner-recorded"
    }).id, first.id);
    throws(() => recordAppraisal(fixture.handle, capability, {
      commandId: "e07s04-appraisal-retry", sourceVersionId: source.result.artifactVersionId,
      methodKind: "quantitative-dependent-observations", origin: "owner-recorded"
    }));
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s04 synthesis retries reject complete payload conflicts", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s04-synthesis-retry");
    const capability = evidenceWorker(fixture.handle);
    const evidence = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s04-synthesis-evidence", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id }, statementKind: "measured-finding", includeExcerpt: true
    });
    const firstClaim = recordClaim(fixture.handle, capability, { commandId: "e07s04-synthesis-first-claim", statement: "first synthesis claim" });
    const secondClaim = recordClaim(fixture.handle, capability, { commandId: "e07s04-synthesis-second-claim", statement: "second synthesis claim" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s04-synthesis-first-link", claimId: firstClaim.id, evidenceItemId: evidence.id, role: "supporting" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s04-synthesis-second-link", claimId: secondClaim.id, evidenceItemId: evidence.id, role: "supporting" });
    const request = { commandId: "e07s04-synthesis-retry", claimIds: [firstClaim.id], summary: "bounded summary", qualifications: ["bounded"] };
    const first = synthesizeClaims(fixture.handle, capability, request);
    strictEqual(synthesizeClaims(fixture.handle, capability, request).id, first.id);
    const conflict = (error: unknown) => error instanceof ProjectStoreError && error.code === "synthesis-payload-conflict";
    throws(() => synthesizeClaims(fixture.handle, capability, { ...request, summary: "changed summary" }), conflict);
    throws(() => synthesizeClaims(fixture.handle, capability, { ...request, qualifications: ["changed"] }), conflict);
    throws(() => synthesizeClaims(fixture.handle, capability, { ...request, claimIds: [secondClaim.id] }), conflict);
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s04 quantitative appraisal raises ignored dependent observations and synthesis stays qualified", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s04-quantitative");
    const capability = evidenceWorker(fixture.handle);
    const issue = recordAppraisal(fixture.handle, capability, {
      commandId: "e07s04-quantitative-appraisal", sourceVersionId: imported.result.artifactVersionId,
      methodKind: "quantitative-dependent-observations", analysis: { dependentObservationsAddressed: false }
    });
    strictEqual(issue.findings.some((finding) => finding.result === "analysis-issue"), true);
    const relabeled = recordAppraisal(fixture.handle, capability, {
      commandId: "e07s04-longitudinal-appraisal", sourceVersionId: imported.result.artifactVersionId,
      methodKind: "longitudinal", analysis: { dependentObservationsAddressed: false }
    });
    strictEqual(relabeled.findings.some((finding) => finding.result === "analysis-issue"), true);
    const evidence = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s04-evidence", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id }, statementKind: "measured-finding", includeExcerpt: true
    });
    const claim = recordClaim(fixture.handle, capability, { commandId: "e07s04-claim", statement: "qualified synthesis claim" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s04-link", claimId: claim.id, evidenceItemId: evidence.id, role: "supporting", qualification: "limited observation" });
    applySourceNotice(fixture.handle, capability, { commandId: "e07s04-notice", sourceVersionId: imported.result.artifactVersionId, notice: "correction" });
    const synthesis = synthesizeClaims(fixture.handle, capability, { commandId: "e07s04-synthesis", claimIds: [claim.id] });
    strictEqual(synthesis.reassessmentFlags.includes(claim.id), true);
    strictEqual(synthesis.limitations.includes("limited observation"), true);
    strictEqual(synthesis.qualifications.some((value) => /universal|exhaustive|validity/i.test(value)), false);
    strictEqual(listCommitments(fixture.handle).length, 0);
    strictEqual(listScholarlyFindings(fixture.handle).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});
