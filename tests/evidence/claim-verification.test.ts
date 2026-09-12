// story: e07s02
// scenario: SC-e07s02-P0-01, SC-e07s02-P0-02, SC-e07s02-P0-03, SC-e07s02-P1-04
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  inspectClaim,
  listCommitments,
  linkClaimEvidence,
  recordClaim,
  recordEvidenceItem,
  verifyCitation
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { evidenceWorker, importText } from "../support/evidence-fixtures.js";

test("e07s02 claim records retain supporting and challenging links", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s02-links");
    const capability = evidenceWorker(fixture.handle);
    const first = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s02-evidence-a", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id }, statementKind: "measured-finding", includeExcerpt: true
    });
    const second = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s02-evidence-b", sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: `${imported.locator.id.replace(/-1$/, "-2")}` }, statementKind: "inference", includeExcerpt: true
    });
    const claim = recordClaim(fixture.handle, capability, { commandId: "e07s02-claim", statement: "the source reports a result", scope: { population: "fixture" } });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s02-support", claimId: claim.id, evidenceItemId: first.id, role: "supporting" });
    linkClaimEvidence(fixture.handle, capability, { commandId: "e07s02-challenge", claimId: claim.id, evidenceItemId: second.id, role: "challenging" });
    const inspected = inspectClaim(fixture.handle, capability, claim.id);
    strictEqual(inspected.links.length, 2);
    strictEqual(inspected.claim.currentSupport, "contested");
    strictEqual(listCommitments(fixture.handle).length, 0);
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s02 citation identity stays separate from inaccessible and missing support", () => {
  const fixture = projectFixture();
  try {
    const limited = importText(fixture.handle, "e07s02-abstract", "abstract text\n", "abstract-only");
    const capability = evidenceWorker(fixture.handle);
    const limitedClaim = recordClaim(fixture.handle, capability, { commandId: "e07s02-limited-claim", statement: "a claim absent from the abstract" });
    const verification = verifyCitation(fixture.handle, capability, {
      commandId: "e07s02-limited-citation", claimId: limitedClaim.id, sourceVersionId: limited.result.artifactVersionId,
      bibliographic: { doi: "10.1234/example", title: "Example", year: 2024 }, abstractSupported: false
    });
    strictEqual(verification.identityStatus, "resolved");
    strictEqual(verification.accessStatus, "limited");
    strictEqual(verification.supportStatus, "unsupported");
    strictEqual(inspectClaim(fixture.handle, capability, limitedClaim.id).claim.currentSupport, "unsupported");
    const missing = importText(fixture.handle, "e07s02-missing");
    const missingClaim = recordClaim(fixture.handle, capability, { commandId: "e07s02-missing-claim", statement: "missing citation fields" });
    const missingVerification = verifyCitation(fixture.handle, capability, {
      commandId: "e07s02-missing-citation", claimId: missingClaim.id, sourceVersionId: missing.result.artifactVersionId,
      bibliographic: { title: "Only title" }
    });
    strictEqual(missingVerification.identityStatus, "fields-missing");
    strictEqual(Object.hasOwn(missingVerification.bibliographicFields, "doi"), false);
    throws(() => verifyCitation(fixture.handle, capability, {
      commandId: "e07s02-missing-citation", claimId: missingClaim.id, sourceVersionId: missing.result.artifactVersionId,
      bibliographic: { doi: "invented" }
    }));
    deepStrictEqual(listCommitments(fixture.handle), []);
  } finally {
    disposeFixture(fixture);
  }
});
