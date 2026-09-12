import type { ProjectHandle } from "../project/project-types.js";
import type { EvidenceItem, EvidenceStatementKind } from "./evidence-types.js";

export type ClaimOrigin = "owner-recorded" | "specialist-proposed";
export type ClaimSupportStatus =
  | "unverified"
  | "identity-resolved"
  | "access-limited"
  | "fields-missing"
  | "unsupported"
  | "substantively-supported"
  | "contested"
  | "needs-reassessment";
export type ClaimEvidenceRole = "supporting" | "challenging";
export type ClaimVerificationStatus = "unverified" | "identity-resolved" | "access-limited" | "unsupported" | "substantively-supported";
export type CitationIdentityStatus = "resolved" | "fields-missing";
export type CitationAccessStatus = "full-text" | "limited" | "unavailable";
export type CitationSupportStatus = "unverified" | "unsupported" | "substantively-supported";

export interface ClaimRecord {
  readonly id: string;
  readonly statement: string;
  readonly scope: Record<string, unknown>;
  readonly origin: ClaimOrigin;
  readonly currentSupport: ClaimSupportStatus;
  readonly qualification: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ClaimRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly statement?: string;
  readonly proposition?: string;
  readonly text?: string;
  readonly claim?: string | Record<string, unknown>;
  readonly scope?: Record<string, unknown>;
  readonly origin?: ClaimOrigin;
  readonly qualification?: string;
  readonly id?: string;
}

export interface ClaimEvidenceLink {
  readonly id: string;
  readonly claimId: string;
  readonly evidenceItemId: string;
  readonly role: ClaimEvidenceRole;
  readonly verificationStatus: ClaimVerificationStatus;
  readonly qualification: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly evidence?: EvidenceItem;
}

export interface LinkClaimEvidenceRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly claimId: string;
  readonly evidenceItemId: string;
  readonly role?: ClaimEvidenceRole;
  readonly qualification?: string;
  readonly relation?: ClaimEvidenceRole;
}

export interface CitationVerificationRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly claimId: string;
  readonly sourceVersionId: string;
  readonly bibliographic?: Record<string, unknown>;
  readonly metadata?: Record<string, unknown>;
  readonly citation?: Record<string, unknown>;
  readonly sourceRecord?: Record<string, unknown>;
  readonly abstractSupportsClaim?: boolean;
  readonly access?: CitationAccessStatus;
  readonly identityResolved?: boolean;
  readonly abstractSupported?: boolean;
  readonly supportStatus?: CitationSupportStatus;
  readonly accessStatus?: CitationAccessStatus;
  readonly limitations?: readonly string[];
}

export interface CitationVerification {
  readonly id: string;
  readonly claimId: string;
  readonly sourceVersionId: string;
  readonly identityStatus: CitationIdentityStatus;
  readonly identity: CitationIdentityStatus;
  readonly accessStatus: CitationAccessStatus;
  readonly supportStatus: CitationSupportStatus;
  readonly bibliographicFields: Record<string, unknown>;
  readonly limitations: readonly string[];
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ClaimInspection {
  readonly claim: ClaimRecord;
  readonly links: readonly ClaimEvidenceLink[];
  readonly verifications: readonly CitationVerification[];
  readonly reassessments: readonly ClaimReassessment[];
}

export interface ClaimReassessment {
  readonly id: string;
  readonly claimId: string;
  readonly sourceVersionId: string;
  readonly noticeCommandId: string;
  readonly previousSupport: ClaimSupportStatus;
  readonly currentSupport: "needs-reassessment";
  readonly reason: string;
  readonly createdAt: string;
}

export interface EvidenceMatrixRow {
  readonly claim: ClaimRecord;
  readonly supporting: readonly ClaimEvidenceLink[];
  readonly challenging: readonly ClaimEvidenceLink[];
  readonly disagreements: readonly Record<string, unknown>[];
  readonly limitations: readonly string[];
  readonly reassessments: readonly ClaimReassessment[];
}

export interface EvidenceMatrix {
  readonly rows: readonly EvidenceMatrixRow[];
  readonly generatedAt: string;
}

export interface EvidenceMatrixRequest {
  readonly [key: string]: unknown;
  readonly claimIds?: readonly string[];
}

export interface SourceNoticeRequest {
  readonly commandId: string;
  readonly [key: string]: unknown;
  readonly sourceVersionId: string;
  readonly notice?: string;
  readonly message?: string;
  readonly kind?: "correction" | "retraction";
  readonly actor?: string;
}

export interface ReassessmentResult {
  readonly status: "applied" | "duplicate";
  readonly commandId: string;
  readonly sourceVersionId: string;
  readonly claimIds: readonly string[];
  readonly reassessments: readonly ClaimReassessment[];
}

export type ClaimHandle = ProjectHandle;
