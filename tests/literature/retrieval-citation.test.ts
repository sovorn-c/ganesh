// story: e08s02
// scenario: SC-e08s02-P0-01, SC-e08s02-P0-02, SC-e08s02-P1-03, SC-e08s02-P1-04
import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability,
  exploreCitations,
  getCorpusSnapshot,
  getSearchEvent,
  listCitationEdges,
  listCorpusSnapshots,
  recordQueryVersion,
  runAuthorizedRetrieval
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { literatureWorker, protocolFixture } from "../support/literature-fixtures.js";

test("e08s02 provider cap failed page inaccessible revised query search event snapshot replay", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const worker = literatureWorker(fixture.handle);
    let calls = 0;
    const event = await runAuthorizedRetrieval(fixture.handle, worker, {
      commandId: "literature-search", queryVersionId: query.id,
      adapter: { retrieve: () => { calls += 1; return { status: "complete", hits: [{ bibliographicIdentity: { doi: "10.1/a", title: "A" } }], failedPages: [{ kind: "page-failure", reason: "page unavailable" }], inaccessibleSources: [{ kind: "paywall", reason: "access unavailable" }] }; } }
    });
    strictEqual(calls, 1);
    strictEqual(event.protocolVersionId, protocol.id);
    strictEqual(event.coverageLimits.length, 2);
    const snapshot = listCorpusSnapshots(fixture.handle, worker, event.id)[0];
    if (!snapshot) { throw new Error("snapshot was not retained"); }
    strictEqual(getCorpusSnapshot(fixture.handle, worker, snapshot.id).corpusRecordIds.length, 1);
    strictEqual((await runAuthorizedRetrieval(fixture.handle, worker, {
      commandId: "literature-search", queryVersionId: query.id,
      adapter: { retrieve: () => { throw new Error("retry must not call adapter"); } }
    })).id, event.id);
    deepStrictEqual(getSearchEvent(fixture.handle, worker, event.id).coverageLimits.map((item) => item.kind), ["page-failure", "paywall"]);
  } finally { fixture.handle.close(); disposeFixture(fixture); }
});

test("e08s02 local-only remote paywall disclosure inaccessible citation bibliographic regression is bounded", async () => {
  const fixture = projectFixture();
  try {
    const { protocol, query: localQuery } = protocolFixture(fixture.handle);
    const remoteQuery = recordQueryVersion(fixture.handle, createOwnerCapability(fixture.handle.project.ownerId), {
      commandId: "literature-remote-query", protocolVersionId: protocol.id, expression: "remote", destination: "https://example.test", purpose: "remote search"
    });
    const worker = literatureWorker(fixture.handle);
    await rejects(runAuthorizedRetrieval(fixture.handle, worker, { commandId: "literature-remote-search", queryVersionId: remoteQuery.id, adapter: { retrieve: () => ({ hits: [] }) } }));
    const event = await runAuthorizedRetrieval(fixture.handle, worker, {
      commandId: "literature-local-citation", queryVersionId: localQuery.id,
      adapter: { retrieve: () => ({ hits: [
        { bibliographicIdentity: { doi: "10.1/from", title: "From" } },
        { bibliographicIdentity: { doi: "10.1/to", title: "To" } }
      ] }) }
    });
    const snapshot = listCorpusSnapshots(fixture.handle, worker, event.id)[0];
    if (!snapshot) { throw new Error("missing citation snapshot"); }
    const [from, to] = snapshot.corpusRecordIds;
    const edges = exploreCitations(fixture.handle, worker, { commandId: "literature-citations", protocolVersionId: protocol.id, edges: [{ fromRecordId: from!, toRecordId: to!, relation: "cites" }] });
    strictEqual(edges.length, 1);
    strictEqual(listCitationEdges(fixture.handle, worker, protocol.id).length, 1);
  } finally { fixture.handle.close(); disposeFixture(fixture); }
});
