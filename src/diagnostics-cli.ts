import { createHash } from "node:crypto";
import { openProject } from "./project/project-store.js";
import { createOwnerCapability } from "./authority/capability-broker.js";
import { inspectOperationalHealth } from "./operations/health.js";
import { exportDiagnostics } from "./operations/diagnostic-export.js";
import { purgeDiagnosticEvents } from "./operations/retention.js";
import { newId } from "./persistence/storage-utils.js";
import type { ProjectHandle } from "./project/project-types.js";

const argumentsList = process.argv.slice(2);
let jsonOutput = false;
let showHelp = false;
let projectPath = process.cwd();
let mode: "health" | "export" | "purge" | undefined;
let destinationPath: string | undefined;
let correlationId: string | undefined;
let runId: string | undefined;
let commandId: string | undefined;
let olderThan: string | undefined;
let limit: number | undefined;
let argumentError: string | undefined;

for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--json") {
    jsonOutput = true;
  } else if (argument === "--help" || argument === "-h") {
    showHelp = true;
  } else if (argument === "--health") {
    if (mode !== undefined && mode !== "health") {
      argumentError = `cannot specify multiple operations: --${mode} and --health`;
    }
    mode = "health";
  } else if (argument === "--export") {
    if (mode !== undefined && mode !== "export") {
      argumentError = `cannot specify multiple operations: --${mode} and --export`;
    }
    mode = "export";
  } else if (argument === "--purge") {
    if (mode !== undefined && mode !== "purge") {
      argumentError = `cannot specify multiple operations: --${mode} and --purge`;
    }
    mode = "purge";
  } else if (argument === "--project-path") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--project-path requires a path argument";
    } else {
      projectPath = value;
      index += 1;
    }
  } else if (argument === "--destination-path") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--destination-path requires a path argument";
    } else {
      destinationPath = value;
      index += 1;
    }
  } else if (argument === "--correlation-id") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--correlation-id requires an id argument";
    } else {
      correlationId = value;
      index += 1;
    }
  } else if (argument === "--run-id") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--run-id requires an id argument";
    } else {
      runId = value;
      index += 1;
    }
  } else if (argument === "--command-id") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--command-id requires an id argument";
    } else {
      commandId = value;
      index += 1;
    }
  } else if (argument === "--older-than") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--older-than requires a timestamp argument";
    } else {
      olderThan = value;
      index += 1;
    }
  } else if (argument === "--limit") {
    const value = argumentsList[index + 1];
    if (!value || value.startsWith("--")) {
      argumentError = "--limit requires a numeric argument";
    } else {
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed) || parsed < 0) {
        argumentError = "--limit must be a finite non-negative integer";
      } else {
        limit = parsed;
      }
      index += 1;
    }
  } else {
    argumentError = `unknown argument: ${argument}`;
  }
}

if (!mode) {
  mode = "health";
}

if (mode === "export" && !destinationPath) {
  argumentError = "--export requires --destination-path";
}

if (showHelp) {
  process.stdout.write("Usage: ganesh-diagnostics [--health | --export | --purge] [options]\n");
  process.stdout.write("\nModes:\n");
  process.stdout.write("  --health                     Inspect operational health (default)\n");
  process.stdout.write("  --export                     Export diagnostics bundle (requires --destination-path)\n");
  process.stdout.write("  --purge                      Purge diagnostic events\n");
  process.stdout.write("\nOptions:\n");
  process.stdout.write("  --project-path <path>        Path to project root (default: cwd)\n");
  process.stdout.write("  --destination-path <path>    Destination directory for export bundle\n");
  process.stdout.write("  --correlation-id <id>        Filter by correlation ID\n");
  process.stdout.write("  --run-id <id>                Filter by run ID\n");
  process.stdout.write("  --command-id <id>            Custom command ID\n");
  process.stdout.write("  --older-than <timestamp>     Purge events older than ISO timestamp\n");
  process.stdout.write("  --limit <number>             Max events to export\n");
  process.stdout.write("  --json                       Output in JSON format\n");
  process.stdout.write("  --help, -h                   Show this help message\n");
  process.exitCode = 0;
} else if (argumentError) {
  process.stderr.write(`diagnostics: ${argumentError}\n`);
  process.exitCode = 2;
} else if (mode === "health") {
  try {
    const report = inspectOperationalHealth(projectPath);
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    } else {
      process.stdout.write(`Operational Health: ${report.status} (exit ${report.exitCode})\n`);
      for (const check of report.checks) {
        process.stdout.write(`  [${check.status.toUpperCase()}] ${check.id}: ${check.evidence}\n`);
        if (check.remediation) {
          process.stdout.write(`         remediation: ${check.remediation}\n`);
        }
      }
    }
    process.exitCode = report.exitCode;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`diagnostics: error inspecting health: ${msg}\n`);
    process.exitCode = 1;
  }
} else if (mode === "export") {
  let handle: ProjectHandle | undefined;
  try {
    handle = openProject(projectPath);
    const ownerCap = createOwnerCapability(handle.project.ownerId);
    const cmdId = commandId ?? newId("cmd");
    const payloadHash = createHash("sha256")
      .update(JSON.stringify({ destinationPath, correlationId, limit }))
      .digest("hex");
    const bundle = exportDiagnostics(handle, ownerCap, {
      commandId: cmdId,
      payloadHash,
      destinationPath: destinationPath!,
      destination: "local",
      purpose: "diagnostics-export",
      correlationId,
      limit,
      optIn: true
    });
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(bundle, null, 2)}\n`);
    } else {
      process.stdout.write(`Diagnostic bundle exported to: ${bundle.bundlePath}\n`);
      process.stdout.write(`Operation ID: ${bundle.operationId}\n`);
      process.stdout.write(`Files: ${bundle.manifest.files.length}\n`);
    }
    process.exitCode = 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`diagnostics export failed: ${msg}\n`);
    process.exitCode = 1;
  } finally {
    handle?.close();
  }
} else if (mode === "purge") {
  let handle: ProjectHandle | undefined;
  try {
    handle = openProject(projectPath);
    const ownerCap = createOwnerCapability(handle.project.ownerId);
    const cmdId = commandId ?? newId("cmd");
    const result = purgeDiagnosticEvents(handle, ownerCap, {
      commandId: cmdId,
      olderThan,
      correlationId,
      runId
    });
    if (jsonOutput) {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    } else {
      process.stdout.write(`Diagnostic events purged: ${result.deletedCount} deleted, ${result.remainingCount} remaining\n`);
    }
    process.exitCode = 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`diagnostics purge failed: ${msg}\n`);
    process.exitCode = 1;
  } finally {
    handle?.close();
  }
}
