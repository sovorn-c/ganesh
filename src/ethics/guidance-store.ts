import { type ProjectHandle, ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { assertWritable } from "../project/project-store.js";
import { discardArtifactVersion, registerArtifactVersion } from "../artifacts/artifact-store.js";
import { transaction } from "../persistence/schema.js";
import {
  GuidanceCitation,
  GuidanceCitationRequest,
  GuidanceCurrency
} from "./ethics-types.js";
import {
  assertEthicsSchema,
  assertEthicsAccess,
  resolveAttribution,
  resolveOrigin,
  parseViewAttribution,
  parseEthicsOrigin,
  hashPayload,
  newId,
  isoNow,
  validateEvidenceVersionIds
} from "./ethics-utils.js";

const GUIDANCE_CURRENCIES: readonly GuidanceCurrency[] = ["unknown", "owner-reviewed-current", "superseded"];

const REFUSED_GENERIC_PATTERNS = [
  /generic-institutional-checklist/i,
  /covers-all-maori-communities/i,
  /ganesh-certified/i,
  /hdec-approved-by-software/i,
  /all m[āa]ori communities/i,
  /all institutions/i,
  /generic checklist/i,
  /blanket certification/i
];

export function assertNotGenericCertification(
  values: readonly (string | undefined)[]
): void {
  for (const val of values) {
    if (!val) {
      continue;
    }
    for (const pattern of REFUSED_GENERIC_PATTERNS) {
      if (pattern.test(val)) {
        throw new ProjectStoreError(
          "generic-certification-refused",
          `Generic certification claim is refused: "${val}" matches refused pattern`
        );
      }
    }
  }
}

export function recordGuidanceCitation(
  handle: ProjectHandle,
  capability: unknown,
  request: GuidanceCitationRequest
): GuidanceCitation {
  assertWritable(handle);
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:prepare");

  if (!request.publisher?.trim()) {
    throw new ProjectStoreError("invalid-argument", "publisher is required and must be non-empty");
  }
  if (!request.uri?.trim()) {
    throw new ProjectStoreError("invalid-argument", "uri is required and must be non-empty");
  }
  if (!request.retrievedAt?.trim()) {
    throw new ProjectStoreError("invalid-argument", "retrievedAt is required and must be non-empty");
  }
  if (Number.isNaN(Date.parse(request.retrievedAt))) {
    throw new ProjectStoreError("invalid-argument", "retrievedAt must be a valid timestamp");
  }
  if (!request.summary?.trim()) {
    throw new ProjectStoreError("invalid-argument", "summary is required and must be non-empty");
  }

  assertNotGenericCertification([
    request.title, request.publisher, request.uri, request.retrievedAt, request.summary,
    request.scopeNote, request.jurisdiction, request.topic
  ]);

  const evidenceVersionIds = validateEvidenceVersionIds(handle, request.evidenceVersionIds);
  let currency: GuidanceCurrency = "unknown";
  if (request.currency !== undefined) {
    if (!["unknown", "owner-reviewed-current", "superseded"].includes(request.currency)) {
      throw new ProjectStoreError("invalid-argument", "currency must be a supported guidance currency");
    }
    if (request.currency === "owner-reviewed-current") {
      if (!isOwnerCapability(capability)) {
        throw new ProjectStoreError("forbidden", "Worker capability cannot mark currency as owner-reviewed-current");
      }
      currency = "owner-reviewed-current";
    } else {
      currency = request.currency;
    }
  }

  const attribution = resolveAttribution(capability, request.attribution);
  const origin = resolveOrigin(capability, request.origin);
  const commandId = request.commandId ?? newId("cmd_citation");
  const payloadHash = hashPayload({
    publisher: request.publisher,
    uri: request.uri,
    retrievedAt: request.retrievedAt,
    summary: request.summary,
    scopeNote: request.scopeNote,
    title: request.title,
    jurisdiction: request.jurisdiction,
    topic: request.topic,
    evidenceVersionIds,
    currency,
    attribution,
    origin
  });

  const existingOp = handle.db
    .prepare("SELECT kind, entity_id, payload_hash, result_data FROM ethics_operations WHERE command_id = ?")
    .get(commandId) as { kind: string; payload_hash: string; entity_id: string; result_data: string } | undefined;

  if (existingOp) {
    if (existingOp.kind !== "guidance-citation" || existingOp.payload_hash !== payloadHash) {
      throw new ProjectStoreError("payload-conflict", `Command ${commandId} payload conflict`);
    }
    const row = handle.db.prepare("SELECT * FROM guidance_citations WHERE id = ?").get(existingOp.entity_id) as Record<string, unknown> | undefined;
    if (!row) {
      throw new ProjectStoreError("invalid-transition", "prior guidance operation has no recorded citation");
    }
    return mapCitationRow(row);
  }

  const id = newId("cite");
  const now = isoNow();
  const artifactContent = JSON.stringify({
    id, title: request.title ?? null, publisher: request.publisher, uri: request.uri, retrievedAt: request.retrievedAt,
    currency, summary: request.summary, scopeNote: request.scopeNote ?? null,
    jurisdiction: request.jurisdiction ?? null, topic: request.topic ?? null, evidenceVersionIds
  });

  const artifactVersion = registerArtifactVersion(handle, {
    logicalId: `guidance-citation-${id}`,
    version: "1.0",
    content: artifactContent,
    origin: "ethics-guidance",
    access: "metadata-only"
  });

  const citation: GuidanceCitation = {
    id,
    title: request.title,
    publisher: request.publisher,
    uri: request.uri,
    retrievedAt: request.retrievedAt,
    currency,
    summary: request.summary,
    scopeNote: request.scopeNote,
    jurisdiction: request.jurisdiction,
    topic: request.topic,
    evidenceVersionIds,
    attribution,
    origin,
    artifactVersionId: artifactVersion.id,
    commandId,
    createdAt: now,
    updatedAt: now
  };

  try {
    transaction(handle.db, () => {
      handle.db
        .prepare(
          `INSERT INTO guidance_citations (
            id, title, publisher, uri, retrieved_at, currency, summary, scope_note,
            jurisdiction, topic, evidence_version_ids, attribution, origin, artifact_version_id, command_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          citation.id, citation.title ?? null, citation.publisher, citation.uri, citation.retrievedAt,
          citation.currency, citation.summary, citation.scopeNote ?? null,
          citation.jurisdiction ?? null, citation.topic ?? null,
          JSON.stringify(citation.evidenceVersionIds), citation.attribution, citation.origin, citation.artifactVersionId,
          citation.commandId, citation.createdAt, citation.updatedAt
        );

      handle.db
        .prepare(
          `INSERT INTO ethics_operations (command_id, kind, payload_hash, status, entity_id, result_data, created_at, updated_at)
           VALUES (?, 'guidance-citation', ?, 'recorded', ?, ?, ?, ?)`
        )
        .run(commandId, payloadHash, id, JSON.stringify(citation), now, now);
    });
  } catch (error) {
    discardArtifactVersion(handle, artifactVersion.id);
    throw error;
  }

  return citation;
}

export function inspectGuidanceCitations(
  handle: ProjectHandle,
  capability: unknown,
  query?: { uri?: string; publisher?: string }
): readonly GuidanceCitation[] {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  let sql = "SELECT * FROM guidance_citations";
  const params: (string | number | null)[] = [];
  const conditions: string[] = [];

  if (query?.uri) {
    conditions.push("uri = ?");
    params.push(query.uri);
  }
  if (query?.publisher) {
    conditions.push("publisher = ?");
    params.push(query.publisher);
  }
  if (conditions.length > 0) {
    sql += " WHERE " + conditions.join(" AND ");
  }
  sql += " ORDER BY created_at ASC";

  const rows = handle.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
  return rows.map(mapCitationRow);
}

export function inspectGuidanceCitation(
  handle: ProjectHandle,
  capability: unknown,
  id: string
): GuidanceCitation {
  assertEthicsSchema(handle);
  assertEthicsAccess(handle, capability, "ethics:inspect");

  const row = handle.db.prepare("SELECT * FROM guidance_citations WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) {
    throw new ProjectStoreError("not-found", `Guidance citation ${id} not found`);
  }
  return mapCitationRow(row);
}

function parseGuidanceCurrency(value: unknown): GuidanceCurrency {
  if (typeof value === "string" && GUIDANCE_CURRENCIES.includes(value as GuidanceCurrency)) {
    return value as GuidanceCurrency;
  }
  throw new ProjectStoreError("invalid-argument", "invalid guidance currency");
}

function mapCitationRow(row: Record<string, unknown>): GuidanceCitation {
  return {
    id: row.id as string,
    title: (row.title as string | undefined) ?? undefined,
    publisher: row.publisher as string,
    uri: row.uri as string,
    retrievedAt: row.retrieved_at as string,
    currency: parseGuidanceCurrency(row.currency),
    summary: row.summary as string,
    scopeNote: (row.scope_note as string | undefined) ?? undefined,
    jurisdiction: (row.jurisdiction as string | undefined) ?? undefined,
    topic: (row.topic as string | undefined) ?? undefined,
    evidenceVersionIds: JSON.parse(String(row.evidence_version_ids || "[]")),
    attribution: parseViewAttribution(row.attribution),
    origin: parseEthicsOrigin(row.origin),
    artifactVersionId: row.artifact_version_id as string,
    commandId: row.command_id as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string
  };
}
