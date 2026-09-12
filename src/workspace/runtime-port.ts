import { join } from "node:path";
import {
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  InteractiveMode,
  SessionManager,
  type AgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory
} from "@earendil-works/pi-coding-agent";
import type { TuiPort, WorkspacePorts, WorkspaceRuntimeOptions } from "./workspace-types.js";

export class PiWorkspaceRuntimePort {
  async create(options: WorkspaceRuntimeOptions): Promise<AgentSessionRuntime> {
    const createRuntime: CreateAgentSessionRuntimeFactory = async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
      const services = await createAgentSessionServices({
        cwd,
        agentDir,
        resourceLoaderOptions: {
          noExtensions: true,
          extensionFactories: [...(options.extensionFactories ?? [])]
        }
      });
      return {
        ...(await createAgentSessionFromServices({ services, sessionManager, sessionStartEvent })),
        services,
        diagnostics: services.diagnostics
      };
    };
    return createAgentSessionRuntime(createRuntime, {
      cwd: options.cwd,
      agentDir: options.agentDir,
      sessionManager: SessionManager.create(options.cwd, join(options.agentDir, "sessions"))
    });
  }

  async dispose(runtime: object): Promise<void> {
    await (runtime as AgentSessionRuntime).dispose();
  }
}

export class PiWorkspaceTuiPort implements TuiPort {
  async run(runtime: object, options: { readonly projectRoot: string; readonly agentDir: string; readonly ownerId: string }): Promise<void> {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = options.agentDir;
    try {
      const mode = new InteractiveMode(runtime as AgentSessionRuntime, {
        migratedProviders: [],
        initialImages: [],
        initialMessages: [],
        autoTrustOnReloadCwd: options.projectRoot
      });
      await mode.run();
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  }

  confirm(): Promise<boolean> {
    throw new Error("workspace confirmation must use the bound Pi extension UI");
  }

  notify(): void {
    // Interactive extension commands own their notifications.
  }
}

export function createWorkspacePorts(): WorkspacePorts {
  return { runtime: new PiWorkspaceRuntimePort(), tui: new PiWorkspaceTuiPort() };
}
