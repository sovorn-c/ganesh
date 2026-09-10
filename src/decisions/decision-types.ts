// story: e04s01

export type DecisionDisposition = "approved" | "rejected" | "deferred";
export type DecisionPacketStatus = "open" | "published" | "archived" | "superseded";
export type DecisionAction = DecisionDisposition | "approve" | "reject" | "defer";

export interface DecisionCandidateInput {
  readonly versionId: string;
  readonly label?: string;
  readonly rationale?: string;
}

export interface DecisionPacketInput {
  readonly id?: string;
  readonly packetId?: string;
  readonly question: string;
  readonly branchId?: string;
  readonly snapshotId?: string;
  readonly branchRevision?: number;
  readonly candidateVersionIds?: readonly string[];
  readonly candidates?: readonly DecisionCandidateInput[];
  readonly dependencyVersionIds?: readonly string[];
  readonly dependencies?: readonly string[];
  readonly reviewReferences?: readonly string[];
  readonly permittedActions?: readonly DecisionDisposition[];
  readonly parentPacketId?: string;
  readonly packetVersion?: number;
}

export interface DecisionCandidate {
  readonly versionId: string;
  readonly label?: string;
  readonly rationale?: string;
}

export interface DecisionPacket {
  readonly id: string;
  readonly packetVersion: number;
  readonly question: string;
  readonly branchId: string;
  readonly snapshotId: string;
  readonly branchRevision: number;
  readonly candidates: readonly DecisionCandidate[];
  readonly candidateVersionIds: readonly string[];
  readonly dependencyVersionIds: readonly string[];
  readonly reviewReferences: readonly string[];
  readonly permittedActions: readonly DecisionDisposition[];
  readonly status: DecisionPacketStatus;
  readonly parentPacketId: string | null;
  readonly createdAt: string;
}

export interface OwnerDecisionRequest {
  readonly packetId: string;
  readonly packetVersion?: number;
  readonly action?: DecisionAction;
  readonly disposition?: DecisionAction;
  readonly selectedCandidateVersionIds?: readonly string[];
  readonly selectedVersionIds?: readonly string[];
  readonly candidateVersionIds?: readonly string[];
  readonly dependencyVersionIds?: readonly string[];
  readonly branchId?: string;
  readonly expectedBranchRevision?: number;
  readonly branchRevision?: number;
  readonly expectedVersion?: number;
  readonly rationale?: string;
  readonly commandId: string;
  readonly actor?: string;
  readonly capability?: unknown;
  readonly ownerCapability?: unknown;
}

export interface DecisionRecord {
  readonly id: string;
  readonly packetId: string;
  readonly packetVersion: number;
  readonly disposition: DecisionDisposition;
  readonly selectedCandidateVersionIds: readonly string[];
  readonly dependencyVersionIds: readonly string[];
  readonly rationale: string;
  readonly commandId: string;
  readonly actor: string;
  readonly branchId: string;
  readonly branchRevision: number;
  readonly commitmentId: string | null;
  readonly createdAt: string;
}

export type OwnerDecisionStatus = DecisionDisposition | "stale" | "duplicate" | "rejected";

export interface OwnerDecisionResult {
  readonly status: OwnerDecisionStatus;
  readonly packetId: string;
  readonly packetVersion: number;
  readonly decisionId?: string;
  readonly commitmentId?: string;
  readonly branchId: string;
  readonly branchRevision: number;
  readonly reason: string;
  readonly decision?: DecisionRecord;
}

export interface DecisionHistoryFilter {
  readonly packetId?: string;
  readonly commitmentId?: string;
  readonly branchId?: string;
}

export interface ReviseDecisionPacketInput extends DecisionPacketInput {
  readonly priorPacketId: string;
  readonly rationale: string;
}

export interface DecisionLifecycleRequest {
  readonly packetId: string;
  readonly commandId: string;
  readonly actor?: string;
  readonly capability?: unknown;
  readonly ownerCapability?: unknown;
  readonly expectedPacketVersion?: number;
  readonly reason?: string;
}

export interface DecisionLifecycleResult {
  readonly status: "reopened" | "archived" | "superseded" | "duplicate" | "rejected";
  readonly packetId: string;
  readonly replacementPacketId?: string;
  readonly reason: string;
}