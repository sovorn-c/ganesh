import type { InlineExtension } from "@earendil-works/pi-coding-agent";
import type { OwnerCapability } from "../authority/capability-broker.js";
import type { ProjectHandle } from "../project/project-types.js";

export interface WorkspaceRuntimeOptions {
  readonly cwd: string;
  readonly agentDir: string;
  readonly projectRoot: string;
  readonly ownerId: string;
  readonly extensionFactories?: readonly InlineExtension[];
}

export interface WorkspaceRuntimePort {
  create(options: WorkspaceRuntimeOptions): object | Promise<object>;
  dispose?(runtime: object): void | Promise<void>;
}

export interface WorkspaceTuiOptions {
  readonly projectRoot: string;
  readonly agentDir: string;
  readonly ownerId: string;
}

export interface TuiPort {
  run(runtime: object, options: WorkspaceTuiOptions): void | Promise<void>;
  confirm(title: string, message: string): boolean | Promise<boolean>;
  notify?(message: string, type?: "info" | "warning" | "error"): void;
}

export interface WorkspacePorts {
  readonly runtime: WorkspaceRuntimePort;
  readonly tui: TuiPort;
}

export interface WorkspaceIntakeState {
  readonly lateEntry: boolean;
  readonly stagePipeline: false;
  readonly currentRecords: readonly string[];
}

export interface WorkspaceSession {
  readonly handle: ProjectHandle;
  readonly ownerCapability: OwnerCapability;
  readonly runtimeOptions: WorkspaceRuntimeOptions;
  readonly intake: WorkspaceIntakeState;
  readonly ports: WorkspacePorts;
}

export type WorkspaceLaunchErrorCode =
  | "missing-folder"
  | "not-a-directory"
  | "unreadable"
  | "path-escape"
  | "invalid-project"
  | "launch-failed";

export interface WorkspaceLaunchError {
  readonly code: WorkspaceLaunchErrorCode;
  readonly message: string;
}

export interface WorkspaceLaunchRequest {
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly ownerId?: string;
  readonly allowedRoot?: string;
  readonly ports?: WorkspacePorts;
}

export interface WorkspaceLaunchResult {
  readonly status: "created" | "reopened" | "failed";
  readonly message: string;
  readonly session?: WorkspaceSession;
  readonly error?: WorkspaceLaunchError;
}
