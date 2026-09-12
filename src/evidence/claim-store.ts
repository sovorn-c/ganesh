import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { getSourceVersion, listSourceRecords } from "../sources/source-store.js";
import { inspectSource } from "../sources/source-access.js";
import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { payloadHash } from "../persistence/history-store.js";
import { isoNow, newId, stringValue } from "../persistence/storage-utils.js";
import { getEvidenceItem, listEvidenceItems } from "./evidence-store.js";
import type { EvidenceItem } from "./evidence-types.js";
import type {
  CitationAccessStatus,
  CitationIdentityStatus,
  CitationSupportStatus,
  CitationVerification,
  CitationVerificationRequest,
  ClaimEvidenceLink,
  ClaimEvidenceRole,
  ClaimInspection,
  ClaimRecord,
  ClaimReassessment,
  ClaimRequest,
  ClaimSupportStatus,
  LinkClaimEvidenceRequest,
} from "./claim-types.js";

export function claimSchemaAvailable(handle: ProjectHandle): boolean {
  return handle.db.prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'claims'").get() !== undefined;
}

export function assertClaimSchema(handle: ProjectHandle): void {
  if (!claimSchemaAvailable(handle)) {throw new ProjectStoreError("evidence-schema-unavailable", "E07 claim tables are unavailable in this project");}
}

export function json<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value)) as T; } catch { return fallback; }
}

export function allowed(handle: ProjectHandle, capability: unknown, operations: readonly string[]): boolean {
  if (isOwnerCapability(capability)) {return capability.ownerId === handle.project.ownerId;}
  return isWorkerCapability(capability)
    && capability.projectId === handle.project.id
    && operations.every((operation) => capability.canPerform(operation));
}

export function claimFromRow(row: Record<string, unknown>): ClaimRecord {
  return {
    id: stringValue(row.id, "claim id"),
    statement: stringValue(row.statement, "claim statement"),
    scope: json<Record<string, unknown>>(row.scope, {}),
    origin: stringValue(row.origin, "claim origin") as ClaimRecord["origin"],
    currentSupport: stringValue(row.current_support, "claim support") as ClaimSupportStatus,
    qualification: stringValue(row.qualification, "claim qualification"),
    commandId: stringValue(row.command_id, "claim command id"),
    createdAt: stringValue(row.created_at, "claim creation time"),
    updatedAt: stringValue(row.updated_at, "claim update time")
  };
}

export function linkFromRow(row: Record<string, unknown>, evidence?: EvidenceItem): ClaimEvidenceLink {
  return {
    id: stringValue(row.id, "claim link id"),
    claimId: stringValue(row.claim_id, "claim link claim id"),
    evidenceItemId: stringValue(row.evidence_item_id, "claim link evidence id"),
    role: stringValue(row.role, "claim link role") as ClaimEvidenceRole,
    verificationStatus: stringValue(row.verification_status, "claim link verification") as ClaimEvidenceLink["verificationStatus"],
    qualification: stringValue(row.qualification, "claim link qualification"),
    commandId: stringValue(row.command_id, "claim link command id"),
    createdAt: stringValue(row.created_at, "claim link creation time"),
    ...(evidence === undefined ? {} : { evidence })
  };
}

function verificationFromRow(row: Record<string, unknown>): CitationVerification {
  const identityStatus = stringValue(row.identity_status, "citation identity status") as CitationIdentityStatus;
  return {
    id: stringValue(row.id, "citation verification id"),
    claimId: stringValue(row.claim_id, "citation claim id"),
    sourceVersionId: stringValue(row.source_version_id, "citation source id"),
    identityStatus,
    identity: identityStatus,
    accessStatus: stringValue(row.access_status, "citation access status") as CitationAccessStatus,
    supportStatus: stringValue(row.support_status, "citation support status") as CitationSupportStatus,
    bibliographicFields: json<Record<string, unknown>>(row.bibliographic_fields, {}),
    limitations: json<string[]>(row.limitations, []),
    commandId: stringValue(row.command_id, "citation command id"),
    createdAt: stringValue(row.created_at, "citation creation time")
  };
}

export function reassessmentFromRow(row: Record<string, unknown>): ClaimReassessment {
  return {
    id: stringValue(row.id, "reassessment id"),
    claimId: stringValue(row.claim_id, "reassessment claim id"),
    sourceVersionId: stringValue(row.source_version_id, "reassessment source id"),
    noticeCommandId: stringValue(row.notice_command_id, "reassessment notice command id"),
    previousSupport: stringValue(row.previous_support, "reassessment previous support") as ClaimSupportStatus,
    currentSupport: "needs-reassessment",
    reason: stringValue(row.reason, "reassessment reason"),
    createdAt: stringValue(row.created_at, "reassessment creation time")
  };
}

function claimById(handle: ProjectHandle, claimId: string): ClaimRecord {
  const row = handle.db.prepare("SELECT * FROM claims WHERE id = ?").get(claimId) as Record<string, unknown> | undefined;
  if (row === undefined) {throw new ProjectStoreError("claim-not-found", "claim was not found");}
  return claimFromRow(row);
}

function updateClaimSupport(handle: ProjectHandle, claimId: string): ClaimSupportStatus {
  const links = handle.db.prepare("SELECT role, verification_status FROM claim_evidence_links WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>;
  const verifications = handle.db.prepare("SELECT support_status, access_status, identity_status FROM citation_verifications WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>;
  const hasSupport = links.some((row) => row.role === "supporting");
  const hasChallenge = links.some((row) => row.role === "challenging");
  const substantive = links.some((row) => row.role === "supporting" && row.verification_status === "substantively-supported")
    || verifications.some((row) => row.support_status === "substantively-supported");
  const limited = links.some((row) => row.role === "supporting" && row.verification_status === "access-limited")
    || verifications.some((row) => row.access_status === "limited" || row.access_status === "unavailable");
  const unsupported = verifications.some((row) => row.support_status === "unsupported") || links.some((row) => row.verification_status === "unsupported");
  let support: ClaimSupportStatus = "unverified";
  if (substantive) {support = "substantively-supported";}
  else if (unsupported) {support = "unsupported";}
  else if (limited) {support = "access-limited";}
  else if (verifications.some((row) => row.identity_status === "fields-missing")) {support = "fields-missing";}
  else if (verifications.some((row) => row.identity_status === "resolved")) {support = "identity-resolved";}
  if (hasSupport && hasChallenge) {support = "contested";}
  if (!hasSupport && !hasChallenge && verifications.length === 0) {support = "unverified";}
  handle.db.prepare("UPDATE claims SET current_support = ?, updated_at = ? WHERE id = ?").run(support, isoNow(), claimId);
  return support;
}

function linkStatus(handle: ProjectHandle, capability: unknown, evidenceItemId: string): ClaimEvidenceLink["verificationStatus"] {
  const item = getEvidenceItem(handle, capability, evidenceItemId);
  const source = getSourceVersion(handle, item.sourceVersionId);
  if (source.access !== "full-text" || source.extractionStatus !== "complete") {return "access-limited";}
  if (item.excerpt === undefined) {return "unverified";}
  return "substantively-supported";
}

export function recordClaim(handle: ProjectHandle, capability: unknown, request: ClaimRequest): ClaimRecord {
  assertWritable(handle);
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:record", "evidence:inspect"])) {throw new ProjectStoreError("forbidden", "claim recording requires claim:record and evidence:inspect capability");}
  const claimPayload = typeof request.claim === "object" && request.claim !== null ? request.claim : undefined;
  const statement = request.statement ?? request.proposition ?? request.text ?? (typeof request.claim === "string" ? request.claim : undefined) ?? (typeof claimPayload?.statement === "string" ? claimPayload.statement : undefined);
  if (statement === undefined || statement.trim() === "") {throw new ProjectStoreError("invalid-claim", "claim statement is required");}
  if (!request.commandId) {throw new ProjectStoreError("invalid-command", "commandId is required");}
  const existing = handle.db.prepare("SELECT * FROM claims WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const old = claimFromRow(existing);
    if (old.statement !== statement || JSON.stringify(old.scope) !== JSON.stringify(request.scope ?? claimPayload?.scope ?? {})) {throw new ProjectStoreError("claim-payload-conflict", "command ID was reused with a different claim");}
    return old;
  }
  const claim: ClaimRecord = {
    id: request.id ?? newId("claim"),
    statement,
    scope: request.scope ?? (claimPayload?.scope as Record<string, unknown> | undefined) ?? {},
    origin: request.origin ?? (isOwnerCapability(capability) ? "owner-recorded" : "specialist-proposed"),
    currentSupport: "unverified",
    qualification: request.qualification ?? "",
    commandId: request.commandId,
    createdAt: isoNow(),
    updatedAt: isoNow()
  };
  handle.db.prepare("INSERT INTO claims (id, statement, scope, origin, current_support, qualification, command_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(claim.id, claim.statement, JSON.stringify(claim.scope), claim.origin, claim.currentSupport, claim.qualification, claim.commandId, claim.createdAt, claim.updatedAt);
  return claim;
}

export function linkClaimEvidence(handle: ProjectHandle, capability: unknown, request: LinkClaimEvidenceRequest): ClaimEvidenceLink {
  assertWritable(handle);
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:record", "evidence:inspect"])) {throw new ProjectStoreError("forbidden", "claim linking requires claim:record and evidence:inspect capability");}
  const role = request.role ?? request.relation;
  if (role !== "supporting" && role !== "challenging") {throw new ProjectStoreError("invalid-link-role", "claim evidence role must be supporting or challenging");}
  claimById(handle, request.claimId);
  const evidence = getEvidenceItem(handle, capability, request.evidenceItemId);
  const existing = handle.db.prepare("SELECT * FROM claim_evidence_links WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  if (existing !== undefined) {
    const old = linkFromRow(existing, evidence);
    if (old.claimId !== request.claimId || old.evidenceItemId !== request.evidenceItemId || old.role !== role) {throw new ProjectStoreError("claim-link-payload-conflict", "command ID was reused with a different link");}
    return old;
  }
  const status = linkStatus(handle, capability, request.evidenceItemId);
  const link: ClaimEvidenceLink = {
    id: newId("claim-link"),
    claimId: request.claimId,
    evidenceItemId: request.evidenceItemId,
    role,
    verificationStatus: status,
    qualification: request.qualification ?? "",
    commandId: request.commandId,
    createdAt: isoNow(),
    evidence
  };
  try {
    handle.db.prepare("INSERT INTO claim_evidence_links (id, claim_id, evidence_item_id, role, verification_status, qualification, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(link.id, link.claimId, link.evidenceItemId, link.role, link.verificationStatus, link.qualification, link.commandId, link.createdAt);
  } catch (error) {
    if (String(error).includes("UNIQUE")) {throw new ProjectStoreError("claim-link-exists", "the same evidence link already exists");}
    throw error;
  }
  updateClaimSupport(handle, request.claimId);
  return link;
}

function sourceBibliography(handle: ProjectHandle, sourceVersionId: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const record of listSourceRecords(handle, sourceVersionId)) {
    if (["bibliographic", "citation", "metadata", "reference"].includes(String(record.recordKind))) {Object.assign(result, record.data);}
  }
  return result;
}

function field(data: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) {if (data[name] !== undefined && data[name] !== null && data[name] !== "") {return data[name];}}
  return undefined;
}

export function verifyCitation(handle: ProjectHandle, capability: unknown, request: CitationVerificationRequest): CitationVerification {
  assertWritable(handle);
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:record", "evidence:inspect"])) {throw new ProjectStoreError("forbidden", "citation verification requires claim:record and evidence:inspect capability");}
  claimById(handle, request.claimId);
  const source = getSourceVersion(handle, request.sourceVersionId);
  const existing = handle.db.prepare("SELECT * FROM citation_verifications WHERE command_id = ?").get(request.commandId) as Record<string, unknown> | undefined;
  const bibliographicFields = {
    ...sourceBibliography(handle, request.sourceVersionId),
    ...(request.sourceRecord ?? {}),
    ...(request.citation ?? {}),
    ...(request.metadata ?? {}),
    ...(request.bibliographic ?? {})
  };
  const identity = request.identityResolved === true
    ? "resolved"
    : request.identityResolved === false
      ? "fields-missing"
      : (field(bibliographicFields, "doi", "DOI") !== undefined
        && field(bibliographicFields, "title") !== undefined
        && field(bibliographicFields, "year", "publishedYear") !== undefined
        ? "resolved" : "fields-missing");
  if (existing !== undefined) {
    const old = verificationFromRow(existing);
    const requestedFields = Object.entries(bibliographicFields);
    const fieldConflict = requestedFields.some(([key, value]) => old.bibliographicFields[key] !== value);
    if (old.claimId !== request.claimId || old.sourceVersionId !== request.sourceVersionId || fieldConflict || (request.supportStatus !== undefined && old.supportStatus !== request.supportStatus) || (request.accessStatus !== undefined && old.accessStatus !== request.accessStatus)) {
      throw new ProjectStoreError("citation-payload-conflict", "command ID was reused with a different citation verification");
    }
    return old;
  }
  const artifact = inspectArtifactVersion(handle, request.sourceVersionId);
  const access: CitationAccessStatus = request.accessStatus ?? request.access ?? (source.access !== "full-text" || source.extractionStatus !== "complete" ? "limited" : artifact.contentStatus === "available" ? "full-text" : "unavailable");
  const supportFromLinks = (handle.db.prepare("SELECT cel.verification_status FROM claim_evidence_links cel JOIN evidence_items ei ON ei.id = cel.evidence_item_id WHERE cel.claim_id = ? AND cel.role = 'supporting' AND ei.source_version_id = ?").all(request.claimId, request.sourceVersionId) as Array<Record<string, unknown>>).some((row) => row.verification_status === "substantively-supported");
  let support: CitationSupportStatus = request.supportStatus ?? "unverified";
  if ((request.abstractSupported ?? request.abstractSupportsClaim) === false) {support = "unsupported";}
  else if (supportFromLinks && access === "full-text" && identity === "resolved") {support = "substantively-supported";}
  else if (access !== "full-text") {support = (request.abstractSupported ?? request.abstractSupportsClaim) === true ? "unverified" : "unsupported";}
  const limitations = [...(request.limitations ?? [])];
  if (access !== "full-text") {limitations.push("full-text-unavailable");}
  if (identity === "fields-missing") {limitations.push("bibliographic-fields-missing");}
  const verification: CitationVerification = {
    id: newId("citation-verification"),
    claimId: request.claimId,
    sourceVersionId: request.sourceVersionId,
    identityStatus: identity,
    identity,
    accessStatus: access,
    supportStatus: support,
    bibliographicFields,
    limitations: [...new Set(limitations)],
    commandId: request.commandId,
    createdAt: isoNow()
  };
  handle.db.prepare("INSERT INTO citation_verifications (id, claim_id, source_version_id, identity_status, access_status, support_status, bibliographic_fields, limitations, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").run(verification.id, verification.claimId, verification.sourceVersionId, verification.identityStatus, verification.accessStatus, verification.supportStatus, JSON.stringify(verification.bibliographicFields), JSON.stringify(verification.limitations), verification.commandId, verification.createdAt);
  updateClaimSupport(handle, request.claimId);
  return verification;
}

export function inspectClaim(handle: ProjectHandle, capability: unknown, claimId: string): ClaimInspection {
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:inspect"]) && !allowed(handle, capability, ["evidence:inspect"])) {throw new ProjectStoreError("forbidden", "claim inspection requires claim:inspect capability");}
  const claim = claimById(handle, claimId);
  const rows = handle.db.prepare("SELECT * FROM claim_evidence_links WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>;
  const links = rows.map((row) => linkFromRow(row, getEvidenceItem(handle, capability, String(row.evidence_item_id))));
  const verifications = (handle.db.prepare("SELECT * FROM citation_verifications WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>).map(verificationFromRow);
  const reassessments = (handle.db.prepare("SELECT * FROM claim_reassessments WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>).map(reassessmentFromRow);
  return { claim, links, verifications, reassessments };
}

export function listClaims(handle: ProjectHandle, capability: unknown): readonly ClaimRecord[] {
  assertClaimSchema(handle);
  if (!allowed(handle, capability, ["claim:inspect"]) && !allowed(handle, capability, ["evidence:inspect"])) {throw new ProjectStoreError("forbidden", "claim inspection requires claim:inspect capability");}
  return (handle.db.prepare("SELECT * FROM claims ORDER BY created_at, id").all() as Array<Record<string, unknown>>).map(claimFromRow);
}

export function reassessmentsFor(handle: ProjectHandle, claimId: string): readonly ClaimReassessment[] {
  return (handle.db.prepare("SELECT * FROM claim_reassessments WHERE claim_id = ? ORDER BY created_at, id").all(claimId) as Array<Record<string, unknown>>).map(reassessmentFromRow);
}
