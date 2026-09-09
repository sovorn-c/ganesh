import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

interface ProjectConfig {
  readonly executionMode?: string | null;
  readonly requiredTools: readonly ToolRequirement[];
  readonly error?: string;
}

const FULL_ACCESS_NOTICE =
  "full-access is an explicit local-risk choice; it is not a sandbox or containment guarantee.";
const CONFIG_FILE = "ganesh.config.json";

export function runPreflight(options: PreflightOptions = {}): PreflightReport {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const config = readProjectConfig(projectRoot);
  const packageJson = readPackageJson(projectRoot);
  const executionMode =
    options.executionMode !== undefined
      ? options.executionMode
      : config.executionMode ?? readExecutionModeFromEnvironment();
  const requiredTools = options.requiredTools ?? config.requiredTools;
  const dependenciesReady =
    options.dependenciesReady ?? hasProjectDependencies(projectRoot, packageJson);
  const npmVersion = options.npmVersion === undefined
    ? readNpmVersion()
    : options.npmVersion;

  const checks: PreflightCheck[] = [
    checkNodeRuntime(options.runtimeVersion ?? process.versions.node),
    checkPackageManager(packageJson, npmVersion),
    checkProjectDependencies(packageJson, dependenciesReady),
    checkProjectConfiguration(config),
    checkRequiredTools(requiredTools, options),
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
    const remediation = check.remediation ? ` — ${redactDiagnostic(check.remediation)}` : "";
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

export function redactDiagnostic(value: string): string {
  return value
    .replace(
      /((?:api[_-]?key|token|password|secret|authorization)\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;]+)/gi,
      "$1[REDACTED]"
    )
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]");
}

function checkNodeRuntime(version: string): PreflightCheck {
  const major = Number.parseInt(version.split(".", 1)[0] ?? "", 10);
  if (major === 24) {
    return readyCheck("node-runtime", true, `Node.js ${major}.x`);
  }
  return {
    id: "node-runtime",
    status: "unsupported",
    required: true,
    evidence: Number.isNaN(major) ? "Node.js version unavailable" : `Node.js ${major}.x`,
    remediation: "Use Node.js 24 LTS before running Ganesh."
  };
}

function checkPackageManager(
  packageJson: Record<string, unknown> | null,
  actualVersion: string | null
): PreflightCheck {
  const declared = packageJson?.packageManager;
  if (typeof declared !== "string" || !/^npm@\d+\.\d+\.\d+$/.test(declared)) {
    return {
      id: "package-manager",
      status: "blocking",
      required: true,
      evidence: "npm package-manager version is not declared",
      remediation: "Declare an exact npm version in package.json."
    };
  }
  if (actualVersion === null) {
    return {
      id: "package-manager",
      status: "missing",
      required: true,
      evidence: `declared ${declared}; npm is not available`,
      remediation: "Install the declared npm version or activate the supported Node.js toolchain."
    };
  }
  const observed = `npm@${actualVersion}`;
  if (observed !== declared) {
    return {
      id: "package-manager",
      status: "unsupported",
      required: true,
      evidence: `declared ${declared}; observed ${observed}`,
      remediation: `Use ${declared} for this project.`
    };
  }
  return readyCheck("package-manager", true, observed);
}

function checkProjectDependencies(
  packageJson: Record<string, unknown> | null,
  dependenciesReady: boolean
): PreflightCheck {
  if (packageJson === null) {
    return {
      id: "project-dependencies",
      status: "blocking",
      required: true,
      evidence: "package.json is unavailable",
      remediation: "Restore package.json and run npm ci."
    };
  }
  if (!dependenciesReady) {
    return {
      id: "project-dependencies",
      status: "missing",
      required: true,
      evidence: "one or more declared project packages are not installed",
      remediation: "Run npm ci from the project root."
    };
  }
  return readyCheck("project-dependencies", true, "declared project packages are installed");
}

function checkProjectConfiguration(config: ProjectConfig): PreflightCheck {
  if (config.error) {
    return {
      id: "project-configuration",
      status: "blocking",
      required: true,
      evidence: config.error,
      remediation: `Fix ${CONFIG_FILE}; do not put credentials or research content in it.`
    };
  }
  return readyCheck("project-configuration", false, `${CONFIG_FILE} is valid or not configured`);
}

function checkRequiredTools(
  tools: readonly ToolRequirement[],
  options: PreflightOptions
): PreflightCheck {
  if (tools.length === 0) {
    return readyCheck("required-tools", false, "no required local tools declared");
  }

  const missing: string[] = [];
  const unsupported: string[] = [];
  const optionalMissing: string[] = [];
  for (const tool of tools) {
    const command = tool.command ?? tool.name;
    const available = options.availableTools
      ? options.availableTools[tool.name] === true
      : findExecutable(command);
    if (!available) {
      if (tool.required === false) {
        optionalMissing.push(tool.name);
      } else {
        missing.push(tool.name);
      }
      continue;
    }

    if (tool.minVersion) {
      const observed = options.toolVersions?.[tool.name] ?? readToolVersion(command);
      if (observed === null || !atLeastVersion(observed, tool.minVersion)) {
        unsupported.push(`${tool.name} (requires ${tool.minVersion})`);
      }
    }
  }

  if (missing.length > 0 || unsupported.length > 0) {
    const failures = [...missing, ...unsupported].join(", ");
    return {
      id: "required-tools",
      status: missing.length > 0 ? "missing" : "unsupported",
      required: true,
      evidence: `unready: ${failures}`,
      remediation: "Install or configure the declared local tool, then rerun preflight; no installation is performed automatically."
    };
  }
  if (optionalMissing.length > 0) {
    return {
      id: "required-tools",
      status: "warning",
      required: false,
      evidence: `optional tools missing: ${optionalMissing.join(", ")}`,
      remediation: "Install or configure optional tools only if the selected research task needs them."
    };
  }
  return readyCheck("required-tools", true, `ready: ${tools.map((tool) => tool.name).join(", ")}`);
}

function checkExecutionMode(value: string | null | undefined): {
  readonly check: PreflightCheck;
  readonly report: ExecutionModeReport;
} {
  if (value === null || value === undefined || value.trim() === "") {
    return {
      check: {
        id: "execution-mode",
        status: "not_configured",
        required: false,
        evidence: "no execution mode selected",
        remediation: "Select ask, approve, or full-access when local execution is needed."
      },
      report: {
        value: null,
        status: "not_configured",
        notice: "No execution mode is selected; preflight does not select one automatically."
      }
    };
  }
  if (!isExecutionMode(value)) {
    return {
      check: {
        id: "execution-mode",
        status: "invalid",
        required: true,
        evidence: `unsupported mode ${value}`,
        remediation: "Use exactly ask, approve, or full-access."
      },
      report: {
        value,
        status: "invalid",
        notice: "The configured execution mode is invalid; no execution authority is granted."
      }
    };
  }
  const notice = value === "full-access"
    ? FULL_ACCESS_NOTICE
    : `${value} is a Pi-compatible execution mode; readiness does not grant research authority.`;
  return {
    check: readyCheck("execution-mode", false, `${value} selected`),
    report: { value, status: "ready", notice }
  };
}

function aggregateStatus(checks: readonly PreflightCheck[]): AggregateStatus {
  const blocking = checks.some(
    (check) => check.required && ["blocking", "missing", "unsupported", "invalid"].includes(check.status)
  );
  if (blocking) {
    return "blocked";
  }
  const warning = checks.some((check) => ["warning", "not_configured"].includes(check.status));
  return warning ? "warning" : "ready";
}

function readyCheck(id: string, required: boolean, evidence: string): PreflightCheck {
  return { id, status: "ready", required, evidence };
}

function isExecutionMode(value: string): value is ExecutionMode {
  return (EXECUTION_MODES as readonly string[]).includes(value);
}

function readExecutionModeFromEnvironment(): string | undefined {
  return process.env.GANESH_EXECUTION_MODE;
}

function readProjectConfig(projectRoot: string): ProjectConfig {
  const path = join(projectRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    return { requiredTools: [] };
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { requiredTools: [], error: `${CONFIG_FILE} must contain a JSON object` };
    }
    const object = parsed as Record<string, unknown>;
    const rawTools = object.requiredTools ?? [];
    if (!Array.isArray(rawTools)) {
      return { requiredTools: [], error: `${CONFIG_FILE} requiredTools must be an array` };
    }
    const requiredTools: ToolRequirement[] = [];
    for (const rawTool of rawTools) {
      if (rawTool === null || typeof rawTool !== "object" || typeof (rawTool as Record<string, unknown>).name !== "string") {
        return { requiredTools: [], error: `${CONFIG_FILE} contains an invalid requiredTools entry` };
      }
      const tool = rawTool as Record<string, unknown>;
      requiredTools.push({
        name: tool.name as string,
        command: typeof tool.command === "string" ? tool.command : undefined,
        minVersion: typeof tool.minVersion === "string" ? tool.minVersion : undefined,
        required: tool.required !== false
      });
    }
    const mode = object.executionMode;
    if (mode !== undefined && mode !== null && typeof mode !== "string") {
      return { requiredTools, error: `${CONFIG_FILE} executionMode must be a string` };
    }
    return { executionMode: mode as string | null | undefined, requiredTools };
  } catch {
    return { requiredTools: [], error: `${CONFIG_FILE} is not valid JSON` };
  }
}

function readPackageJson(projectRoot: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function hasProjectDependencies(
  projectRoot: string,
  packageJson: Record<string, unknown> | null
): boolean {
  if (packageJson === null) {
    return false;
  }
  const dependencies = {
    ...(asStringRecord(packageJson.dependencies)),
    ...(asStringRecord(packageJson.devDependencies))
  };
  return Object.keys(dependencies).every((name) => existsSync(join(projectRoot, "node_modules", ...name.split("/"), "package.json")));
}

function asStringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

function readNpmVersion(): string | null {
  try {
    return execFileSync("npm", ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim() || null;
  } catch {
    return null;
  }
}

function findExecutable(command: string): boolean {
  const pathValue = process.env.PATH ?? "";
  const suffixes = process.platform === "win32" ? ["", ".exe", ".cmd"] : [""];
  return pathValue.split(process.platform === "win32" ? ";" : ":").some((directory) =>
    suffixes.some((suffix) => existsSync(join(directory, `${command}${suffix}`)))
  );
}

function readToolVersion(command: string): string | null {
  try {
    return execFileSync(command, ["--version"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 2000
    }).trim().match(/\d+(?:\.\d+){1,2}/)?.[0] ?? null;
  } catch {
    return null;
  }
}

function atLeastVersion(observed: string, minimum: string): boolean {
  const actualParts = observed.split(".").map(Number);
  const requiredParts = minimum.split(".").map(Number);
  for (let index = 0; index < Math.max(actualParts.length, requiredParts.length); index += 1) {
    const actual = actualParts[index] ?? 0;
    const required = requiredParts[index] ?? 0;
    if (actual !== required) {
      return actual > required;
    }
  }
  return true;
}
