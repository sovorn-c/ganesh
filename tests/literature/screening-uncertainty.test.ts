// story: e08s03
// scenario: SC-e08s03-P0-01, SC-e08s03-P0-02, SC-e08s03-P1-03, SC-e08s03-P1-04
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  amendEligibility,
  createOwnerCapability,
  inspectScreeningCounts,
  listUncertaintyQueue,
  recordCorpusIdentity,
  recordScreeningDecision,
  resolveUncertainty
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { literatureWorker, protocolFixture } from "../support/literature-fixtures.js";

function owner(fixture: ReturnType<typeof projectFixture>) { return createOwnerCapability(fixture.handle.project.ownerId); }

test("e08s03 screening include exclude uncertain reopen amendment protocol version historical criterion uncertainty queue", () => {
  const fixture = projectFixture();
  try {
    const { protocol } = protocolFixture(fixture.handle);
    const worker = literatureWorker(fixture.handle);
    const corpusA = recordCorpusIdentity(fixture.handle, owner(fixture), { commandId: "screen-corpus-a", protocolVersionId: protocol.id, bibliographicIdentity: { doi: "10.2/a" } });
    const corpusB = recordCorpusIdentity(fixture.handle, owner(fixture), { commandId: "screen-corpus-b", protocolVersionId: protocol.id, bibliographicIdentity: { doi: "10.2/b" } });
    recordScreeningDecision(fixture.handle, worker, { commandId: "screen-a", corpusRecordId: corpusA.id, protocolVersionId: protocol.id, criterionId: "design", decision: "include", reason: "controlled design" });
    recordScreeningDecision(fixture.handle, worker, { commandId: "screen-b", corpusRecordId: corpusB.id, protocolVersionId: protocol.id, criterionId: "design", decision: "uncertain", reason: "abstract is incomplete" });
    strictEqual(listUncertaintyQueue(fixture.handle, worker, "open").length, 1);
    const amended = amendEligibility(fixture.handle, worker, { commandId: "screen-amendment", fromProtocolVersionId: protocol.id, eligibility: { population: "researchers", design: "controlled", setting: "field" }, rationale: "field setting is material", versionLabel: "v2" });
    const resolved = resolveUncertainty(fixture.handle, worker, { commandId: "screen-b-resolve", corpusRecordId: corpusB.id, protocolVersionId: amended.toProtocolVersionId, criterionId: "design", decision: "exclude", reason: "field setting is outside v2" });
    strictEqual(resolved.supersededByDecisionId, undefined);
    strictEqual(listUncertaintyQueue(fixture.handle, worker, "open").length, 0);
    deepStrictEqual(inspectScreeningCounts(fixture.handle, worker, protocol.id), { included: 1, excluded: 0, uncertain: 1 });
    strictEqual(inspectScreeningCounts(fixture.handle, worker, amended.toProtocolVersionId).excluded, 1);
  } finally { disposeFixture(fixture); }
});

test("e08s03 unjustified-threshold saturation paper-count descriptive counts and unrelated exclusions", () => {
  const fixture = projectFixture();
  try {
    const { protocol } = protocolFixture(fixture.handle);
    const corpus = recordCorpusIdentity(fixture.handle, owner(fixture), { commandId: "screen-threshold-corpus", protocolVersionId: protocol.id, bibliographicIdentity: { title: "Threshold" } });
    const worker = literatureWorker(fixture.handle);
    throws(() => recordScreeningDecision(fixture.handle, worker, { commandId: "screen-threshold", corpusRecordId: corpus.id, protocolVersionId: protocol.id, criterionId: "design", decision: "include", reason: "all papers", saturated: true }));
    strictEqual(inspectScreeningCounts(fixture.handle, worker, protocol.id).included, 0);
  } finally { disposeFixture(fixture); }
});
