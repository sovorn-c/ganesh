import { spawn } from "node:child_process";
import { pathInside } from "../persistence/storage-utils.js";
import { authorizeSourceHandoff, inspectSource, type SourceInspectionRequest } from "../sources/source-access.js";
import { listSourceLocators } from "../sources/source-store.js";
import type { DisclosureOperationKind } from "../policy/disclosure-types.js";
import type { SourceLocator } from "../sources/source-types.js";
import type { TuiPort, WorkspaceSession } from "./workspace-types.js";

export interface InspectionView {
  readonly status: "allowed" | "denied";
  readonly sourceVersionId: string;
  readonly format?: string;
  readonly access?: string;
  readonly extractionStatus?: string;
  readonly integrity?: string;
  readonly locators: readonly SourceLocator[];
  readonly limitations: readonly string[];
  readonly diagnostics: readonly Record<string, unknown>[];
  readonly content?: string;
  readonly text: string;
  readonly reason?: string;
}

export interface ViewerRequest {
  readonly sourceVersionId: string;
  readonly purpose?: string;
  readonly locatorId?: string;
  readonly correlationId?: string;
}

export interface ViewerResult {
  readonly status: "launched" | "denied" | "unavailable";
  readonly sourceVersionId: string;
  readonly reason: string;
  readonly path?: string;
}

export interface LocalViewerPort {
  launch(path: string): void | Promise<void>;
}

function safeDiagnostic(diagnostic: Record<string, unknown>): Record<string, unknown> {
  const detail = typeof diagnostic.detail === "string"
    ? diagnostic.detail.slice(0, 240).replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s]+/g, "[path]")
    : undefined;
  return {
    code: typeof diagnostic.code === "string" ? diagnostic.code : "diagnostic",
    severity: diagnostic.severity === "warning" || diagnostic.severity === "error" ? diagnostic.severity : "info",
    count: Number.isFinite(Number(diagnostic.count)) ? Number(diagnostic.count) : 1,
    ...(detail === undefined ? {} : { detail })
  };
}

function inspectionText(view: Omit<InspectionView, "text">): string {
  const source = view.sourceVersionId;
  const lines = [
    `Source ${source}: ${view.status}`,
    `Format: ${view.format ?? "unavailable"}`,
    `Access: ${view.access ?? "unavailable"}`,
    `Extraction: ${view.extractionStatus ?? "unavailable"}`,
    `Integrity: ${view.integrity ?? "unavailable"}`,
    `Locators: ${view.locators.length}`,
    `Limitations: ${view.limitations.length === 0 ? "none" : view.limitations.join(", ")}`
  ];
  if (view.content !== undefined) {
    lines.push(`Located content available: ${view.content.length} characters`);
  } else {
    lines.push("Located content unavailable; no quotation was fabricated");
  }
  if (view.reason !== undefined) { lines.push(`Reason: ${view.reason}`); }
  return lines.join("\n");
}

export function presentInspection(session: WorkspaceSession, request: SourceInspectionRequest): InspectionView {
  const inspection = inspectSource(session.handle, session.ownerCapability, request);
  if (inspection.status === "denied" || inspection.source === undefined) {
    const denied: Omit<InspectionView, "text"> = {
      status: "denied", sourceVersionId: request.sourceVersionId, locators: [], limitations: [], diagnostics: [], reason: inspection.reason
    };
    return { ...denied, text: inspectionText(denied) };
  }
  const locators = listSourceLocators(session.handle, request.sourceVersionId);
  const allowed: Omit<InspectionView, "text"> = {
    status: "allowed",
    sourceVersionId: request.sourceVersionId,
    format: inspection.source.format,
    access: inspection.source.access,
    extractionStatus: inspection.extractionStatus,
    integrity: inspection.integrity,
    locators,
    limitations: inspection.limitations,
    diagnostics: (inspection.diagnostics ?? []).map(safeDiagnostic),
    ...(inspection.content === undefined ? {} : { content: inspection.content }),
    ...(inspection.reason === undefined ? {} : { reason: inspection.reason })
  };
  return { ...allowed, text: inspectionText(allowed) };
}

export async function openLocalViewer(
  session: WorkspaceSession,
  request: ViewerRequest,
  viewer: LocalViewerPort
): Promise<ViewerResult> {
  const decision = authorizeSourceHandoff(session.handle, session.ownerCapability, {
    sourceVersionId: request.sourceVersionId,
    locatorId: request.locatorId,
    operation: "inspection" as DisclosureOperationKind,
    destination: "local",
    purpose: request.purpose ?? "owner evidence inspection",
    correlationId: request.correlationId,
    actor: session.ownerCapability.ownerId
  });
  if (decision.status !== "allow" || decision.path === undefined) {
    return { status: "denied", sourceVersionId: request.sourceVersionId, reason: decision.reason };
  }
  if (!pathInside(session.handle.project.artifactRoot, decision.path)) {
    return { status: "denied", sourceVersionId: request.sourceVersionId, reason: "denied: viewer path is outside the project artifact root" };
  }
  try {
    await viewer.launch(decision.path);
    return { status: "launched", sourceVersionId: request.sourceVersionId, path: decision.path, reason: "local viewer launched" };
  } catch {
    return { status: "unavailable", sourceVersionId: request.sourceVersionId, reason: "local viewer is unavailable" };
  }
}

export const nativeLocalViewerPort: LocalViewerPort = {
  launch(path: string): Promise<void> {
    const command = process.platform === "darwin" ? "open" : "xdg-open";
    return new Promise((resolve, reject) => {
      const child = spawn(command, [path], { shell: false, stdio: "ignore", detached: false });
      child.once("error", reject);
      child.once("spawn", () => resolve());
    });
  }
};

export function notifyInspection(tui: Pick<TuiPort, "notify">, view: InspectionView): void {
  tui.notify?.(view.text, view.status === "allowed" ? "info" : "warning");
}
