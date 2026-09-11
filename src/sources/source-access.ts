// story: e06s04
import { readFileSync } from "node:fs";
import { inspectArtifactVersion } from "../artifacts/artifact-store.js";
import { isOwnerCapability, isWorkerCapability, readProjectPath } from "../authority/capability-broker.js";
import { requestDisclosure } from "../policy/disclosure-gateway.js";
import type { DisclosureOperationKind } from "../policy/disclosure-types.js";
import { pathInside } from "../persistence/storage-utils.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { getSourceVersion, listSourceDiagnostics, listSourceExtractions, listSourceSegments } from "./source-store.js";
import type { SourceExtractionStatus, SourceLocator, SourceVersionRecord } from "./source-types.js";

export interface SourceInspectionRequest {
  readonly sourceVersionId: string;
  readonly locatorId?: string;
  readonly includeContent?: boolean;
}

export interface SourceInspection {
  readonly status: "allowed" | "denied";
  readonly source?: SourceVersionRecord;
  readonly extractionStatus?: SourceExtractionStatus;
  readonly contentStatus?: string;
  readonly integrity?: "verified" | "unavailable" | "failed";
  readonly limitations: readonly string[];
  readonly diagnostics?: readonly Record<string, unknown>[];
  readonly locator?: SourceLocator;
  readonly content?: string;
  readonly reason?: string;
}

export interface SourceHandoffRequest extends SourceInspectionRequest {
  readonly operation: DisclosureOperationKind;
  readonly destination: string;
  readonly purpose: string;
  readonly transformation?: string;
  readonly branchId?: string;
  readonly correlationId?: string;
  readonly actor?: string;
}

export interface SourceHandoffDecision {
  readonly status: "allow" | "deny";
  readonly sourceVersionId: string;
  readonly operation: DisclosureOperationKind;
  readonly destination: string;
  readonly reason: string;
  readonly disclosureId?: string;
  readonly path?: string;
  readonly content?: string;
}

function authorize(handle: ProjectHandle, capability: unknown, operation: "source:inspect" | "source:handoff"): boolean {
  if (isOwnerCapability(capability)) {return capability.ownerId === handle.project.ownerId;}
  return isWorkerCapability(capability) && capability.projectId === handle.project.id && capability.canPerform(operation);
}

function denied(reason: string): SourceInspection {
  return { status: "denied", limitations: [], reason };
}

function safePath(handle: ProjectHandle, capability: unknown, storagePath: string | null): string {
  if (storagePath === null || !pathInside(handle.project.artifactRoot, storagePath)) {
    throw new ProjectStoreError("forbidden", "artifact path is outside the project artifact root");
  }
  return readProjectPath(capability, storagePath, handle.project.rootPath);
}

export function inspectSource(handle: ProjectHandle, capability: unknown, request: SourceInspectionRequest): SourceInspection {
  if (!authorize(handle, capability, "source:inspect")) {return denied("denied: caller lacks current source inspection capability");}
  let source: SourceVersionRecord;
  try {
    source = getSourceVersion(handle, request.sourceVersionId);
  } catch {
    return denied("denied: source version is unavailable");
  }
  let artifact;
  try {
    artifact = inspectArtifactVersion(handle, request.sourceVersionId);
  } catch {
    return denied("denied: source artifact is unavailable");
  }
  const limitations: string[] = [];
  if (source.access !== "full-text") {limitations.push(`access-${source.access}`);}
  if (source.extractionStatus !== "complete") {limitations.push(`extraction-${source.extractionStatus}`);}
  if (artifact.contentStatus !== "available") {limitations.push(`integrity-${artifact.contentStatus}`);}
  const diagnostics = listSourceDiagnostics(handle, request.sourceVersionId) as unknown as readonly Record<string, unknown>[];
  const base: SourceInspection = {
    status: "allowed",
    source,
    extractionStatus: source.extractionStatus,
    contentStatus: artifact.contentStatus,
    integrity: artifact.contentStatus === "available" ? "verified" : artifact.contentStatus === "unavailable" ? "unavailable" : "failed",
    limitations,
    diagnostics
  };
  if (!request.includeContent) {return base;}
  if (source.access !== "full-text" || source.extractionStatus !== "complete" || artifact.contentStatus !== "available") {
    return { ...base, reason: "content is not permitted for this access or extraction state" };
  }
  if (request.locatorId !== undefined) {
    const segment = listSourceSegments(handle, request.sourceVersionId).find((candidate) => candidate.id === request.locatorId);
    if (segment === undefined) {return { ...base, reason: "requested locator is unavailable" };}
    const derived = inspectArtifactVersion(handle, segment.derivedVersionId);
    if (derived.contentStatus !== "available") {return { ...base, limitations: [...limitations, "derived-integrity-failed"], reason: "located derived content failed integrity verification" };}
    return { ...base, locator: segment.locator, content: segment.text };
  }
  if (source.format !== "text" && source.format !== "markdown") {
    return { ...base, reason: "full content is only returned through a located text or Markdown source" };
  }
  try {
    const path = safePath(handle, capability, artifact.storagePath);
    const bytes = readFileSync(path);
    return { ...base, content: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return { ...base, reason: "source content could not be read safely" };
  }
}

export function authorizeSourceHandoff(handle: ProjectHandle, capability: unknown, request: SourceHandoffRequest): SourceHandoffDecision {
  const base = { sourceVersionId: request.sourceVersionId, operation: request.operation, destination: request.destination };
  if (!authorize(handle, capability, "source:handoff")) {return { ...base, status: "deny", reason: "denied: caller lacks current source handoff capability" };}
  const inspection = inspectSource(handle, capability, { sourceVersionId: request.sourceVersionId, locatorId: request.locatorId, includeContent: request.includeContent });
  if (inspection.status === "denied" || inspection.source === undefined || inspection.integrity !== "verified") {
    return { ...base, status: "deny", reason: inspection.reason ?? "denied: source integrity is not verified" };
  }
  if (inspection.source.access !== "full-text") {return { ...base, status: "deny", reason: "denied: source access does not permit handoff" };}
  const disclosure = requestDisclosure(handle, {
    sourceVersions: [request.sourceVersionId],
    operation: request.operation,
    destination: request.destination,
    purpose: request.purpose,
    transformation: request.transformation,
    branchId: request.branchId,
    correlationId: request.correlationId,
    actor: request.actor
  });
  if (disclosure.status !== "allow") {return { ...base, status: "deny", reason: disclosure.reason, disclosureId: disclosure.id };}
  if (request.destination !== "local") {
    return { ...base, status: "allow", reason: disclosure.reason, disclosureId: disclosure.id, ...(request.includeContent && inspection.content === undefined ? {} : { content: inspection.content }) };
  }
  try {
    const artifact = inspectArtifactVersion(handle, request.sourceVersionId);
    const path = safePath(handle, capability, artifact.storagePath);
    return { ...base, status: "allow", reason: disclosure.reason, disclosureId: disclosure.id, path, ...(inspection.content === undefined ? {} : { content: inspection.content }) };
  } catch {
    return { ...base, status: "deny", reason: "denied: checked artifact path is unavailable", disclosureId: disclosure.id };
  }
}
