// story: e06s04
import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getSourceVersion, listSourceRecords } from "./source-store.js";

export type SourceMatchRelation = "exact-duplicate" | "related-version" | "possible-match";

export interface SourceMatchProposal {
  readonly id: string;
  readonly leftVersionId: string;
  readonly rightVersionId: string;
  readonly relation: SourceMatchRelation;
  readonly basis: Record<string, unknown>;
  readonly score: number;
  readonly status: "proposed" | "accepted" | "rejected";
  readonly createdAt: string;
}

export interface SourceRelationshipRequest {
  readonly leftVersionId: string;
  readonly rightVersionId: string;
  readonly relation: "exact-duplicate" | "related-version";
  readonly basis: Record<string, unknown>;
  readonly actor: string;
}

export interface SourceRelationship {
  readonly id: string;
  readonly leftVersionId: string;
  readonly rightVersionId: string;
  readonly relation: "exact-duplicate" | "related-version";
  readonly basis: Record<string, unknown>;
  readonly actor: string;
  readonly createdAt: string;
}

interface SourceIdentity {
  readonly sourceVersionId: string;
  readonly contentHash?: string;
  readonly doi?: string;
  readonly title?: string;
  readonly authors: readonly string[];
  readonly year?: number;
  readonly locators: readonly Record<string, unknown>[];
}

function canonicalDoi(value: string): string | undefined {
  const candidate = value.trim().replace(/^doi:\s*/iu, "").replace(/^https?:\/\/(?:dx\.)?doi\.org\//iu, "");
  let decoded: string;
  try {
    decoded = decodeURIComponent(candidate).normalize("NFC").toLowerCase();
  } catch {
    return undefined;
  }
  return /^10\.\d{4,9}\/\S+$/u.test(decoded) && !/[\s\u0000-\u001f]/u.test(decoded) ? decoded : undefined;
}

function normalized(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

function authorFamily(value: string): string {
  const parts = normalized(value).split(" ").filter(Boolean);
  return parts.length === 0 ? "" : parts.length > 1 && value.includes(",") ? parts[0] : parts[parts.length - 1];
}

function identity(handle: ProjectHandle, sourceVersionId: string): SourceIdentity {
  getSourceVersion(handle, sourceVersionId);
  const artifact = inspectArtifactVersion(handle, sourceVersionId);
  const records = listSourceRecords(handle, sourceVersionId, "bibliographic");
  const fields = records.flatMap((record) => {
    const data = record.data as Record<string, unknown>;
    return [data.rawFields as Record<string, unknown> | undefined, data.normalizedIdentifiers as Record<string, unknown> | undefined];
  }).filter((record): record is Record<string, unknown> => record !== undefined);
  const find = (...names: string[]): string | undefined => {
    for (const field of fields) {
      for (const name of names) {
        const value = field[name] ?? field[name.toLowerCase()] ?? field[name.toUpperCase()];
        if (typeof value === "string" && value !== "") {return value;}
      }
    }
    return undefined;
  };
  const authorText = fields.flatMap((field) => namesFrom(field, "author", "AU")).join("\n");
  const authors = authorText.split(/[\n;]+/u).map(authorFamily).filter(Boolean);
  const yearText = find("year", "PY", "date") ?? "";
  const year = /\b(\d{4})\b/u.exec(yearText)?.[1];
  return {
    sourceVersionId,
    ...(artifact.contentHash === null ? {} : { contentHash: artifact.contentHash }),
    ...(canonicalDoi(find("doi", "DOI", "DO" ) ?? "") === undefined ? {} : { doi: canonicalDoi(find("doi", "DOI", "DO") ?? "") }),
    ...(find("title", "TI") === undefined ? {} : { title: normalized(find("title", "TI") ?? "") }),
    authors,
    ...(year === undefined ? {} : { year: Number(year) }),
    locators: records.map((record) => record.locator as Record<string, unknown>)
  };
}

function namesFrom(field: Record<string, unknown>, ...names: string[]): string[] {
  for (const name of names) {
    const value = field[name] ?? field[name.toLowerCase()] ?? field[name.toUpperCase()];
    if (typeof value === "string") {return value.split(/\n/gu);}
  }
  return [];
}

function tokenScore(left: string, right: string): number {
  const leftTokens = new Set(left.split(" ").filter(Boolean));
  const rightTokens = new Set(right.split(" ").filter(Boolean));
  const union = new Set([...leftTokens, ...rightTokens]);
  if (union.size === 0) {return 0;}
  return [...leftTokens].filter((token) => rightTokens.has(token)).length / union.size;
}

function proposalFromRow(row: Record<string, unknown>): SourceMatchProposal {
  return {
    id: String(row.id),
    leftVersionId: String(row.left_version_id),
    rightVersionId: String(row.right_version_id),
    relation: String(row.relation) as SourceMatchRelation,
    basis: JSON.parse(String(row.basis)) as Record<string, unknown>,
    score: Number(row.score),
    status: String(row.status) as SourceMatchProposal["status"],
    createdAt: String(row.created_at)
  };
}

function persistProposal(handle: ProjectHandle, left: string, right: string, relation: SourceMatchRelation, basis: Record<string, unknown>, score: number): SourceMatchProposal {
  const existing = handle.db.prepare("SELECT * FROM source_match_proposals WHERE left_version_id = ? AND right_version_id = ? AND basis = ?").get(left, right, JSON.stringify(basis)) as Record<string, unknown> | undefined;
  if (existing !== undefined) {return proposalFromRow(existing);}
  const proposal: SourceMatchProposal = { id: newId("match"), leftVersionId: left, rightVersionId: right, relation, basis, score, status: "proposed", createdAt: isoNow() };
  handle.db.prepare("INSERT INTO source_match_proposals (id, left_version_id, right_version_id, relation, basis, score, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(proposal.id, left, right, relation, JSON.stringify(basis), score, proposal.status, proposal.createdAt);
  return proposal;
}

export function proposeSourceMatches(handle: ProjectHandle, sourceVersionId: string, maxCandidates = 1000): readonly SourceMatchProposal[] {
  if (!Number.isInteger(maxCandidates) || maxCandidates < 0 || maxCandidates > 10_000) {
    throw new ProjectStoreError("invalid-limit", "maxCandidates must be an integer from 0 through 10000");
  }
  const left = identity(handle, sourceVersionId);
  const ids = (handle.db.prepare("SELECT artifact_version_id FROM source_versions WHERE artifact_version_id != ? ORDER BY artifact_version_id LIMIT ?").all(sourceVersionId, maxCandidates) as Array<Record<string, unknown>>).map((row) => String(row.artifact_version_id));
  const proposals: SourceMatchProposal[] = [];
  for (const rightId of ids) {
    const right = identity(handle, rightId);
    let proposal: { relation: SourceMatchRelation; basis: Record<string, unknown>; score: number } | undefined;
    if (left.contentHash !== undefined && left.contentHash === right.contentHash) {
      proposal = { relation: "exact-duplicate", basis: { algorithm: "content-hash-v1", leftHash: left.contentHash, rightHash: right.contentHash }, score: 1 };
    } else if (left.doi !== undefined && left.doi === right.doi) {
      proposal = { relation: "exact-duplicate", basis: { algorithm: "doi-v1", canonicalIdentifier: left.doi, leftLocators: left.locators, rightLocators: right.locators }, score: 1 };
    } else if (left.title !== undefined && right.title !== undefined && left.year !== undefined && right.year !== undefined && Math.abs(left.year - right.year) <= 1) {
      const titleScore = tokenScore(left.title, right.title);
      const authorOverlap = left.authors.some((author) => right.authors.includes(author));
      if (titleScore >= 0.9 && authorOverlap) {
        proposal = { relation: "possible-match", basis: { algorithm: "title-author-year-v1", titleJaccard: titleScore, yearDistance: Math.abs(left.year - right.year), authorOverlap: true, leftLocators: left.locators, rightLocators: right.locators }, score: titleScore };
      }
    }
    if (proposal !== undefined) {proposals.push(persistProposal(handle, sourceVersionId, rightId, proposal.relation, proposal.basis, proposal.score));}
  }
  return proposals.sort((a, b) => relationRank(a.relation) - relationRank(b.relation) || b.score - a.score || a.rightVersionId.localeCompare(b.rightVersionId));
}

function relationRank(relation: SourceMatchRelation): number {
  return relation === "exact-duplicate" ? 0 : relation === "related-version" ? 1 : 2;
}

function authorizeRelationship(handle: ProjectHandle, capability: unknown): void {
  if (isOwnerCapability(capability) && capability.ownerId === handle.project.ownerId) {return;}
  if (isWorkerCapability(capability) && capability.projectId === handle.project.id && capability.canPerform("source:inspect")) {return;}
  throw new ProjectStoreError("forbidden", "source relationship requires a matching project capability");
}

export function recordSourceRelationship(handle: ProjectHandle, capability: unknown, request: SourceRelationshipRequest): SourceRelationship {
  assertWritable(handle);
  authorizeRelationship(handle, capability);
  getSourceVersion(handle, request.leftVersionId);
  getSourceVersion(handle, request.rightVersionId);
  if (request.leftVersionId === request.rightVersionId) {throw new ProjectStoreError("invalid-relationship", "a source cannot relate to itself");}
  const existing = handle.db.prepare("SELECT * FROM source_relationships WHERE left_version_id = ? AND right_version_id = ? AND relation = ?").get(request.leftVersionId, request.rightVersionId, request.relation) as Record<string, unknown> | undefined;
  if (existing !== undefined) {return { id: String(existing.id), leftVersionId: String(existing.left_version_id), rightVersionId: String(existing.right_version_id), relation: String(existing.relation) as SourceRelationship["relation"], basis: JSON.parse(String(existing.basis)) as Record<string, unknown>, actor: String(existing.actor), createdAt: String(existing.created_at) };}
  const relationship: SourceRelationship = { id: newId("relationship"), leftVersionId: request.leftVersionId, rightVersionId: request.rightVersionId, relation: request.relation, basis: request.basis, actor: request.actor.slice(0, 120), createdAt: isoNow() };
  handle.db.prepare("INSERT INTO source_relationships (id, left_version_id, right_version_id, relation, basis, actor, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").run(relationship.id, relationship.leftVersionId, relationship.rightVersionId, relationship.relation, JSON.stringify(relationship.basis), relationship.actor, relationship.createdAt);
  return relationship;
}
