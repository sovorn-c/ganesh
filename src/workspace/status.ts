import { cancelContract, cancelRun } from "../work/work-runtime.js";
import { inspectBudget } from "../work/budget-ledger.js";
import { getContract, getRun, listRuns } from "../work/work-store.js";
import type { BudgetInspection, SpecialistSessionPort, WorkRunRecord } from "../work/work-types.js";
import type { WorkspaceSession } from "./workspace-types.js";

export interface WorkStatusRequest {
  readonly runId?: string;
  readonly contractId?: string;
  readonly contractVersion?: number;
}

export interface StatusView {
  readonly runId?: string;
  readonly contractId?: string;
  readonly status: string;
  readonly remaining: Readonly<Record<string, number | "unlimited">>;
  readonly uncertain: boolean;
  readonly cancellation?: string;
  readonly text: string;
}

function statusLabel(status: WorkRunRecord["status"] | undefined): string {
  if (status === "running") {
    return "working";
  }
  return status ?? "no-selection";
}

function remainingFor(budget: BudgetInspection | undefined): Readonly<Record<string, number | "unlimited">> {
  const dimensions = ["tokens", "calls", "timeMs", "spend"] as const;
  return Object.fromEntries(dimensions.map((dimension) => [dimension, budget?.remaining[dimension] ?? "unlimited"]));
}

function statusText(view: Omit<StatusView, "text">): string {
  const remaining = Object.entries(view.remaining).map(([key, value]) => `${key}=${value}`).join(" ");
  return [
    `Status: ${view.status}`,
    `Remaining budget: ${remaining}`,
    `Spend certainty: ${view.uncertain ? "uncertain" : "known"}`,
    ...(view.cancellation === undefined ? [] : [`Cancellation: ${view.cancellation}`])
  ].join("\n");
}

function latestRun(runs: readonly WorkRunRecord[]): WorkRunRecord | undefined {
  return runs.reduce<WorkRunRecord | undefined>((latest, run) => latest === undefined || run.updatedAt >= latest.updatedAt ? run : latest, undefined);
}

function selectedRun(session: WorkspaceSession, request: WorkStatusRequest): WorkRunRecord | undefined {
  if (request.runId !== undefined) {
    return getRun(session.handle, request.runId) ?? undefined;
  }
  const runs = listRuns(session.handle, request.contractId);
  const active = runs.filter((run) => run.status === "queued" || run.status === "running" || run.status === "waiting-for-human" || run.status === "blocked");
  return latestRun(active.length > 0 ? active : runs);
}

function viewFor(run: WorkRunRecord | undefined, budget: BudgetInspection | undefined, cancellation?: string): StatusView {
  const view: Omit<StatusView, "text"> = {
    ...(run === undefined ? {} : { runId: run.id, contractId: run.contractId }),
    status: statusLabel(run?.status),
    remaining: remainingFor(budget),
    uncertain: budget?.uncertain ?? false,
    ...(cancellation === undefined ? {} : { cancellation })
  };
  return { ...view, text: statusText(view) };
}

export function presentWorkStatus(session: WorkspaceSession, request: WorkStatusRequest = {}): StatusView {
  const run = selectedRun(session, request);
  const contractId = request.contractId ?? run?.contractId;
  const budget = contractId === undefined ? undefined : inspectBudget(session.handle, contractId, request.contractVersion ?? run?.contractVersion);
  return viewFor(run, budget);
}

export function cancelFromWorkspace(
  session: WorkspaceSession,
  request: WorkStatusRequest & { readonly reason?: string; readonly sessionPort?: SpecialistSessionPort }
): StatusView {
  const reason = request.reason ?? "owner cancelled from workspace";
  if (request.runId !== undefined) {
    const run = cancelRun(session.handle, session.ownerCapability, { runId: request.runId, reason, sessionPort: request.sessionPort });
    return viewFor(run, inspectBudget(session.handle, run.contractId, run.contractVersion), "fenced; late output is quarantined");
  }
  if (request.contractId !== undefined) {
    const runs = cancelContract(session.handle, session.ownerCapability, { contractId: request.contractId, version: request.contractVersion, reason, sessionPort: request.sessionPort });
    const run = latestRun(runs);
    const budget = inspectBudget(session.handle, request.contractId, request.contractVersion);
    return viewFor(run, budget, "contract fenced; late output is quarantined");
  }
  return viewFor(undefined, undefined, "no run or contract selected");
}

export function statusForContract(session: WorkspaceSession, contractId: string, version?: number): StatusView {
  const contract = getContract(session.handle, contractId, version);
  if (contract === null) {
    return viewFor(undefined, undefined, "contract not found");
  }
  return presentWorkStatus(session, { contractId: contract.id, contractVersion: contract.version });
}
