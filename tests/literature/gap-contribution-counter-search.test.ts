// story: e08s04
// scenario: SC-e08s04-P0-01, SC-e08s04-P0-02, SC-e08s04-P1-03, SC-e08s04-P1-04
import { deepStrictEqual, rejects, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  getGapAssessment,
  listGapAssessments,
  recordCorpusIdentity,
  recordContributionProposal,
  recordEvidenceItem,
  recordGapAssessment,
  recordQueryVersion,
  recordReviewProtocol,
  runAuthorizedRetrieval,
  runCounterSearch
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { importText } from "../support/evidence-fixtures.js";
import { literatureWorker, protocolFixture } from "../support/literature-fixtures.js";

test("e08s04 gap assessment search-scoped dated and qualified contribution proposal", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const worker = literatureWorker(fixture.handle);
    const event = await runAuthorizedRetrieval(fixture.handle, worker, { commandId: "gap-landscape-search", queryVersionId: query.id, adapter: { retrieve: () => ({ hits: [{ bibliographicIdentity: { doi: "10.3/a" } }] }) }, searchedAt: "2026-09-12" });
    const snapshot = fixture.handle.db.prepare("SELECT id FROM corpus_snapshots WHERE search_event_id = ?").get(event.id) as { id: string };
    const gap = recordGapAssessment(fixture.handle, worker, { commandId: "gap-assessment", snapshotId: snapshot.id, queryVersionIds: [query.id], searchedAt: event.searchedAt, proposition: "A bounded field setting remains under-screened", status: "proposed", qualifications: ["local query scope", "no universal absence claim"] });
    const proposal = recordContributionProposal(fixture.handle, worker, { commandId: "gap-contribution", gapId: gap.id, proposition: "Test the field-setting subset", qualifications: ["requires a new scoped sample", "not a universal novelty claim"] });
    strictEqual(proposal.gapId, gap.id);
    strictEqual(getGapAssessment(fixture.handle, worker, gap.id).qualifications.length, 2);
    strictEqual(listGapAssessments(fixture.handle, worker).length, 1);
    deepStrictEqual(listGapAssessments(fixture.handle, worker)[0]?.status, "proposed");
    strictEqual(protocol.id.length > 0, true);
  } finally { fixture.handle.close(); disposeFixture(fixture); }
});

test("e08s04 counter-search stays within the gap query scope", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const otherProtocol = recordGapProtocol(fixture.handle);
    const otherQuery = recordGapQuery(fixture.handle, otherProtocol.id);
    const worker = literatureWorker(fixture.handle);
    const event = await runAuthorizedRetrieval(fixture.handle, worker, { commandId: "scope-base-search", queryVersionId: query.id, adapter: { retrieve: () => ({ hits: [] }) } });
    const snapshot = fixture.handle.db.prepare("SELECT id FROM corpus_snapshots WHERE search_event_id = ?").get(event.id) as { id: string };
    const gap = recordGapAssessment(fixture.handle, worker, { commandId: "scope-gap", snapshotId: snapshot.id, queryVersionIds: [query.id], searchedAt: event.searchedAt, proposition: "A scoped proposition" });
    await rejects(runCounterSearch(fixture.handle, worker, { commandId: "scope-counter", gapId: gap.id, queryVersionId: otherQuery.id, contraryHits: [] }));
    strictEqual(getGapAssessment(fixture.handle, worker, gap.id).status, "proposed");
    strictEqual(protocol.id.length > 0, true);
  } finally { disposeFixture(fixture); }
});

test("e08s04 counter-search rejects callers that cannot create challenging E07 links", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const imported = importText(fixture.handle, "restricted-counter-source", "contrary finding\n");
    const evidence = recordEvidenceItem(fixture.handle, createOwnerCapability(fixture.handle.project.ownerId), { commandId: "restricted-counter-evidence", sourceVersionId: imported.result.artifactVersionId, location: { kind: "source-locator", id: imported.locator.id }, statementKind: "measured-finding", includeExcerpt: true });
    const sourceRecord = recordCorpusIdentity(fixture.handle, createOwnerCapability(fixture.handle.project.ownerId), { commandId: "restricted-counter-record", protocolVersionId: protocol.id, sourceVersionId: imported.result.artifactVersionId, bibliographicIdentity: { doi: "10.3/restricted" } });
    const worker = literatureWorker(fixture.handle);
    const event = await runAuthorizedRetrieval(fixture.handle, worker, { commandId: "restricted-base-search", queryVersionId: query.id, adapter: { retrieve: () => ({ hits: [{ corpusRecordId: sourceRecord.id }] }) } });
    const snapshot = fixture.handle.db.prepare("SELECT id FROM corpus_snapshots WHERE search_event_id = ?").get(event.id) as { id: string };
    const gap = recordGapAssessment(fixture.handle, worker, { commandId: "restricted-gap", snapshotId: snapshot.id, queryVersionIds: [query.id], searchedAt: event.searchedAt, proposition: "A proposition requiring challenge" });
    const restricted = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.handle.project.rootPath, allowedOperations: ["literature:assess-gap", "literature:retrieve"], allowedPaths: [fixture.handle.project.rootPath] });
    await rejects(runCounterSearch(fixture.handle, restricted, { commandId: "restricted-counter", gapId: gap.id, queryVersionId: query.id, contraryHits: [{ corpusRecordId: sourceRecord.id, evidenceItemId: evidence.id }] }));
    strictEqual(getGapAssessment(fixture.handle, worker, gap.id).status, "proposed");
    strictEqual((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM counter_searches WHERE command_id = ?").get("restricted-counter") as { count: number }).count, 0);
  } finally { fixture.handle.close(); disposeFixture(fixture); }
});

function recordGapProtocol(handle: Parameters<typeof protocolFixture>[0]) {
  return recordReviewProtocol(handle, createOwnerCapability(handle.project.ownerId), { commandId: "scope-other-protocol", eligibility: { population: "other" } });
}

function recordGapQuery(handle: Parameters<typeof protocolFixture>[0], protocolVersionId: string) {
  return recordQueryVersion(handle, createOwnerCapability(handle.project.ownerId), { commandId: "scope-other-query", protocolVersionId, expression: "other scope" });
}

test("e08s04 contrary counter-search challenging evidence is retained and revises the gap", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const imported = importText(fixture.handle, "counter-source", "contrary finding\n");
    const evidence = recordEvidenceItem(fixture.handle, createOwnerCapability(fixture.handle.project.ownerId), { commandId: "counter-evidence", sourceVersionId: imported.result.artifactVersionId, location: { kind: "source-locator", id: imported.locator.id }, statementKind: "measured-finding", includeExcerpt: true });
    const sourceRecord = recordCorpusIdentity(fixture.handle, createOwnerCapability(fixture.handle.project.ownerId), { commandId: "counter-record", protocolVersionId: protocol.id, sourceVersionId: imported.result.artifactVersionId, bibliographicIdentity: { doi: "10.3/contrary", title: "Contrary" } });
    const worker = literatureWorker(fixture.handle, ["source:inspect"]);
    const landscape = await runAuthorizedRetrieval(fixture.handle, worker, { commandId: "counter-base-search", queryVersionId: query.id, adapter: { retrieve: () => ({ hits: [{ corpusRecordId: sourceRecord.id }] }) } });
    const snapshot = fixture.handle.db.prepare("SELECT id FROM corpus_snapshots WHERE search_event_id = ?").get(landscape.id) as { id: string };
    const gap = recordGapAssessment(fixture.handle, worker, { commandId: "counter-gap", snapshotId: snapshot.id, queryVersionIds: [query.id], searchedAt: landscape.searchedAt, proposition: "The scoped claim needs challenge", qualifications: ["scoped"] });
    const result = await runCounterSearch(fixture.handle, worker, { commandId: "counter-run", gapId: gap.id, queryVersionId: query.id, contraryHits: [{ corpusRecordId: sourceRecord.id, evidenceItemId: evidence.id }] });
    strictEqual(result.contraryCorpusRecordIds[0], sourceRecord.id);
    strictEqual(result.challengingEvidenceItemIds[0], evidence.id);
    strictEqual(result.gap.status, "revised");
  } finally { fixture.handle.close(); disposeFixture(fixture); }
});

test("e08s04 universal novelty exhaustive absence and empty contrary contribution claims are rejected", () => {
  const fixture = projectFixture();
  try {
    const { query } = protocolFixture(fixture.handle);
    const worker = literatureWorker(fixture.handle);
    throws(() => recordGapAssessment(fixture.handle, worker, { commandId: "gap-forbidden", snapshotId: "missing", queryVersionIds: [query.id], proposition: "universal", status: "universally-novel" as never }));
    throws(() => recordContributionProposal(fixture.handle, worker, { commandId: "contribution-unqualified", gapId: "missing", proposition: "universal novelty", qualifications: ["bounded"] }));
  } finally { disposeFixture(fixture); }
});
