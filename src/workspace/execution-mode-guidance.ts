// story: e19s04

import { checkExecutionMode } from "../runtime/preflight-checks.js";
import type { ExecutionModeReport } from "../runtime/preflight-types.js";

export interface ExecutionModeGuidanceView {
  readonly report: ExecutionModeReport;
  readonly text: string;
}

export function presentExecutionModeGuidance(value?: string | null): ExecutionModeGuidanceView {
  const selected = value === undefined ? process.env.GANESH_EXECUTION_MODE : value;
  const { report } = checkExecutionMode(selected);
  const text = [
    `Execution mode: ${report.status}`,
    `Selected mode: ${report.value ?? "none"}`,
    report.notice,
    report.status === "not_configured" ? "Choose a mode explicitly when local execution is needed; Ganesh will not select one." : "Readiness does not grant research authority."
  ].join("\n");
  return { report, text };
}
