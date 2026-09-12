import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createOwnerCapability } from "../authority/capability-broker.js";
import { createProject, openProject } from "../project/project-store.js";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { createWorkspacePorts } from "./runtime-port.js";
import { createWorkspaceExtensions } from "./extension.js";
import { resolveProjectFolder } from "./argv.js";
import type {
  WorkspaceLaunchErrorCode,
  WorkspaceLaunchRequest,
  WorkspaceLaunchResult,
  WorkspacePorts,
  WorkspaceRuntimeOptions,
  WorkspaceSession
} from "./workspace-types.js";

const STORE_DIRECTORY = ".ganesh";
const DATABASE_FILE = "project.sqlite";

function failure(code: WorkspaceLaunchErrorCode, message: string): WorkspaceLaunchResult {
  return { status: "failed", message, error: { code, message } };
}

function projectExists(root: string): boolean {
  return existsSync(join(root, STORE_DIRECTORY, DATABASE_FILE));
}

function hasIncompleteStore(root: string): boolean {
  return existsSync(join(root, STORE_DIRECTORY)) && !projectExists(root);
}

function errorResult(error: unknown): WorkspaceLaunchResult {
  if (error instanceof ProjectStoreError && error.code === "invalid-project") {
    return failure("invalid-project", error.message);
  }
  if (error instanceof ProjectStoreError && error.code === "project-not-found") {
    return failure("invalid-project", error.message);
  }
  return failure("launch-failed", error instanceof Error ? error.message : "workspace launch failed");
}

export async function runWorkspace(request: WorkspaceLaunchRequest): Promise<WorkspaceLaunchResult> {
  const folder = resolveProjectFolder(request.argv, request.cwd, request.allowedRoot);
  if (folder.status !== "resolved" || folder.path === undefined) {
    return failure(folder.code ?? "launch-failed", folder.message);
  }
  const root = folder.path;
  if (hasIncompleteStore(root)) {
    return failure("invalid-project", "project store exists but its database is missing");
  }

  const ownerId = request.ownerId ?? "local-owner";
  let handle: ProjectHandle | undefined;
  let status: "created" | "reopened";
  try {
    if (projectExists(root)) {
      handle = openProject(root);
      if (!handle.writable || handle.status !== "ready") {
        handle.close();
        return failure("invalid-project", handle.readonlyReason ?? `project opened ${handle.status}`);
      }
      status = "reopened";
    } else {
      handle = createProject({ rootPath: root, ownerId });
      status = "created";
    }
    const ownerCapability = createOwnerCapability(handle.project.ownerId);
    const agentDir = join(root, STORE_DIRECTORY, "pi");
    mkdirSync(agentDir, { recursive: true });
    const runtimeOptions: WorkspaceRuntimeOptions = {
      cwd: root,
      agentDir,
      projectRoot: root,
      ownerId: handle.project.ownerId
    };
    const ports: WorkspacePorts = request.ports ?? createWorkspacePorts();
    const session: WorkspaceSession = {
      handle,
      ownerCapability,
      runtimeOptions,
      intake: {
        lateEntry: status === "reopened",
        stagePipeline: false,
        currentRecords: ["project", "durable-research-records"]
      },
      ports
    };
    const runtime = await ports.runtime.create({
      ...runtimeOptions,
      extensionFactories: createWorkspaceExtensions(session)
    });
    let disposed = false;
    const disposeRuntime = async (): Promise<void> => {
      if (disposed) {
        return;
      }
      disposed = true;
      await ports.runtime.dispose?.(runtime);
    };
    const closeOnProcessExit = (): void => {
      handle?.close();
      void disposeRuntime();
    };
    process.once("exit", closeOnProcessExit);
    process.once("beforeExit", closeOnProcessExit);
    try {
      await ports.tui.run(runtime, { projectRoot: root, agentDir, ownerId: handle.project.ownerId });
      return {
        status,
        message: status === "created" ? "Ganesh workspace created; current records are ready" : "Ganesh workspace reopened; current records are ready",
        session
      };
    } finally {
      process.removeListener("exit", closeOnProcessExit);
      process.removeListener("beforeExit", closeOnProcessExit);
      await disposeRuntime();
    }
  } catch (error) {
    try { handle?.close(); } catch { /* preserve the bounded launch error */ }
    return errorResult(error);
  }
}
