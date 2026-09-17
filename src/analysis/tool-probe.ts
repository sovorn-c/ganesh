// story: e11s03
import { accessSync, constants } from "node:fs";
import { delimiter, join } from "node:path";
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import { newId } from "../persistence/storage-utils.js";
import type { InstallAnalysisPackageRequest, LocalCommandRunRecord, ToolProbeReport, ToolProbeRequest, ToolProbeResult } from "./analysis-types.js";
import { assertAnalysisSchema, assertId, assertProbeAccess, ensureWritableAnalysis, hashPayload, now, operationResult, recordOperation } from "./analysis-utils.js";
import { runLocalCommand } from "./command-runner.js";

function named(value: string | { readonly name: string; readonly command?: string }): { name: string; command: string } {
  if (typeof value === "string") {
    if (!value.trim()) {throw new ProjectStoreError("invalid-argument", "tool name must not be empty");}
    return { name: value, command: value };
  }
  if (!value || typeof value.name !== "string" || !value.name.trim()) {
    throw new ProjectStoreError("invalid-argument", "tool entries require a name");
  }
  return { name: value.name, command: value.command?.trim() || value.name };
}

function pathHasCommand(command: string): boolean {
  if (command.includes("/")) {
    try { accessSync(command, constants.X_OK); return true; } catch { return false; }
  }
  return (process.env.PATH ?? "").split(delimiter).some((directory) => {
    try { accessSync(join(directory, command), constants.X_OK); return true; } catch { return false; }
  });
}

function reportFromRow(row: Record<string, unknown>): ToolProbeReport {
  const tools = JSON.parse(String(row.tools)) as ToolProbeResult[];
  const packages = JSON.parse(String(row.packages)) as ToolProbeResult[];
  return {
    id: String(row.id),
    tools,
    packages,
    missingTools: tools.filter((item) => !item.available).map((item) => item.name),
    missingPackages: packages.filter((item) => !item.available).map((item) => item.name),
    remediation: [...tools, ...packages].filter((item) => !item.available).map((item) => item.remediation ?? `Install or configure ${item.kind} '${item.name}' before running the analysis.`),
    commandId: String(row.command_id),
    createdAt: String(row.created_at)
  };
}

export function probeAnalysisTools(handle: ProjectHandle, capability: unknown, request: ToolProbeRequest): ToolProbeReport {
  handle.assertCurrent();
  assertAnalysisSchema(handle);
  assertProbeAccess(handle, capability);
  const rawTools = request.tools ?? [];
  const rawPackages = request.packages ?? [];
  if (!Array.isArray(rawTools) || !Array.isArray(rawPackages)) {
    throw new ProjectStoreError("invalid-argument", "tools and packages must be arrays");
  }
  const tools: ToolProbeResult[] = rawTools.map((entry) => {
    const item = named(entry);
    const available = request.availableTools === undefined
      ? pathHasCommand(item.command)
      : request.availableTools[item.name] === true || request.availableTools[item.command] === true;
    return { name: item.name, kind: "tool", available, ...(available ? {} : { code: "tool-missing" as const, remediation: `Install or expose '${item.command}' on PATH, then rerun the tool probe.` }) };
  });
  const packages: ToolProbeResult[] = rawPackages.map((entry) => {
    if (typeof entry !== "string" || !entry.trim()) {throw new ProjectStoreError("invalid-argument", "package names must be non-empty strings");}
    const name = entry.trim();
    const available = request.availablePackages?.[name] === true;
    return { name, kind: "package", available, ...(available ? {} : { code: "package-missing" as const, remediation: `Install package '${name}' with an owner-approved local command, then rerun the tool probe.` }) };
  });
  const commandId = request.commandId ?? newId("analysis-probe-command");
  assertId(commandId, "commandId");
  const payloadHash = hashPayload({ tools, packages });
  const existingId = operationResult(handle, commandId, "tool-probe", payloadHash);
  if (existingId) {return reportFromRow(handle.db.prepare("SELECT * FROM analysis_tool_probes WHERE id = ?").get(existingId) as Record<string, unknown>);}
  const id = newId("analysis-probe");
  const createdAt = now();
  handle.db.prepare("INSERT INTO analysis_tool_probes (id, tools, packages, results, command_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(id, JSON.stringify(tools), JSON.stringify(packages), JSON.stringify({ tools, packages }), commandId, createdAt);
  recordOperation(handle, commandId, "tool-probe", payloadHash, id, createdAt);
  return reportFromRow(handle.db.prepare("SELECT * FROM analysis_tool_probes WHERE id = ?").get(id) as Record<string, unknown>);
}

export function installAnalysisPackage(handle: ProjectHandle, capability: unknown, request: InstallAnalysisPackageRequest): LocalCommandRunRecord {
  ensureWritableAnalysis(handle);
  // runLocalCommand is the single installation gate: owner identity, mode,
  // bash guard, exact confirmation, argv-only spawn and cwd confinement.
  try {
    return runLocalCommand(handle, capability, request);
  } catch (error) {
    if (error instanceof ProjectStoreError && error.code === "command-denied") {
      throw new ProjectStoreError("install-denied", `install-denied: ${error.message}`);
    }
    if (error instanceof ProjectStoreError && error.code === "confirmation-required") {
      throw new ProjectStoreError("install-unconfirmed", `install-unconfirmed: ${error.message}`);
    }
    throw error;
  }
}
