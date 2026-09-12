// story: e07s04
// scenario: SC-e07s04-P0-01, SC-e07s04-P0-02, SC-e07s04-P0-03, SC-e07s04-P1-04
import { strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  applySourceNotice,
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
