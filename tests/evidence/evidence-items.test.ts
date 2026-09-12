// story: e07s01
// scenario: SC-e07s01-P0-01, SC-e07s01-P0-02, SC-e07s01-P0-03, SC-e07s01-P1-04
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability,
  ingestEvidenceCandidate,
  inspectEvidenceOperation,
  listEvidenceItems,
  openProject,
  readLocatedExcerpt,
  recordEvidenceItem,
  type ProjectHandle
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { evidenceWorker, importText } from "../support/evidence-fixtures.js";

function owner(handle: ProjectHandle) { return createOwnerCapability(handle.project.ownerId); }

test("e07s01 schema and located evidence items survive reopen with exact excerpts", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s01-source", "alpha\nbeta\n");
    const capability = owner(fixture.handle);
    const item = recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s01-evidence",
      sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id },
      statementKind: "author-claim",
      includeExcerpt: true
    });
    strictEqual(item.excerpt, "alpha");
    strictEqual(inspectEvidenceOperation(fixture.handle, "e07s01-evidence").status, "complete");
    strictEqual(recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s01-evidence",
      sourceVersionId: imported.result.artifactVersionId,
      location: { kind: "source-locator", id: imported.locator.id },
      statementKind: "author-claim",
      includeExcerpt: true
    }).id, item.id);
    fixture.handle.close();
    const reopened = openProject(fixture.root);
    strictEqual(listEvidenceItems(reopened, owner(reopened))[0]?.excerpt, "alpha");
    reopened.close();
  } finally {
    disposeFixture(fixture);
  }
});

test("e07s01 statement kinds, specialist origin and denied quotation paths stay bounded", () => {
  const fixture = projectFixture();
  try {
    const imported = importText(fixture.handle, "e07s01-kinds", "alpha\nbeta\n");
    const capability = owner(fixture.handle);
    const kinds = ["author-claim", "measured-finding", "inference", "human-interpretation"] as const;
    for (const [index, statementKind] of kinds.entries()) {
      recordEvidenceItem(fixture.handle, capability, {
        commandId: `e07s01-kind-${index}`,
        sourceVersionId: imported.result.artifactVersionId,
        location: { kind: "source-locator", id: imported.locator.id }, statementKind
      });
    }
    const candidate = ingestEvidenceCandidate(fixture.handle, evidenceWorker(fixture.handle), {
      commandId: "e07s01-candidate",
      candidate: { sourceVersionId: imported.result.artifactVersionId, locationRef: { kind: "source-locator", id: imported.locator.id }, statementKind: "inference", includeExcerpt: true }
    });
    strictEqual(candidate.origin, "specialist-proposed");
    const limited = importText(fixture.handle, "e07s01-limited", "not a quotation\n", "metadata-only");
    throws(() => recordEvidenceItem(fixture.handle, capability, {
      commandId: "e07s01-limited-quote", sourceVersionId: limited.result.artifactVersionId,
      location: { kind: "source-locator", id: limited.locator.id }, statementKind: "author-claim", includeExcerpt: true
    }));
    strictEqual(inspectEvidenceOperation(fixture.handle, "e07s01-limited-quote").status, "failed");
    deepStrictEqual(readLocatedExcerpt(fixture.handle, evidenceWorker(fixture.handle, ["evidence:record"]), {
      sourceVersionId: imported.result.artifactVersionId, location: { kind: "source-locator", id: imported.locator.id }
    }).status, "denied");
  } finally {
    disposeFixture(fixture);
  }
});
