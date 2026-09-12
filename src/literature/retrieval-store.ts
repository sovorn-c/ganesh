import { requestDisclosure } from "../policy/disclosure-gateway.js";
import { listBibliographicRecords } from "../sources/structured-parser.js";
import { transaction } from "../persistence/schema.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getQueryVersion, getReviewProtocol } from "./literature-store.js";
import { LocalRecordingAdapter } from "./retrieval-adapter.js";
import type {
  CitationEdge, CitationExplorationRequest, CorpusRecord, CorpusSnapshot, CoverageLimit, LiteratureRetrievalAdapter,
  QueryVersion, RetrievalHit, RetrievalReport, RetrievalRequest, ReviewProtocol, SearchEvent
} from "./literature-types.js";
import { allowed, assertLiteratureSchema, beginOperation, completeOperation, json, parse, payloadHash, recordId, requireCapability, requireCommand, text } from "./literature-utils.js";

function eventRow(row: Record<string, unknown>): SearchEvent {
  const rerun = typeof row.live_rerun_of === "string" ? row.live_rerun_of : undefined;
  const adapter = typeof row.adapter_code === "string" ? row.adapter_code : undefined;
  return { id: text(row, "id"), protocolVersionId: text(row, "protocol_version_id"), queryVersionId: text(row, "query_version_id"), searchedAt: text(row, "searched_at"), destination: text(row, "destination"), purpose: text(row, "purpose"), status: text(row, "status") as SearchEvent["status"], ...(rerun ? { liveRerunOf: rerun } : {}), coverageLimits: parse(row.coverage_limits, []), ...(adapter ? { adapterCode: adapter } : {}), createdAt: text(row, "created_at") };
}
function snapshotRow(row: Record<string, unknown>): CorpusSnapshot { return { id: text(row, "id"), searchEventId: text(row, "search_event_id"), corpusRecordIds: parse(row.corpus_record_ids, []), createdAt: text(row, "created_at") }; }
function corpusRow(row: Record<string, unknown>): CorpusRecord {
  const source = typeof row.source_version_id === "string" ? row.source_version_id : undefined;
  return { id: text(row, "id"), protocolVersionId: text(row, "protocol_version_id"), ...(source ? { sourceVersionId: source } : {}), bibliographicIdentity: parse(row.bibliographic_identity, {}), origin: text(row, "origin") as CorpusRecord["origin"], createdAt: text(row, "created_at") };
}
function edgeRow(row: Record<string, unknown>): CitationEdge { return { id: text(row, "id"), fromRecordId: text(row, "from_record_id"), toRecordId: text(row, "to_record_id"), relation: text(row, "relation") as CitationEdge["relation"], createdAt: text(row, "created_at") }; }
function row(handle: ProjectHandle, table: string, id: string): Record<string, unknown> { const found = handle.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as Record<string, unknown> | undefined; if (!found) {throw new ProjectStoreError("literature-not-found", `${table} record was not found`);} return found; }
function queryAndProtocol(handle: ProjectHandle, capability: unknown, queryId: string): { query: QueryVersion; protocol: ReviewProtocol } { const query = getQueryVersion(handle, capability, queryId); return { query, protocol: getReviewProtocol(handle, capability, query.protocolVersionId) }; }
function limits(report: RetrievalReport, queryVersionId: string): CoverageLimit[] {
  const all = [...(report.coverageLimits ?? []), ...(report.providerCaps ?? []), ...(report.failedPages ?? []), ...(report.inaccessibleSources ?? [])];
  return all.map((limit) => ({ ...limit, queryVersionId: limit.queryVersionId ?? queryVersionId, reason: limit.reason || "unspecified coverage limit" }));
}
function identityKey(identity: Record<string, unknown>): string { return String(identity.doi ?? identity.DOI ?? identity.title ?? identity.id ?? JSON.stringify(identity)); }
function hitRecords(handle: ProjectHandle, protocolId: string, hits: readonly RetrievalHit[]): string[] {
  const ids: string[] = [];
  for (const hit of hits) {
    if (hit.corpusRecordId) {
      const existing = row(handle, "corpus_records", hit.corpusRecordId);
      if (text(existing, "protocol_version_id") !== protocolId) {throw new ProjectStoreError("project-isolation", "retrieval hit belongs to another protocol");}
      ids.push(hit.corpusRecordId); continue;
    }
    const identity = hit.bibliographicIdentity;
    if (!identity || Object.keys(identity).length === 0) {continue;}
    const existingRows = handle.db.prepare("SELECT * FROM corpus_records WHERE protocol_version_id = ?").all(protocolId) as Array<Record<string, unknown>>;
    const existing = existingRows.find((candidate) => identityKey(parse(candidate.bibliographic_identity, {})) === identityKey(identity));
    if (existing) { ids.push(text(existing, "id")); continue; }
    const id = newId("corpus");
    handle.db.prepare("INSERT INTO corpus_records (id, protocol_version_id, source_version_id, bibliographic_identity, origin, created_at) VALUES (?, ?, ?, ?, 'retrieval', ?)").run(id, protocolId, hit.sourceVersionId ?? null, json(identity), isoNow());
    ids.push(id);
  }
  return [...new Set(ids)];
}
async function reportFor(adapter: LiteratureRetrievalAdapter, query: QueryVersion, protocol: ReviewProtocol): Promise<RetrievalReport> { return await adapter.retrieve({ query, protocol }); }

export async function runAuthorizedRetrieval(handle: ProjectHandle, capability: unknown, request: RetrievalRequest): Promise<SearchEvent> {
  assertLiteratureSchema(handle); if (!allowed(handle, capability, ["literature:retrieve"]) && !allowed(handle, capability, ["literature:assess-gap"])) {throw new ProjectStoreError("forbidden", "retrieval requires a literature retrieval capability");}
  const commandId = requireCommand(request.commandId); const { query, protocol } = queryAndProtocol(handle, capability, request.queryVersionId);
  const payload = { queryVersionId: query.id, searchedAt: request.searchedAt, liveRerunOfSearchEventId: request.liveRerunOfSearchEventId };
  const existing = beginOperation(handle, commandId, payloadHash(payload));
  if (existing?.status === "complete") {return eventRow(row(handle, "search_events", existing.resultId!));}
  if (request.liveRerunOfSearchEventId) {row(handle, "search_events", request.liveRerunOfSearchEventId);}
  const disclosure = requestDisclosure(handle, { sourceVersions: [query.artifactVersionId], operation: "retrieval", destination: query.destination, purpose: query.purpose, actor: "literature-retrieval" });
  if (disclosure.status === "deny") { throw new ProjectStoreError("disclosure-denied", disclosure.reason); }
  const adapter = request.adapter ?? new LocalRecordingAdapter();
  const report = await reportFor(adapter, query, protocol);
  const searchedAt = request.searchedAt ?? isoNow(); const eventId = recordId("search-event");
  const coverage = limits(report, query.id); const status = report.status === "failed" ? "failed" : "complete";
  const recordIds = hitRecords(handle, protocol.id, report.hits ?? []); const snapshotId = recordId("snapshot"); const createdAt = isoNow();
  transaction(handle.db, () => {
    handle.db.prepare("INSERT INTO search_events (id, protocol_version_id, query_version_id, searched_at, destination, purpose, status, live_rerun_of, coverage_limits, adapter_code, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(eventId, protocol.id, query.id, searchedAt, query.destination, query.purpose, status, request.liveRerunOfSearchEventId ?? null, json(coverage), report.errorCode ?? null, commandId, createdAt);
    handle.db.prepare("INSERT INTO corpus_snapshots (id, search_event_id, corpus_record_ids, created_at) VALUES (?, ?, ?, ?)").run(snapshotId, eventId, json(recordIds), createdAt);
  });
  completeOperation(handle, commandId, eventId, "search-event");
  return eventRow(row(handle, "search_events", eventId));
}

export function getSearchEvent(handle: ProjectHandle, capability: unknown, id: string): SearchEvent { assertLiteratureSchema(handle); if (!allowed(handle, capability, ["literature:inspect"]) && !allowed(handle, capability, ["literature:retrieve"]) && !allowed(handle, capability, ["literature:assess-gap"])) {throw new ProjectStoreError("forbidden", "search inspection requires a literature capability");} return eventRow(row(handle, "search_events", id)); }
export function listSearchEvents(handle: ProjectHandle, capability: unknown): readonly SearchEvent[] { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "search inspection requires literature:inspect capability"); return (handle.db.prepare("SELECT * FROM search_events ORDER BY created_at, id").all() as Array<Record<string, unknown>>).map(eventRow); }
export function getCorpusSnapshot(handle: ProjectHandle, capability: unknown, id: string): CorpusSnapshot { assertLiteratureSchema(handle); if (!allowed(handle, capability, ["literature:inspect"]) && !allowed(handle, capability, ["literature:retrieve"]) && !allowed(handle, capability, ["literature:assess-gap"])) {throw new ProjectStoreError("forbidden", "snapshot inspection requires a literature capability");} return snapshotRow(row(handle, "corpus_snapshots", id)); }
export function listCorpusSnapshots(handle: ProjectHandle, capability: unknown, searchEventId?: string): readonly CorpusSnapshot[] { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "snapshot inspection requires literature:inspect capability"); const rows = (searchEventId === undefined ? handle.db.prepare("SELECT * FROM corpus_snapshots ORDER BY created_at, id").all() : handle.db.prepare("SELECT * FROM corpus_snapshots WHERE search_event_id = ? ORDER BY created_at, id").all(searchEventId)) as Array<Record<string, unknown>>; return rows.map(snapshotRow); }
export function replayCorpusSnapshot(handle: ProjectHandle, capability: unknown, snapshotId: string): CorpusSnapshot { return getCorpusSnapshot(handle, capability, snapshotId); }

export function exploreCitations(handle: ProjectHandle, capability: unknown, request: CitationExplorationRequest): readonly CitationEdge[] {
  assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:retrieve"], "citation exploration requires literature:retrieve capability");
  const commandId = requireCommand(request.commandId);
  const existing = beginOperation(handle, commandId, payloadHash(request));
  if (existing?.status === "complete") {return listCitationEdges(handle, capability, request.protocolVersionId);}
  const maxRecords = Math.min(Math.max(request.maxRecords ?? 100, 1), 1000);
  if ((request.maxHops ?? 1) !== 1) {throw new ProjectStoreError("citation-bound-exceeded", "citation exploration is bounded to one hop");}
  const protocolId = request.protocolVersionId;
  const sourceRecordIds: string[] = [];
  for (const sourceVersionId of request.sourceVersionIds ?? []) {
    for (const bibliographic of listBibliographicRecords(handle, sourceVersionId).slice(0, maxRecords)) {
      const identity = { ...bibliographic.normalizedIdentifiers, ...bibliographic.rawFields, entryKey: bibliographic.entryKey, recordNumber: bibliographic.recordNumber };
      const existing = (handle.db.prepare("SELECT * FROM corpus_records WHERE protocol_version_id = ?").all(protocolId) as Array<Record<string, unknown>>).find((candidate) => identityKey(parse(candidate.bibliographic_identity, {})) === identityKey(identity));
      if (existing) { sourceRecordIds.push(text(existing, "id")); continue; }
      const id = newId("corpus");
      handle.db.prepare("INSERT INTO corpus_records (id, protocol_version_id, source_version_id, bibliographic_identity, origin, created_at) VALUES (?, ?, ?, ?, 'retrieval', ?)").run(id, protocolId, sourceVersionId, json(identity), isoNow());
      sourceRecordIds.push(id);
    }
  }
  const records = (request.corpusRecordIds ?? [...sourceRecordIds, ...(handle.db.prepare("SELECT id FROM corpus_records WHERE protocol_version_id = ? ORDER BY created_at LIMIT ?").all(protocolId, maxRecords) as Array<{ id: string }>).map((item) => item.id)]).slice(0, maxRecords);
  const candidates = request.edges ?? []; const created: CitationEdge[] = [];
  transaction(handle.db, () => {
    for (const edge of candidates.slice(0, maxRecords)) {
      row(handle, "corpus_records", edge.fromRecordId); row(handle, "corpus_records", edge.toRecordId);
      const id = newId("citation");
      handle.db.prepare("INSERT OR IGNORE INTO citation_edges (id, from_record_id, to_record_id, relation, created_at) VALUES (?, ?, ?, ?, ?)").run(id, edge.fromRecordId, edge.toRecordId, edge.relation ?? "cites", isoNow());
    }
    for (const fromId of records) {
      const from = row(handle, "corpus_records", fromId); const identity = parse(from.bibliographic_identity, {}) as Record<string, unknown>;
      for (const ref of [...(Array.isArray(identity.cites) ? identity.cites : []), ...(Array.isArray(identity.citedBy) ? identity.citedBy : [])].slice(0, maxRecords)) {
        const targetKey = String(ref); const all = handle.db.prepare("SELECT * FROM corpus_records WHERE protocol_version_id = ?").all(protocolId) as Array<Record<string, unknown>>;
        const target = all.find((candidate) => identityKey(parse(candidate.bibliographic_identity, {})) === targetKey);
        if (!target) {continue;}
        const relation = Array.isArray(identity.cites) && identity.cites.includes(ref) ? "cites" : "cited-by";
        handle.db.prepare("INSERT OR IGNORE INTO citation_edges (id, from_record_id, to_record_id, relation, created_at) VALUES (?, ?, ?, ?, ?)").run(newId("citation"), fromId, text(target, "id"), relation, isoNow());
      }
    }
  });
  const rows = (handle.db.prepare("SELECT * FROM citation_edges WHERE from_record_id IN (SELECT id FROM corpus_records WHERE protocol_version_id = ?) ORDER BY created_at, id").all(protocolId) as Array<Record<string, unknown>>).map(edgeRow);
  completeOperation(handle, commandId, rows[0]?.id ?? newId("exploration"), "citation-exploration");
  return rows;
}

export function listCitationEdges(handle: ProjectHandle, capability: unknown, protocolVersionId?: string): readonly CitationEdge[] { assertLiteratureSchema(handle); requireCapability(handle, capability, ["literature:inspect"], "citation inspection requires literature:inspect capability"); const rows = (protocolVersionId === undefined ? handle.db.prepare("SELECT * FROM citation_edges ORDER BY created_at, id").all() : handle.db.prepare("SELECT e.* FROM citation_edges e JOIN corpus_records c ON c.id = e.from_record_id WHERE c.protocol_version_id = ? ORDER BY e.created_at, e.id").all(protocolVersionId)) as Array<Record<string, unknown>>; return rows.map(edgeRow); }
