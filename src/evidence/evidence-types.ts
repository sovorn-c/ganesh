import type { ProjectHandle } from "../project/project-types.js";

export type EvidenceStatementKind = "author-claim" | "measured-finding" | "inference" | "human-interpretation";
export type EvidenceOrigin = "owner-recorded" | "specialist-proposed";
export type EvidenceLocationKind = "source-locator" | "source-segment";
export type EvidenceOperationStatus = "pending" | "complete" | "failed";

export interface EvidenceLocationRef {
  readonly kind: EvidenceLocationKind;
  readonly id: string;
}

export interface LocatedExcerptRequest {
  readonly sourceVersionId: string;
  readonly [key: string]: unknown;
  readonly location?: EvidenceLocationRef;
  readonly locationRef?: EvidenceLocationRef;
  readonly locationKind?: EvidenceLocationKind;
  readonly locationId?: string;
}

export interface LocatedExcerptResult {
  readonly status: "allowed" | "denied";
  readonly sourceVersionId: string;
  readonly location?: EvidenceLocationRef;
  readonly text?: string;
  readonly locator?: Record<string, unknown>;
  readonly limitations: readonly string[];
  readonly reason?: string;
}

export interface EvidenceItemRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly sourceVersionId: string;
  readonly location?: EvidenceLocationRef;
  readonly locationRef?: EvidenceLocationRef;
  readonly locationKind?: EvidenceLocationKind;
  readonly locationId?: string;
  readonly statementKind: EvidenceStatementKind;
  readonly origin?: EvidenceOrigin;
  readonly includeExcerpt?: boolean;
  /** A supplied excerpt is checked against readLocatedExcerpt; it is never trusted. */
  readonly excerpt?: string;
}

export interface EvidenceCandidatePayload {
  readonly sourceVersionId?: string;
  readonly sourceVersionIds?: readonly string[];
  readonly location?: EvidenceLocationRef;
  readonly locationRef?: EvidenceLocationRef;
  readonly locationKind?: EvidenceLocationKind;
  readonly locationId?: string;
  readonly statementKind?: EvidenceStatementKind;
  readonly excerpt?: string;
  readonly includeExcerpt?: boolean;
  readonly text?: string;
  readonly [key: string]: unknown;
}

export interface EvidenceCandidateRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly candidate?: EvidenceCandidatePayload;
  readonly payload?: EvidenceCandidatePayload;
  readonly sourceVersionId?: string;
  readonly location?: EvidenceLocationRef;
  readonly locationKind?: EvidenceLocationKind;
  readonly locationId?: string;
  readonly statementKind?: EvidenceStatementKind;
  readonly includeExcerpt?: boolean;
}

export interface EvidenceItem {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly location: EvidenceLocationRef;
  readonly locator: Record<string, unknown>;
  readonly statementKind: EvidenceStatementKind;
  readonly origin: EvidenceOrigin;
  readonly limitations: readonly string[];
  readonly excerpt?: string;
  readonly excerptHash?: string;
  readonly createdAt: string;
}

export type EvidenceItemResult = EvidenceItem;

export interface EvidenceOperation {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly evidenceItemId?: string;
  readonly status: EvidenceOperationStatus;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface EvidenceItemFilter {
  readonly sourceVersionId?: string;
  readonly statementKind?: EvidenceStatementKind;
  readonly origin?: EvidenceOrigin;
}

export type EvidenceHandle = ProjectHandle;
