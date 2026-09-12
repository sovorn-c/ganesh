// story: e07s03
// scenario: SC-e07s03-P0-01, SC-e07s03-P0-02, SC-e07s03-P0-03, SC-e07s03-P1-04
import { strictEqual } from "node:assert";
import { test } from "node:test";
import {
  applySourceNotice,
  buildEvidenceMatrix,
  inspectClaim,
  linkClaimEvidence,
  recordClaim,
  recordEvidenceItem
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { evidenceWorker, importText } from "../support/evidence-fixtures.js";

test("e07s03 matrix retains disagreement and limitation cells", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s03-matrix");
    const capability = evidenceWorker(fixture.handle);
    const first = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s03-supporting", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id }, statementKind: "author-claim", includeExcerpt: true
    });
    const second = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s03-challenging", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id.replace(/-1$/, "-2") }, statementKind: "inference", includeExcerpt: true
    });
    const claim = recordClaim(fixture.handle, capability, { commandId: "e07s03-claim", statement: "matrix claim" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s03-link-a", claimId: claim.id, evidenceItemId: first.id, role: "supporting", qualification: "limited sample" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s03-link-b", claimId: claim.id, evidenceItemId: second.id, role: "challenging" });
    const row = buildEvidenceMatrix(fixture.handle, capability).rows[0];
    strictEqual(row?.supporting.length, 1);
    strictEqual(row?.challenging.length, 1);
    strictEqual(row?.disagreements.length, 1);
    strictEqual(row?.limitations.includes("limited sample"), true);
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s03 source notices add reassessment overlays without rewriting links", () => {
  const fixture = projectFixture();
  try {
    const affected = importText(fixture.handle, "e07s03-affected");
    const unrelated = importText(fixture.handle, "e07s03-unrelated");
    const capability = evidenceWorker(fixture.handle);
    const affectedEvidence = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s03-affected-evidence", sourceVersionId: affected.result.artifactVersionId,
      location: { kind: "source-locator", id: affected.locator.id }, statementKind: "measured-finding", includeExcerpt: true
    });
    const unrelatedEvidence = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s03-unrelated-evidence", sourceVersionId: unrelated.result.artifactVersionId,
      location: { kind: "source-locator", id: unrelated.locator.id }, statementKind: "measured-finding", includeExcerpt: true
    });
    const changed = recordClaim(fixture.handle, capability, { commandId: "e07s03-changed-claim", statement: "affected" });
    const untouched = recordClaim(fixture.handle, capability, { commandId: "e07s03-untouched-claim", statement: "unaffected" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s03-changed-link", claimId: changed.id, evidenceItemId: affectedEvidence.id, role: "supporting" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s03-untouched-link", claimId: untouched.id, evidenceItemId: unrelatedEvidence.id, role: "supporting" });
    const before = inspectClaim(fixture.handle, capability, changed.id);
    const result = applySourceNotice(fixture.handle, capability, { commandId: "e07s03-retraction", sourceVersionId: affected.result.artifactVersionId, notice: "source retracted", kind: "retraction" });
    strictEqual(result.claimIds.includes(changed.id), true);
    strictEqual(inspectClaim(fixture.handle, capability, changed.id).claim.currentSupport, "needs-reassessment");
    strictEqual(inspectClaim(fixture.handle, capability, untouched.id).claim.currentSupport, "substantively-supported");
    strictEqual(inspectClaim(fixture.handle, capability, changed.id).links[0]?.verificationStatus, before.links[0]?.verificationStatus);
    strictEqual(inspectClaim(fixture.handle, capability, changed.id).reassessments[0]?.previousSupport, before.claim.currentSupport);
  } finally {
    disposeFixture(fixture);
  }
});
