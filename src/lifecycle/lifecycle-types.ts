// story: e03s04
import type { ExecutionMode } from "../runtime/preflight-types.js";

export type LifecyclePhase = "dispatch" | "external" | "resume" | "acceptance";

export type LifecycleStatus =
  | "queued"
  | "running"
  | "blocked"
  | "cancelled"
  | "fenced"
  | "quarantined"
  | "accepted"
  | "rejected"
  | "completed";

export interface LifecycleOperation {
  readonly id: string;
  readonly operationType: string;
  readonly branchId: string | null;
  readonly inputSnapshot: string;
  readonly status: LifecycleStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface LifecycleOperationInput {
  readonly id?: string;
  readonly operationType: string;
  readonly branchId?: string | null;
  readonly inputSnapshot: string | { readonly versionIds: readonly string[]; readonly [key: string]: unknown };
  readonly status?: LifecycleStatus;
}

export interface PolicyCheckpoint {
  readonly id: string;
  readonly operationId: string;
  readonly phase: LifecyclePhase;
  readonly policyDecisionId?: string;
  readonly status: "passed" | "blocked" | "denied";
  readonly reason: string;
  readonly createdAt: string;
}

export interface RevocationFence {
  readonly id: string;
  readonly operationId: string;
  readonly reason: string;
  readonly actor: string;
  readonly createdAt: string;
}

export interface QuarantinedOutput {
  readonly id: string;
  readonly operationId: string;
  readonly candidateId: string;
  readonly reason: string;
  readonly disposition: "quarantined" | "discarded";
  readonly details: string;
  readonly createdAt: string;
}

export interface CandidateOutput {
  readonly candidateId: string;
  readonly payload?: unknown;
  readonly versionIds?: readonly string[];
  readonly branchId?: string;
  readonly proposedName?: string;
  readonly [key: string]: unknown;
}

export interface AcceptanceResult {
  readonly status: "accepted" | "quarantined" | "rejected" | "blocked";
  readonly operationId: string;
  readonly candidateId: string;
  readonly reason: string;
  readonly checkpoint?: PolicyCheckpoint;
}

export interface ResumeResult {
  readonly status: "resumed" | "blocked";
  readonly operationId: string;
  readonly checkpoint: PolicyCheckpoint;
  readonly reason?: string;
}

import type { BashGuardConfig } from "../authority/capability-types.js";

export interface LifecycleCheckOptions {
  readonly destination?: string;
  readonly purpose?: string;
  readonly capability?: unknown;
  readonly executionMode?: ExecutionMode;
  readonly command?: string;
  readonly bashGuard?: BashGuardConfig;
  readonly actor?: string;
  readonly targetBranchId?: string;
  readonly expectedVersionIds?: readonly string[];
  readonly requireCanonicalWrite?: boolean;
  /** Internal bounded-work candidate path; it still requires the caller's work capability. */
  readonly allowCandidateSubmission?: boolean;
}
