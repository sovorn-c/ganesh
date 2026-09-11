// story: e05s01, e05s03
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { assertWritable } from "../project/project-store.js";
import { isoNow, newId } from "../persistence/storage-utils.js";
import { transaction } from "../persistence/schema.js";
import { assertWorkSchema, getContract } from "./work-store.js";
import type { BudgetDimension, BudgetInspection, BudgetReservation, BudgetSettlement, PriceQuote, WorkLimits } from "./work-types.js";

const DIMENSIONS: readonly BudgetDimension[] = ["tokens", "calls", "timeMs", "spend"];

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function limitsFor(contract: { limits: WorkLimits }): WorkLimits {
  return contract.limits;
}

function dimensionLimit(limits: WorkLimits, dimension: BudgetDimension): number | undefined {
  return limits[dimension];
}

function rootContractId(handle: ProjectHandle, contractId: string, version?: number): { group: string; id: string } {
  const contract = getContract(handle, contractId, version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${contractId}`);}
  return { group: contract.budgetGroupId, id: contract.id };
}

function totals(handle: ProjectHandle, group: string, dimension: BudgetDimension): { reserved: number; spent: number; uncertain: boolean } {
  const rows = handle.db.prepare("SELECT reserved, spent, uncertain FROM work_budget_ledger WHERE budget_group_id = ? AND dimension = ?").all(group, dimension) as Array<Record<string, unknown>>;
  return { reserved: rows.reduce((sum, row) => sum + numeric(row.reserved), 0), spent: rows.reduce((sum, row) => sum + numeric(row.spent), 0), uncertain: rows.some((row) => Number(row.uncertain) === 1) };
}

function validateRequested(dimensions: Partial<Record<BudgetDimension, number>>): void {
  for (const [dimension, value] of Object.entries(dimensions)) {
    if (!DIMENSIONS.includes(dimension as BudgetDimension) || value === undefined || !Number.isFinite(value) || value < 0) {
      throw new ProjectStoreError("invalid-limit", `budget ${dimension} must be finite and non-negative`);
    }
  }
}

export function quoteProviderPrice(destination: string, unit = "request"): PriceQuote {
  if (!destination || destination === "local") {return { status: "known", amount: 0, currency: "USD", unit };}
  return { status: "unknown", unit, reason: "provider pricing was not supplied" };
}

export function reserveBudget(handle: ProjectHandle, contractVersionId: string, runId: string, dimensions: Partial<Record<BudgetDimension, number>>, quote?: PriceQuote): BudgetReservation {
  assertWritable(handle); assertWorkSchema(handle); validateRequested(dimensions);
  const at = contractVersionId.lastIndexOf("@");
  const contractId = at > 0 ? contractVersionId.slice(0, at) : contractVersionId;
  const version = at > 0 ? Number(contractVersionId.slice(at + 1)) : undefined;
  const contract = getContract(handle, contractId, version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${contractVersionId}`);}
  if (contract.status !== "authorized") {return { status: "rejected", contractId: contract.id, runId, dimensions, reason: "contract is not authorized" };}
  if (getExistingReservation(handle, runId)) {return { status: "duplicate", contractId: contract.id, runId, dimensions, reason: "run already has a budget reservation" };}
  if (contract.limits.spend !== undefined && ((quote?.status ?? "unknown") !== "known" || dimensions.spend === undefined)) {
    return { status: "rejected", contractId: contract.id, runId, dimensions, reason: "known provider pricing is required for a spend cap" };
  }
  const group = contract.budgetGroupId;
  try {
    transaction(handle.db, () => {
      for (const dimension of DIMENSIONS) {
        const requested = dimensions[dimension] ?? 0;
        if (requested === 0) {continue;}
        const limit = dimensionLimit(contract.limits, dimension);
        if (limit === undefined) {continue;}
        const total = totals(handle, group, dimension);
        if (total.reserved + total.spent + requested > limit + Number.EPSILON) {
          throw new ProjectStoreError("budget-exhausted", `${dimension} budget is exhausted`);
        }
      }
      const now = isoNow();
      for (const dimension of DIMENSIONS) {
        const requested = dimensions[dimension] ?? 0;
        if (requested > 0) {handle.db.prepare("INSERT INTO work_budget_ledger (id, budget_group_id, contract_id, run_id, dimension, reserved, spent, uncertain, created_at) VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?)").run(newId("budget"), group, contract.id, runId, dimension, requested, now);}
      }
    });
  } catch (error) {
    if (error instanceof ProjectStoreError && error.code === "budget-exhausted") {return { status: "rejected", contractId: contract.id, runId, dimensions, reason: error.message };}
    throw error;
  }
  return { status: "reserved", contractId: contract.id, runId, dimensions };
}

function getExistingReservation(handle: ProjectHandle, runId: string): boolean {
  return handle.db.prepare("SELECT 1 FROM work_budget_ledger WHERE run_id = ? LIMIT 1").get(runId) !== undefined;
}

export function settleBudget(handle: ProjectHandle, runId: string, actuals: Partial<Record<BudgetDimension, number>>, uncertain = false): BudgetSettlement {
  assertWritable(handle); assertWorkSchema(handle); validateRequested(actuals);
  const rows = handle.db.prepare("SELECT * FROM work_budget_ledger WHERE run_id = ?").all(runId) as Array<Record<string, unknown>>;
  if (rows.length === 0) {return { status: "rejected", runId, spent: actuals, reason: "no reservation exists" };}
  if (uncertain) {
    transaction(handle.db, () => handle.db.prepare("UPDATE work_budget_ledger SET uncertain = 1 WHERE run_id = ?").run(runId));
    return { status: "held", runId, spent: actuals, reason: "provider usage is uncertain; reservation remains held" };
  }
  transaction(handle.db, () => {
    for (const row of rows) {
      const dimension = String(row.dimension) as BudgetDimension;
      const reserved = numeric(row.reserved);
      const spent = actuals[dimension] ?? 0;
      if (spent > reserved) {throw new ProjectStoreError("budget-exhausted", `${dimension} actual usage exceeds reservation`);}
      handle.db.prepare("UPDATE work_budget_ledger SET reserved = 0, spent = spent + ?, uncertain = 0 WHERE id = ?").run(spent, String(row.id));
    }
  });
  return { status: "settled", runId, spent: actuals };
}

export function inspectBudget(handle: ProjectHandle, contractId: string, version?: number): BudgetInspection {
  assertWorkSchema(handle);
  const contract = getContract(handle, contractId, version);
  if (!contract) {throw new ProjectStoreError("not-found", `work contract not found: ${contractId}`);}
  const reserved: Partial<Record<BudgetDimension, number>> = {};
  const spent: Partial<Record<BudgetDimension, number>> = {};
  const remaining: Partial<Record<BudgetDimension, number>> = {};
  let uncertain = false;
  for (const dimension of DIMENSIONS) {
    const total = totals(handle, contract.budgetGroupId, dimension);
    if (total.reserved > 0) {reserved[dimension] = total.reserved;}
    if (total.spent > 0) {spent[dimension] = total.spent;}
    const limit = dimensionLimit(contract.limits, dimension);
    if (limit !== undefined) {remaining[dimension] = Math.max(0, limit - total.reserved - total.spent);}
    uncertain ||= total.uncertain;
  }
  return { contractId: contract.id, limits: contract.limits, reserved, spent, remaining, uncertain };
}