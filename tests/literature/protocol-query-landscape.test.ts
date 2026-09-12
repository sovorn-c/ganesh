// story: e08s01
// scenario: SC-e08s01-P0-01, SC-e08s01-P0-02, SC-e08s01-P1-03, SC-e08s01-P1-04
import { deepStrictEqual, strictEqual, throws } from "node:assert";
import { test } from "node:test";
import {
  createOwnerCapability, createWorkerCapabilities, getLandscapeMap, listCorpusRecords, listQueryVersions, listReviewProtocols, recordCorpusIdentity,
  recordLandscapeMap, recordQueryVersion, recordReviewProtocol, openProject, type ProjectHandle
} from "../../src/index.js";
import { disposeFixture, projectFixture } from "../support/project-fixtures.js";
import { literatureWorker, protocolFixture } from "../support/literature-fixtures.js";

function owner(handle: ProjectHandle) { return createOwnerCapability(handle.project.ownerId); }

test("e08s01 review protocol, query version, landscape, corpus identity, reopen and retry are durable", () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const query2 = recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-query-amendment", protocolVersionId: protocol.id, parentQueryVersionId: query.id,
      supersedesQueryVersionId: query.id, expression: "researchers AND controlled AND replication", destination: "local", purpose: "counter-search"
    });
    const landscape = recordLandscapeMap(fixture.handle, owner(fixture.handle), {
      commandId: "literature-landscape", protocolVersionId: protocol.id, queryVersionIds: [query.id, query2.id],
      description: "A bounded local landscape", searchedAt: "2026-09-12"
    });
    const corpus = recordCorpusIdentity(fixture.handle, owner(fixture.handle), {
      commandId: "literature-corpus", protocolVersionId: protocol.id,
      bibliographicIdentity: { doi: "10.1234/example", title: "Example" }
    });
    strictEqual(getLandscapeMap(fixture.handle, owner(fixture.handle), landscape.id).queryVersionIds.length, 2);
    strictEqual(listReviewProtocols(fixture.handle, owner(fixture.handle)).length, 1);
    strictEqual(listQueryVersions(fixture.handle, owner(fixture.handle), protocol.id).length, 2);
    strictEqual(listCorpusRecords(fixture.handle, owner(fixture.handle), protocol.id)[0]?.id, corpus.id);
    const identifiedQuery = recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-query-id-retry", id: "query-one", protocolVersionId: protocol.id, expression: "identified query"
    });
    strictEqual(recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-query-id-retry", id: "query-one", protocolVersionId: protocol.id, expression: "identified query"
    }).id, identifiedQuery.id);
    throws(() => recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-query-id-retry", id: "query-two", protocolVersionId: protocol.id, expression: "identified query"
    }));
    const identifiedCorpus = recordCorpusIdentity(fixture.handle, owner(fixture.handle), {
      commandId: "literature-corpus-id-retry", id: "corpus-one", protocolVersionId: protocol.id, bibliographicIdentity: { title: "Identified" }
    });
    strictEqual(recordCorpusIdentity(fixture.handle, owner(fixture.handle), {
      commandId: "literature-corpus-id-retry", id: "corpus-one", protocolVersionId: protocol.id, bibliographicIdentity: { title: "Identified" }
    }).id, identifiedCorpus.id);
    throws(() => recordCorpusIdentity(fixture.handle, owner(fixture.handle), {
      commandId: "literature-corpus-id-retry", id: "corpus-two", protocolVersionId: protocol.id, bibliographicIdentity: { title: "Identified" }
    }));
    fixture.handle.close();
    const reopened = openProject(fixture.root);
    strictEqual(listReviewProtocols(reopened, owner(reopened))[0]?.id, protocol.id);
    reopened.close();
  } finally { disposeFixture(fixture); }
});

test("e08s01 query lineage stays within its protocol", () => {
  const fixture = projectFixture();
  try {
    const { protocol, query } = protocolFixture(fixture.handle);
    const otherProtocol = recordReviewProtocol(fixture.handle, owner(fixture.handle), {
      commandId: "literature-other-protocol", eligibility: { population: "other" }
    });
    throws(() => recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-cross-protocol-lineage", protocolVersionId: otherProtocol.id,
      parentQueryVersionId: query.id, expression: "cross protocol"
    }));
    throws(() => recordQueryVersion(fixture.handle, owner(fixture.handle), {
      commandId: "literature-cross-protocol-supersedes", protocolVersionId: otherProtocol.id,
      supersedesQueryVersionId: query.id, expression: "cross protocol"
    }));
    strictEqual(listQueryVersions(fixture.handle, owner(fixture.handle), otherProtocol.id).length, 0);
    strictEqual(protocol.id.length > 0, true);
  } finally { disposeFixture(fixture); }
});

test("e08s01 specialist corpus identity capability authority and payload retry are bounded", () => {
  const fixture = projectFixture();
  try {
    const worker = literatureWorker(fixture.handle);
    const missingOperation = createWorkerCapabilities({ projectId: fixture.handle.project.id, projectRoot: fixture.handle.project.rootPath, allowedOperations: ["literature:inspect"], allowedPaths: [fixture.handle.project.rootPath] });
    const wrongProject = createWorkerCapabilities({ projectId: "other-project", projectRoot: fixture.handle.project.rootPath, allowedOperations: ["literature:protocol"], allowedPaths: [fixture.handle.project.rootPath] });
    throws(() => recordReviewProtocol(fixture.handle, {}, { commandId: "literature-forged", eligibility: { population: "bounded" } }));
    throws(() => recordReviewProtocol(fixture.handle, wrongProject, { commandId: "literature-wrong-project", eligibility: { population: "bounded" } }));
    throws(() => recordReviewProtocol(fixture.handle, missingOperation, { commandId: "literature-missing-operation", eligibility: { population: "bounded" } }));
    const candidate = recordReviewProtocol(fixture.handle, worker, {
      commandId: "literature-specialist-protocol", eligibility: { population: "bounded" }, origin: "specialist-proposed"
    });
    strictEqual(candidate.origin, "specialist-proposed");
    const retry = recordReviewProtocol(fixture.handle, worker, {
      commandId: "literature-specialist-protocol", eligibility: { population: "bounded" }, origin: "specialist-proposed"
    });
    strictEqual(retry.id, candidate.id);
    throws(() => recordReviewProtocol(fixture.handle, worker, {
      commandId: "literature-specialist-protocol", eligibility: { population: "different" }, origin: "specialist-proposed"
    }));
    deepStrictEqual(listReviewProtocols(fixture.handle, worker).map((item) => item.origin), ["specialist-proposed"]);
  } finally { disposeFixture(fixture); }
});
