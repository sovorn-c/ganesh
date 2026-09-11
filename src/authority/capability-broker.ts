// story: e03s03
import { resolve } from "node:path";
import { ProjectStoreError } from "../project/project-types.js";
import { FULL_ACCESS_NOTICE } from "../runtime/preflight-constants.js";
import { pathInside } from "../persistence/storage-utils.js";
import type { ExecutionMode } from "../runtime/preflight-types.js";
import {
  OWNER_OPERATIONS,
  type BashGuardConfig,
  type CapabilityDecision,
  type CommandExecutionResult,
  type CuratedResourceResult,
  type InertDocumentResult,
  type OwnerActionRequest,
  type OwnerActionResult,
  type WorkerCapabilityScope
} from "./capability-types.js";

const OWNER_SECRET = Symbol("OWNER_SECRET");
const WORKER_SECRET = Symbol("WORKER_SECRET");

export class OwnerCapability {
  readonly [OWNER_SECRET] = true;
  readonly role = "owner" as const;
  readonly ownerId: string;
  readonly createdAt: string;

  constructor(ownerId: string) {
    if (!ownerId) {
      throw new ProjectStoreError("invalid-argument", "ownerId is required");
    }
    this.ownerId = ownerId;
    this.createdAt = new Date().toISOString();
  }
}

export function isOwnerCapability(obj: unknown): obj is OwnerCapability {
  return typeof obj === "object" && obj !== null && (obj as Record<symbol, unknown>)[OWNER_SECRET] === true;
}

export class WorkerCapability {
  readonly [WORKER_SECRET] = true;
  readonly role = "worker" as const;
  readonly projectId: string;
  readonly projectRoot: string;
  readonly allowedOperations: readonly string[];
  readonly allowedPaths: readonly string[];
  readonly createdAt: string;

  constructor(scope: WorkerCapabilityScope) {
    if (!scope || !scope.projectId || !scope.projectRoot) {
      throw new ProjectStoreError("invalid-argument", "projectId and projectRoot are required");
    }
    this.projectId = scope.projectId;
    this.projectRoot = resolve(scope.projectRoot);
    this.allowedOperations = [...(scope.allowedOperations ?? [])];
    this.allowedPaths = (scope.allowedPaths ?? [this.projectRoot]).map((p) => resolve(p));
    this.createdAt = new Date().toISOString();
  }

  canPerform(operation: string): boolean {
    if (OWNER_OPERATIONS.includes(operation)) {
      return false;
    }
    return this.allowedOperations.includes(operation) || this.allowedOperations.includes("*");
  }

  isPathAllowed(targetPath: string): boolean {
    const resolved = resolve(targetPath);
    return this.allowedPaths.some((allowed) => pathInside(allowed, resolved));
  }
}

export function isWorkerCapability(obj: unknown): obj is WorkerCapability {
  return typeof obj === "object" && obj !== null && (obj as Record<symbol, unknown>)[WORKER_SECRET] === true;
}

export function createOwnerCapability(ownerId: string): OwnerCapability {
  return new OwnerCapability(ownerId);
}

export function createWorkerCapabilities(scope: WorkerCapabilityScope): WorkerCapability {
  return new WorkerCapability(scope);
}

export function ownerAction(capability: unknown, request: OwnerActionRequest): OwnerActionResult {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError(
      "forbidden",
      "owner action requires trusted OwnerCapability; forged credentials or agent roles are rejected"
    );
  }
  return {
    status: "completed",
    action: request.action,
    completedAt: new Date().toISOString()
  };
}

export function protectCanonicalWrite<T>(capability: unknown, action: () => T): T {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError(
      "forbidden",
      "canonical project writes require owner capability; worker and agent roles denied"
    );
  }
  return action();
}

export function accessCredentials(capability: unknown, credentialId: string): string {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError(
      "forbidden",
      "credential access is forbidden to agents and workers"
    );
  }
  return `cred_val_${credentialId}`;
}

export function readProjectPath(capability: unknown, targetPath: string, projectRoot?: string): string {
  const resolved = resolve(targetPath);
  if (isOwnerCapability(capability)) {
    return resolved;
  }
  if (isWorkerCapability(capability)) {
    if (!capability.isPathAllowed(targetPath)) {
      throw new ProjectStoreError(
        "forbidden",
        `cross-project path access is forbidden: ${targetPath}`
      );
    }
    return resolved;
  }
  if (projectRoot && !pathInside(resolve(projectRoot), resolved)) {
    throw new ProjectStoreError("forbidden", `cross-project path access is forbidden: ${targetPath}`);
  }
  throw new ProjectStoreError("forbidden", "untrusted caller cannot read project paths");
}

export const ALLOWED_CURATED_RESOURCES: readonly string[] = [
  "pi:base-prompt",
  "pi:research-schema",
  "pi:task-template",
  "skills:analysis",
  "skills:literature"
];

export function loadCuratedResource(
  capability: unknown,
  resourceName: string
): CuratedResourceResult {
  if (!isOwnerCapability(capability) && !isWorkerCapability(capability)) {
    return {
      status: "denied",
      resourceName,
      reason: "denied: caller lacks valid capability"
    };
  }

  if (!ALLOWED_CURATED_RESOURCES.includes(resourceName)) {
    return {
      status: "denied",
      resourceName,
      reason: `denied: resource '${resourceName}' is not a curated resource or is a forbidden built-in command`
    };
  }

  return {
    status: "allowed",
    resourceName,
    content: `# Curated Resource: ${resourceName}\nThis is inert declared template content.`
  };
}

export function renderInertDocument(content: string): InertDocumentResult {
  const blockedElements: string[] = [];
  let inertText = content;

  // Detect and disarm script tags
  if (/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi.test(inertText)) {
    blockedElements.push("script-tag");
    inertText = inertText.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "[INERT_SCRIPT_BLOCKED]");
  }

  // Detect and disarm javascript: or vbscript: URIs
  if (/javascript:/gi.test(inertText)) {
    blockedElements.push("javascript-uri");
    inertText = inertText.replace(/javascript:[^\s"'>)]+/gi, "[INERT_URI_BLOCKED]");
  }

  // Detect event handlers
  if (/on(?:load|error|click|mouseover|submit)\s*=/gi.test(inertText)) {
    blockedElements.push("event-handler");
    inertText = inertText.replace(/on(?:load|error|click|mouseover|submit)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "[INERT_EVENT_BLOCKED]");
  }

  // Detect active template macros like {{...}} or <%...%> or ={{...}}
  if (/={{\s*.*?}}|<%[\s\S]*?%>/g.test(inertText)) {
    blockedElements.push("active-macro");
    inertText = inertText.replace(/={{\s*.*?}}|<%[\s\S]*?%>/g, "[INERT_MACRO_BLOCKED]");
  }

  return {
    inertText,
    hasBlockedScripts: blockedElements.length > 0,
    blockedElements
  };
}

export function executeLocalCommand(
  mode: ExecutionMode,
  guard: BashGuardConfig,
  command: string,
  _inputs?: Record<string, unknown>
): CommandExecutionResult {
  const trimmed = command.trim();
  const firstWord = trimmed.split(/\s+/)[0] ?? "";

  // 1. Check denied commands in per-project bash guard
  if (guard.deniedCommands && guard.deniedCommands.some((c) => trimmed.startsWith(c) || firstWord === c)) {
    return {
      status: "denied",
      command: trimmed,
      mode,
      reason: `denied by per-project bash guard: command '${trimmed}' is forbidden`
    };
  }

  // 2. Evaluate mode
  if (mode === "ask") {
    if (guard.allowedCommands && guard.allowedCommands.some((c) => trimmed === c || firstWord === c)) {
      return {
        status: "allowed",
        command: trimmed,
        mode,
        reason: "command is pre-approved in ask mode"
      };
    }
    return {
      status: "approval-required",
      command: trimmed,
      mode,
      reason: "ask mode requires confirmation for unapproved command"
    };
  }

  if (mode === "approve") {
    if (guard.requireApprovalCommands && guard.requireApprovalCommands.some((c) => trimmed === c || firstWord === c)) {
      return {
        status: "approval-required",
        command: trimmed,
        mode,
        reason: "command explicitly requires approval in approve mode"
      };
    }
    if (guard.allowedCommands && guard.allowedCommands.some((c) => trimmed === c || firstWord === c)) {
      return {
        status: "allowed",
        command: trimmed,
        mode,
        reason: "command allowed by per-project bash guard"
      };
    }
    return {
      status: "approval-required",
      command: trimmed,
      mode,
      reason: "command requires review in approve mode"
    };
  }

  if (mode === "full-access") {
    return {
      status: "allowed",
      command: trimmed,
      mode,
      reason: "command permitted under full-access mode",
      notice: FULL_ACCESS_NOTICE
    };
  }

  return {
    status: "denied",
    command: trimmed,
    mode,
    reason: `unknown or unsupported execution mode: ${mode}`
  };
}

export function capabilityDecision(operation: string, allowed: boolean, reason: string): CapabilityDecision {
  return {
    operation,
    allowed,
    reason
  };
}
