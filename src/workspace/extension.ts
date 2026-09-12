import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext, InlineExtension } from "@earendil-works/pi-coding-agent";
import type { DecisionAction } from "../decisions/decision-types.js";
import { qualifyAccessPath } from "./access-path.js";
import { keyboardMapComplete } from "./keyboard.js";
import { confirmExactVersion } from "./confirmation.js";
import { openLocalViewer, presentInspection, nativeLocalViewerPort } from "./evidence.js";
import { cancelFromWorkspace, presentWorkStatus } from "./status.js";
import { presentAlternatives, presentHelp } from "./steering.js";
import type { WorkspaceSession } from "./workspace-types.js";

type WorkspaceCommandRegistrar = Pick<ExtensionAPI, "registerCommand" | "registerShortcut">;

function workRequest(identifier: string): { readonly runId: string } | { readonly contractId: string } {
  return identifier.startsWith("run-") ? { runId: identifier } : { contractId: identifier };
}

const focusOrder = ["intake.continue", "help", "alternatives", "confirm", "reject", "defer", "inspect", "viewer", "cancel-run", "status", "access-path"] as const;
const focusIndexes = new WeakMap<WorkspaceSession, number>();

function moveFocus(session: WorkspaceSession, direction: 1 | -1): string {
  const current = focusIndexes.get(session) ?? 0;
  const next = (current + direction + focusOrder.length) % focusOrder.length;
  focusIndexes.set(session, next);
  return `Focused workspace control: ${focusOrder[next]}`;
}

function terminalAccessPath() {
  const locale = process.env.LC_ALL || process.env.LC_CTYPE || process.env.LANG || "";
  return qualifyAccessPath({
    keyboard: process.stdin.isTTY === true,
    textStatus: true,
    utf8: /utf-?8/i.test(locale),
    keyboardMapComplete: keyboardMapComplete(),
    textTerminal: process.stdout.isTTY === true,
    pointerOnly: false,
    ...(process.env.TERM === undefined ? {} : { terminal: process.env.TERM })
  });
}

async function confirmCommand(
  session: WorkspaceSession,
  args: string,
  ctx: ExtensionContext,
  action: DecisionAction
): Promise<void> {
  const packetId = args.trim();
  if (packetId === "") {
    ctx.ui.notify(`Usage: /ganesh-${action === "approved" ? "confirm" : action} <packet-id>`, "warning");
    return;
  }
  try {
    const result = await confirmExactVersion(session, {
      packetId,
      action,
      commandId: `workspace-${action}-${packetId}`
    }, ctx.ui);
    ctx.ui.notify(result.reason, result.status === "committed" ? "info" : "warning");
  } catch (error) {
    ctx.ui.notify(error instanceof Error ? error.message : "confirmation failed", "warning");
  }
}

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
  for (const [name, action] of [["ganesh-confirm", "approved"], ["ganesh-reject", "rejected"], ["ganesh-defer", "deferred"]] as const) {
    pi.registerCommand(name, {
      description: `${action} the exact versions displayed in a decision packet`,
      handler: async (args, ctx) => confirmCommand(session, args, ctx, action)
    });
  }
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
  pi.registerCommand("ganesh-status", {
    description: "Show readable live work status and remaining budget",
    handler: async (args, ctx) => {
      const identifier = args.trim();
      ctx.ui.notify(presentWorkStatus(session, identifier === "" ? {} : workRequest(identifier)).text, "info");
    }
  });
  pi.registerCommand("ganesh-access", {
    description: "Qualify this terminal access path and report blockers",
    handler: async (_args, ctx) => {
      const result = terminalAccessPath();
      ctx.ui.notify(`Access path: ${result.status}${result.reason === undefined ? "" : ` (${result.reason})`}`, result.accessible ? "info" : "warning");
    }
  });
  pi.registerCommand("ganesh-cancel", {
    description: "Cancel a bounded run or contract and show its fence status",
    handler: async (args, ctx) => {
      const identifier = args.trim();
      if (identifier === "") {
        ctx.ui.notify("Usage: /ganesh-cancel <run-id|contract-id>", "warning");
        return;
      }
      try {
        ctx.ui.notify(cancelFromWorkspace(session, workRequest(identifier)).text, "info");
      } catch (error) {
        ctx.ui.notify(error instanceof Error ? error.message : "cancellation failed", "warning");
      }
    }
  });

  const shortcuts = [
    ["ctrl+enter", "intake"],
    ["alt+h", "help"],
    ["alt+a", "alternatives"],
    ["alt+y", "approved"],
    ["alt+n", "rejected"],
    ["alt+d", "deferred"],
    ["alt+i", "inspect"],
    ["alt+v", "viewer"],
    ["alt+c", "cancel"],
    ["alt+s", "status"],
    ["alt+x", "access"],
    ["ctrl+alt+right", "focus-next"],
    ["ctrl+alt+left", "focus-previous"]
  ] as const;
  for (const [shortcut, action] of shortcuts) {
    pi.registerShortcut(shortcut, {
      description: `Run the Ganesh ${action} action`,
      handler: async (ctx) => {
        if (action === "intake") {
          ctx.ui.notify("Current project records are ready; no stage pipeline is required.", "info");
          return;
        }
        if (action === "focus-next" || action === "focus-previous") {
          ctx.ui.notify(moveFocus(session, action === "focus-next" ? 1 : -1), "info");
          return;
        }
        if (action === "help") {
          ctx.ui.notify(presentHelp(session).text, "info");
          return;
        }
        if (action === "alternatives") {
          ctx.ui.notify(presentAlternatives(session).text, "info");
          return;
        }
        if (action === "access") {
          const result = terminalAccessPath();
          ctx.ui.notify(`Access path: ${result.status}${result.reason === undefined ? "" : ` (${result.reason})`}`, result.accessible ? "info" : "warning");
          return;
        }
        const prompt = action === "status" ? "run or contract id (leave empty for latest)" : action === "cancel" ? "run or contract id" : action === "inspect" || action === "viewer" ? "source version id" : "decision packet id";
        const identifier = await ctx.ui.input(`Ganesh ${action}`, prompt);
        if (identifier === undefined || (action === "cancel" && identifier.trim() === "")) {
          return;
        }
        if (action === "approved" || action === "rejected" || action === "deferred") {
          await confirmCommand(session, identifier, ctx, action);
        } else if (action === "inspect") {
          ctx.ui.notify(presentInspection(session, { sourceVersionId: identifier.trim() }).text, "info");
        } else if (action === "viewer") {
          const result = await openLocalViewer(session, { sourceVersionId: identifier.trim() }, nativeLocalViewerPort);
          ctx.ui.notify(result.reason, result.status === "launched" ? "info" : "warning");
        } else if (action === "cancel") {
          ctx.ui.notify(cancelFromWorkspace(session, workRequest(identifier.trim())).text, "info");
        } else {
          ctx.ui.notify(presentWorkStatus(session, identifier.trim() === "" ? {} : workRequest(identifier.trim())).text, "info");
        }
      }
    });
  }
}

export function createWorkspaceExtensions(session: WorkspaceSession): readonly InlineExtension[] {
  return [{
    name: "ganesh-workspace",
    hidden: true,
    factory: (pi) => registerWorkspaceCommands(pi, session)
  }];
}
