import type { CommitmentRecord } from "../decisions/commitment-types.js";
import type { MethodologyOrigin, ProblemFramingRecord, ViewAttribution } from "../methodology/methodology-types.js";
import type { ProgressRecord, ProtocolVersionRecord } from "./progress-types.js";

export type ReportedPriorSourceKind = "imported-text" | "supervisor-feedback" | "owner-narrative";

export interface ReportedPriorCommitmentRequest {
  readonly statement: string;
  readonly attributedActor: string;
  readonly sourceArtifactVersionId?: string;
  readonly sourceKind: ReportedPriorSourceKind;
  readonly occurredOn?: string;
  readonly protocolVersionId?: string;
  readonly authenticity?: "reported";
  readonly attribution?: ViewAttribution;
  readonly origin?: MethodologyOrigin;
  readonly commandId?: string;
  readonly branchId?: string;
}

export interface ReportedPriorCommitmentRecord {
  readonly id: string;
  readonly statement: string;
  readonly attributedActor: string;
  readonly sourceArtifactVersionId?: string;
  readonly sourceKind: ReportedPriorSourceKind;
  readonly occurredOn?: string;
  readonly protocolVersionId?: string;
  readonly authenticity: "reported";
  readonly attribution: ViewAttribution;
  readonly origin: MethodologyOrigin;
  readonly artifactVersionId: string;
  readonly commandId: string;
  readonly branchId: string;
  readonly createdAt: string;
}

export interface ReportedPriorCommitmentQuery {
  readonly id?: string;
  readonly branchId?: string;
  readonly protocolVersionId?: string;
}

export interface StudyConsultationLimit {
  readonly code: "missing-orientation" | "missing-literature" | "missing-data" | "missing-protocol-in-force";
  readonly message: string;
}

export interface StudyConsultationQuery {
  readonly branchId?: string;
}

export interface StudyConsultationView {
  readonly methodologyDrafts: readonly ProblemFramingRecord[];
  readonly protocolVersions: readonly ProtocolVersionRecord[];
  readonly progress: readonly ProgressRecord[];
  readonly authenticatedCommitments: readonly CommitmentRecord[];
  readonly reportedPriorCommitments: readonly ReportedPriorCommitmentRecord[];
  readonly limits: readonly StudyConsultationLimit[];
}
