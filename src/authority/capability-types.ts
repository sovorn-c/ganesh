// story: e03s03
import type { ExecutionMode } from "../runtime/preflight-types.js";

export const OWNER_OPERATIONS: readonly string[] = [
  "owner-approval",
  "credential-access",
  "canonical-project-write",
  "delete-project",
  "grant-policy",
  "withdraw-policy",
  "work:authorize-contract",
  "work:grant-standing-permission",
  "work:cancel",
  "work:revise-contract"
];

export interface WorkerCapabilityScope {
  readonly projectId: string;
  readonly projectRoot: string;
  readonly allowedOperations: readonly string[];
  readonly allowedPaths?: readonly string[];
}

export interface OwnerActionRequest {
  readonly action: string;
  readonly targetId?: string;
  readonly details?: Record<string, unknown>;
}

export interface OwnerActionResult {
  readonly status: "completed" | "denied";
  readonly action: string;
  readonly reason?: string;
  readonly completedAt: string;
}

export interface CuratedResourceResult {
  readonly status: "allowed" | "denied";
  readonly resourceName: string;
  readonly content?: string;
  readonly reason?: string;
}

export interface InertDocumentResult {
  readonly inertText: string;
  readonly hasBlockedScripts: boolean;
  readonly blockedElements: readonly string[];
}

export interface BashGuardConfig {
  readonly allowedCommands?: readonly string[];
  readonly deniedCommands?: readonly string[];
  readonly requireApprovalCommands?: readonly string[];
}

export interface CommandExecutionResult {
  readonly status: "allowed" | "approval-required" | "denied";
  readonly command: string;
  readonly mode: ExecutionMode;
  readonly reason: string;
  readonly notice?: string;
}

export interface CapabilityDecision {
  readonly operation: string;
  readonly allowed: boolean;
  readonly reason: string;
}
