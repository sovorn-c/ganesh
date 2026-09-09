// story: e01s02
import { resolve } from "node:path";
import {
  aggregateStatus,
  checkExecutionMode,
  checkNodeRuntime,
  checkPackageManager,
  checkProjectConfiguration,
  checkProjectDependencies,
  checkRequiredTools,
  readNpmVersion
} from "./preflight-checks.js";
import {
  hasProjectDependencies,
  readPackageJson,
  readProjectConfig
} from "./preflight-config.js";
import type { PreflightCheck, PreflightOptions, PreflightReport } from "./preflight-types.js";

export { EXECUTION_MODES } from "./preflight-types.js";
export type {
  AggregateStatus,
  CheckStatus,
  ExecutionMode,
  ExecutionModeReport,
  PreflightCheck,
  PreflightOptions,
  PreflightReport,
  ProjectConfig,
  ToolRequirement
} from "./preflight-types.js";

export function runPreflight(options: PreflightOptions = {}): PreflightReport {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const config = readProjectConfig(projectRoot);
  const packageJson = readPackageJson(projectRoot);
  const executionMode = resolveExecutionMode(options, config.executionMode);
  const requiredTools = options.requiredTools ?? config.requiredTools;
  const dependenciesReady = options.dependenciesReady
    ?? hasProjectDependencies(projectRoot, packageJson);
  const npmVersion = options.npmVersion === undefined
    ? readNpmVersion()
    : options.npmVersion;

  const checks: PreflightCheck[] = [
    checkNodeRuntime(options.runtimeVersion ?? process.versions.node),
    checkPackageManager(packageJson, npmVersion),
    checkProjectDependencies(packageJson, dependenciesReady),
    checkProjectConfiguration(config),
    checkRequiredTools(requiredTools, options)
  ];
  const modeResult = checkExecutionMode(executionMode);
  checks.push(modeResult.check);

  const status = aggregateStatus(checks);
  return {
    schemaVersion: 1,
    status,
    exitCode: status === "blocked" ? 1 : 0,
    checks,
    executionMode: modeResult.report
  };
}

export function renderJson(report: PreflightReport): string {
  return JSON.stringify(redactReport(report), null, 2);
}

export function renderHuman(report: PreflightReport): string {
  const lines = [`Ganesh preflight: ${report.status.toUpperCase()} (exit ${report.exitCode})`];
  for (const check of report.checks) {
    const remediation = check.remediation
      ? ` — ${redactDiagnostic(check.remediation)}`
      : "";
    lines.push(
      `[${check.status}] ${check.id}: ${redactDiagnostic(check.evidence)}${remediation}`
    );
  }
  const mode = report.executionMode.value === null
    ? "not configured"
    : redactDiagnostic(report.executionMode.value);
  lines.push(`execution-mode: ${mode}`);
  lines.push(`notice: ${redactDiagnostic(report.executionMode.notice)}`);
  return lines.join("\n");
}

export function redactDiagnostic(value: string): string {
  return value
    .replace(
      /((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

function resolveExecutionMode(
  options: PreflightOptions,
  configuredMode: string | null | undefined
): string | null | undefined {
  if (options.executionMode !== undefined) {
    return options.executionMode;
  }
  return configuredMode ?? readExecutionModeFromEnvironment();
}

function readExecutionModeFromEnvironment(): string | undefined {
  return process.env.GANESH_EXECUTION_MODE;
}

function redactReport(report: PreflightReport): PreflightReport {
  return {
    ...report,
    checks: report.checks.map((check) => ({
      ...check,
      evidence: redactDiagnostic(check.evidence),
      ...(check.remediation === undefined
        ? {}
        : { remediation: redactDiagnostic(check.remediation) })
    })),
    executionMode: {
      ...report.executionMode,
      value: report.executionMode.value === null
        ? null
        : redactDiagnostic(report.executionMode.value),
      notice: redactDiagnostic(report.executionMode.notice)
    }
  };
}
