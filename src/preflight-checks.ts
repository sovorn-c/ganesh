// story: e01s02
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { FULL_ACCESS_NOTICE } from "./preflight-constants.js";
import {
  EXECUTION_MODES,
  type AggregateStatus,
  type ExecutionMode,
  type ExecutionModeReport,
  type PreflightCheck,
  type PreflightOptions,
  type ProjectConfig,
  type ToolRequirement
} from "./preflight-types.js";

export function checkNodeRuntime(version: string): PreflightCheck {
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

export function checkPackageManager(
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

export function checkProjectDependencies(
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

export function checkProjectConfiguration(config: ProjectConfig): PreflightCheck {
  if (config.error) {
    return {
      id: "project-configuration",
      status: "blocking",
      required: true,
      evidence: config.error,
      remediation: `Fix ganesh.config.json; do not put credentials or research content in it.`
    };
  }
  return readyCheck("project-configuration", false, "ganesh.config.json is valid or not configured");
}

export function checkRequiredTools(
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

export function checkExecutionMode(value: string | null | undefined): {
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

export function aggregateStatus(checks: readonly PreflightCheck[]): AggregateStatus {
  const blocking = checks.some(
    (check) => check.required && ["blocking", "missing", "unsupported", "invalid"].includes(check.status)
  );
  if (blocking) {
    return "blocked";
  }
  const warning = checks.some((check) => ["warning", "not_configured"].includes(check.status));
  return warning ? "warning" : "ready";
}

export function readNpmVersion(): string | null {
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

function readyCheck(id: string, required: boolean, evidence: string): PreflightCheck {
  return { id, status: "ready", required, evidence };
}

function isExecutionMode(value: string): value is ExecutionMode {
  return (EXECUTION_MODES as readonly string[]).includes(value);
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
