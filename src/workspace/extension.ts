import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";
import { confirmExactVersion } from "./confirmation.js";
import { openLocalViewer, presentInspection, nativeLocalViewerPort } from "./evidence.js";
import { cancelFromWorkspace } from "./status.js";
import { presentAlternatives, presentHelp } from "./steering.js";
import type { WorkspaceSession } from "./workspace-types.js";

type WorkspaceCommandRegistrar = Pick<ExtensionAPI, "registerCommand">;

export function registerWorkspaceCommands(pi: WorkspaceCommandRegistrar, session: WorkspaceSession): void {
  pi.registerCommand("ganesh-help", {
    description: "Show Ganesh workspace help",
    handler: async (_args, ctx) => {
      ctx.ui.notify(presentHelp(session).text, "info");
    }
  });
  pi.registerCommand("ganesh-alternatives", {
    description: "Inspect research alternatives without adopting one",
    handler: async (args, ctx) => {
      const [source = "main", destination = "main"] = args.trim().split(/\s+/).filter(Boolean);
      try {
        ctx.ui.notify(presentAlternatives(session, source, destination).text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "alternatives are unavailable", "warning");
      }
    }
  });
  pi.registerCommand("ganesh-confirm", {
    description: "Confirm the exact versions displayed in a decision packet",
    handler: async (args, ctx) => {
      const packetId = args.trim();
      if (packetId === "") {
        ctx.ui.notify("Usage: /ganesh-confirm <packet-id>", "warning");
        return;
      }
      try {
        const result = await confirmExactVersion(session, {
          packetId,
          commandId: `workspace-confirm-${packetId}-${Date.now()}`
        }, ctx.ui);
        ctx.ui.notify(result.reason, result.status === "committed" ? "info" : "warning");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "confirmation failed", "warning");
      }
    }
  });
  pi.registerCommand("ganesh-inspect", {
    description: "Inspect saved evidence honestly and offline",
    handler: async (args, ctx) => {
      const sourceVersionId = args.trim();
      if (sourceVersionId === "") {
        ctx.ui.notify("Usage: /ganesh-inspect <source-version-id>", "warning");
        return;
      }
      try {
        ctx.ui.notify(presentInspection(session, { sourceVersionId }).text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "inspection failed", "warning");
      }
    }
  });
  pi.registerCommand("ganesh-viewer", {
    description: "Request a native local viewer for saved evidence",
    handler: async (args, ctx) => {
      const sourceVersionId = args.trim();
      if (sourceVersionId === "") {
        ctx.ui.notify("Usage: /ganesh-viewer <source-version-id>", "warning");
        return;
      }
      const result = await openLocalViewer(session, { sourceVersionId }, nativeLocalViewerPort);
      ctx.ui.notify(result.reason, result.status === "launched" ? "info" : "warning");
    }
  });
  pi.registerCommand("ganesh-cancel", {
    description: "Cancel a bounded run and show its fence status",
    handler: async (args, ctx) => {
      const runId = args.trim();
      if (runId === "") {
        ctx.ui.notify("Usage: /ganesh-cancel <run-id>", "warning");
        return;
      }
      try {
        ctx.ui.notify(cancelFromWorkspace(session, { runId }).text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "cancellation failed", "warning");
      }
    }
  });
}

export function createWorkspaceExtensions(session: WorkspaceSession): readonly InlineExtension[] {
  return [{
    name: "ganesh-workspace",
    hidden: true,
    factory: (pi) => registerWorkspaceCommands(pi, session)
  }];
}
