// story: e16s03 — Bounded Provider Retry, Rate, Time and Responsive Cancellation
import type { ProjectHandle } from "../project/project-types.js";
import type { BudgetDimension, WorkRunRecord, WorkContractRecord, DispatchOptions } from "./work-types.js";
import { getRun } from "./work-store.js";
import { getLifecycleOperation } from "../lifecycle/lifecycle-gate.js";
import { inspectBudget } from "./budget-ledger.js";
import { operationsSchemaAvailable, recordDiagnostic } from "../operations/diagnostic-store.js";
import { transaction } from "../persistence/schema.js";
import { newId } from "../persistence/storage-utils.js";
import { assertWritable } from "../project/project-store.js";

export interface AdmissionResult {
  readonly admitted: boolean;
  readonly reason?: "cancelled" | "fenced" | "time-exhausted" | "calls-exhausted" | "budget-exhausted" | "terminal";
  readonly reservationId?: string;
  readonly deadlineAt?: number;
}

function numeric(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function minimumInterval(contract: WorkContractRecord, options?: DispatchOptions): number {
  const configured = options?.minIntervalMs ?? Number((contract.scope as { minProviderIntervalMs?: unknown }).minProviderIntervalMs ?? 100);
  return Number.isFinite(configured) ? Math.max(0, configured) : 100;
}

function recordAdmissionDiagnostic(
  handle: ProjectHandle,
  run: WorkRunRecord,
  options: DispatchOptions | undefined,
  code: string,
  message: string
): void {
  if (!operationsSchemaAvailable(handle)) {
    return;
  }
  try {
    recordDiagnostic(handle, {
      correlationId: options?.correlationId ?? run.id,
      runId: run.id,
      commandId: run.commandId,
      kind: "budget-exhaustion",
      code,
      severity: "error",
      message
    });
  } catch {
    // Diagnostics must not turn a bounded admission decision into an unbounded failure.
  }
}

function waitForInterval(ms: number, signal: AbortSignal | undefined, wait?: (ms: number) => Promise<void>): Promise<void> {
  if (wait) {
    if (!signal) { return wait(ms); }
    if (signal.aborted) { return Promise.resolve(); }
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      const cleanup = (): void => signal.removeEventListener("abort", onAbort);
      const finish = (): void => {
        if (settled) { return; }
        settled = true;
        cleanup();
        resolve();
      };
      const fail = (error: unknown): void => {
        if (settled) { return; }
        settled = true;
        cleanup();
        reject(error);
      };
      const onAbort = (): void => finish();
      signal.addEventListener("abort", onAbort, { once: true });
      try {
        wait(ms).then(finish, fail);
      } catch (error) {
        fail(error);
      }
    });
  }
  return new Promise<void>((resolve) => {
    let timer: NodeJS.Timeout | undefined;
    const finish = (): void => {
      if (timer) {
        clearTimeout(timer);
      }
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    if (signal?.aborted) {
      finish();
      return;
    }
    timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export async function admitProviderAttempt(
  handle: ProjectHandle,
  run: WorkRunRecord,
  contract: WorkContractRecord,
  attempt: number,
  options?: DispatchOptions,
  consumedTimeMs = 0,
  consumedUsage: Partial<Record<BudgetDimension, number>> = {}
): Promise<AdmissionResult> {
  if (options?.signal?.aborted) {
    return { admitted: false, reason: "cancelled" };
  }

  let rejection: AdmissionResult | undefined;
  let reservationId: string | undefined;
  let deadlineAt: number | undefined;
  let availableTimeMs: number | undefined;
  let waitMs = 0;

  transaction(handle.db, () => {
    const currentRun = getRun(handle, run.id);
    const currentOp = getLifecycleOperation(handle, run.operationId);
    if (currentRun?.status === "succeeded" || currentRun?.status === "failed") {
      rejection = { admitted: false, reason: "terminal" };
      return;
    }
    if (currentRun?.status === "cancelled" || currentOp?.status === "cancelled") {
      rejection = { admitted: false, reason: "cancelled" };
      return;
    }
    if (currentOp?.status === "fenced") {
      rejection = { admitted: false, reason: "fenced" };
      return;
    }

    const budget = inspectBudget(handle, contract.id, contract.version);
    const timeReservation = numeric(run.reserved.timeMs);
    if (contract.limits.timeMs !== undefined) {
      const availableForRun = numeric(budget.remaining.timeMs) + timeReservation - consumedTimeMs;
      if (availableForRun <= 0) {
        rejection = { admitted: false, reason: "time-exhausted" };
        return;
      }
      availableTimeMs = availableForRun;
      deadlineAt = Date.now() + availableForRun;
    }

    for (const dimension of ["tokens", "spend"] as const) {
      const reserved = numeric(run.reserved[dimension]);
      const consumed = numeric(consumedUsage[dimension]);
      if (consumed >= reserved && consumed > 0) {
        rejection = { admitted: false, reason: "budget-exhausted" };
        return;
      }
    }

    const callReservation = handle.db
      .prepare("SELECT reserved FROM work_budget_ledger WHERE run_id = ? AND dimension = 'calls'")
      .get(run.id) as { reserved?: unknown } | undefined;
    const reservedCalls = numeric(callReservation?.reserved);
    const admittedCalls = Number((handle.db
      .prepare("SELECT COUNT(*) AS count FROM provider_attempt_reservations WHERE run_id = ?")
      .get(run.id) as { count?: unknown } | undefined)?.count ?? 0);
    const reportedCalls = numeric(consumedUsage.calls);
    if (reservedCalls <= Math.max(admittedCalls, reportedCalls)) {
      rejection = { admitted: false, reason: "calls-exhausted" };
      return;
    }

    const interval = minimumInterval(contract, options);
    const lastAttempt = handle.db
      .prepare(`
        SELECT MAX(created_at) AS created_at FROM (
          SELECT created_at FROM provider_attempts
          UNION ALL
          SELECT reserved_at AS created_at FROM provider_attempt_reservations
        )
      `)
      .get() as { created_at?: string } | undefined;
    const lastAt = lastAttempt?.created_at ? Date.parse(lastAttempt.created_at) : Number.NaN;
    const now = Date.now();
    const nextAt = Number.isFinite(lastAt) ? Math.max(now, lastAt + interval) : now;
    waitMs = Math.max(0, nextAt - now);
    reservationId = newId("attempt-reservation");
    handle.db
      .prepare("INSERT INTO provider_attempt_reservations (id, run_id, attempt, reserved_at) VALUES (?, ?, ?, ?)")
      .run(reservationId, run.id, attempt, new Date(nextAt).toISOString());
  });

  if (rejection) {
    if (rejection.reason === "time-exhausted") {
      recordAdmissionDiagnostic(handle, run, options, "time-exhausted", "remaining timeMs exhausted before provider attempt");
    } else if (rejection.reason === "calls-exhausted") {
      recordAdmissionDiagnostic(handle, run, options, "calls-exhausted", "reserved provider call budget exhausted before provider attempt");
    } else if (rejection.reason === "budget-exhausted") {
      recordAdmissionDiagnostic(handle, run, options, "budget-exhausted", "reported provider usage exhausted the reserved budget before provider attempt");
    }
    return rejection;
  }

  if (!reservationId) {
    return { admitted: false, reason: "time-exhausted" };
  }

  if (waitMs > 0) {
    try {
      await waitForInterval(waitMs, options?.signal, options?.wait);
    } catch (error) {
      releaseProviderAttemptReservation(handle, reservationId);
      throw error;
    }
  }

  const releaseIfNotAdmitted = (reason: AdmissionResult["reason"]): AdmissionResult => {
    releaseProviderAttemptReservation(handle, reservationId!);
    return { admitted: false, reason };
  };
  if (options?.signal?.aborted) {
    return releaseIfNotAdmitted("cancelled");
  }

  const postWaitRun = getRun(handle, run.id);
  const postWaitOp = getLifecycleOperation(handle, run.operationId);
  if (postWaitRun?.status === "succeeded" || postWaitRun?.status === "failed") {
    return releaseIfNotAdmitted("terminal");
  }
  if (postWaitRun?.status === "cancelled" || postWaitOp?.status === "cancelled") {
    return releaseIfNotAdmitted("cancelled");
  }
  if (postWaitOp?.status === "fenced") {
    return releaseIfNotAdmitted("fenced");
  }
  // The provider time budget applies to the call, not to an injected rate-limit wait.
  if (availableTimeMs !== undefined) {
    deadlineAt = Date.now() + availableTimeMs;
  }

  return { admitted: true, reservationId, deadlineAt };
}

export function releaseProviderAttemptReservation(handle: ProjectHandle, reservationId: string): void {
  assertWritable(handle);
  transaction(handle.db, () => {
    handle.db.prepare("DELETE FROM provider_attempt_reservations WHERE id = ?").run(reservationId);
  });
}
