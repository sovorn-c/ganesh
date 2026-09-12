import { compareBranchReferences, listAlternativeImpact } from "../decisions/alternative-store.js";
import type { WorkspaceSession } from "./workspace-types.js";

export interface HelpAction {
  readonly command: string;
  readonly label: string;
  readonly description: string;
}

export interface HelpView {
  readonly title: string;
  readonly actions: readonly HelpAction[];
  readonly text: string;
}

export interface AlternativeView {
  readonly sourceBranchId: string;
  readonly destinationBranchId: string;
  readonly differences: ReturnType<typeof compareBranchReferences>["differences"];
  readonly impacts: ReturnType<typeof listAlternativeImpact>;
  readonly adopted: false;
  readonly text: string;
}

const HELP_ACTIONS: readonly HelpAction[] = [
  { command: "/ganesh-help", label: "Help", description: "show workspace actions and keyboard guidance" },
  { command: "/ganesh-alternatives", label: "Alternatives", description: "inspect branch candidates and impacts without adopting them" },
  { command: "/ganesh-confirm", label: "Confirm exact version", description: "review and confirm one displayed decision packet" },
  { command: "/ganesh-inspect", label: "Inspect evidence", description: "read source access, extraction, integrity and locator limits" },
  { command: "/ganesh-cancel", label: "Cancel work", description: "fence a run or contract through the existing work APIs" }
];

function formatAlternativeText(view: Pick<AlternativeView, "sourceBranchId" | "destinationBranchId" | "differences" | "impacts">): string {
  const differences = view.differences.length === 0
    ? "none"
    : view.differences.map((difference) => `${difference.logicalId}: ${difference.sourceArtifactVersionId ?? "none"} -> ${difference.destinationArtifactVersionId ?? "none"}`).join("; ");
  const impacts = view.impacts.length === 0
    ? "none"
    : view.impacts.map((impact) => `${impact.dependentVersionId} (${impact.reviewStatus})`).join("; ");
  return `Alternatives ${view.sourceBranchId} -> ${view.destinationBranchId}\nDifferences: ${differences}\nImpacts: ${impacts}\nNo branch was adopted.`;
}

export function presentHelp(_session: WorkspaceSession): HelpView {
  const text = HELP_ACTIONS.map((action) => `${action.command}: ${action.description}`).join("\n");
  return { title: "Ganesh workspace help", actions: HELP_ACTIONS, text };
}

export function presentAlternatives(
  session: WorkspaceSession,
  sourceBranchId = "main",
  destinationBranchId = "main"
): AlternativeView {
  const comparison = compareBranchReferences(session.handle, sourceBranchId, destinationBranchId);
  const impacts = listAlternativeImpact(session.handle, destinationBranchId);
  const view: Omit<AlternativeView, "text"> = {
    sourceBranchId,
    destinationBranchId,
    differences: comparison.differences,
    impacts,
    adopted: false
  };
  return { ...view, text: formatAlternativeText(view) };
}

