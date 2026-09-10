// story: e01s02
export const EXECUTION_MODES = ["ask", "approve", "full-access"] as const;
export type ExecutionMode = (typeof EXECUTION_MODES)[number];
export type CheckStatus =
  | "ready"
  | "warning"
  | "blocking"
  | "missing"
  | "unsupported"
  | "invalid"
  | "not_configured";
export type AggregateStatus = "ready" | "warning" | "blocked";

export interface ToolRequirement {
  readonly name: string;
  readonly command?: string;
  readonly minVersion?: string;
  readonly required?: boolean;
}

export interface PreflightCheck {
  readonly id: string;
  readonly status: CheckStatus;
  readonly required: boolean;
  readonly evidence: string;
  readonly remediation?: string;
}

export interface ExecutionModeReport {
  readonly value: string | null;
  readonly status: "ready" | "not_configured" | "invalid";
  readonly notice: string;
}

export interface PreflightReport {
  readonly schemaVersion: 1;
  readonly status: AggregateStatus;
  readonly exitCode: 0 | 1;
  readonly checks: readonly PreflightCheck[];
  readonly executionMode: ExecutionModeReport;
}

export interface PreflightOptions {
  readonly projectRoot?: string;
  readonly runtimeVersion?: string;
  readonly npmVersion?: string | null;
  readonly dependenciesReady?: boolean;
  readonly executionMode?: string | null;
  readonly requiredTools?: readonly ToolRequirement[];
  readonly availableTools?: Readonly<Record<string, boolean>>;
  readonly toolVersions?: Readonly<Record<string, string>>;
}

export interface ProjectConfig {
  readonly executionMode?: string | null;
  readonly requiredTools: readonly ToolRequirement[];
  readonly error?: string;
}
