// story: e04s02

export type CommitmentStatus = "active" | "rejected" | "deferred" | "archived" | "superseded";
export type ReadinessStatus = "ready" | "needs-review" | "blocked";
export type CommitmentEventType = "approved" | "rejected" | "deferred" | "reopened" | "archived" | "superseded" | "revised";

export interface CommitmentRecord {
  readonly id: string;
  readonly decisionId: string;
  readonly packetId: string;
  readonly packetVersion: number;
  readonly branchId: string;
  readonly branchRevision: number;
  readonly selectedCandidateVersionIds: readonly string[];
  readonly dependencyVersionIds: readonly string[];
  readonly status: CommitmentStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CommitmentEvent {
  readonly id: string;
  readonly commitmentId: string;
  readonly packetId: string;
  readonly eventType: CommitmentEventType;
  readonly status: CommitmentStatus;
  readonly reason: string;
  readonly commandId: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface ReadinessRequest {
  readonly commitmentId?: string;
  readonly packetId?: string;
  readonly branchId?: string;
  readonly action?: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly commandId?: string;
  readonly actor?: string;
}

export interface ReadinessAssessment {
  readonly id: string;
  readonly commitmentId: string;
  readonly packetId: string;
  readonly branchId: string;
  readonly action: string;
  readonly status: ReadinessStatus;
  readonly reason: string;
  readonly causes: readonly string[];
  readonly affectedVersionIds: readonly string[];
  readonly nextAction: string;
  readonly createdAt: string;
}

export interface CommitmentHistoryFilter {
  readonly commitmentId?: string;
  readonly packetId?: string;
  readonly branchId?: string;
}

export interface LifecycleActionRequest {
  readonly commitmentId?: string;
  readonly packetId: string;
  readonly replacementPacketId?: string;
  readonly commandId: string;
  readonly actor?: string;
  readonly reason?: string;
}

export interface LifecycleActionResult {
  readonly status: "reopened" | "archived" | "superseded" | "duplicate" | "rejected";
  readonly commitmentId?: string;
  readonly packetId: string;
  readonly replacementPacketId?: string;
  readonly reason: string;
}