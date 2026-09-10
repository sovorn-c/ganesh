// story: e01s02
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_FILE } from "./preflight-constants.js";
import type { ProjectConfig, ToolRequirement } from "./preflight-types.js";

export function readProjectConfig(projectRoot: string): ProjectConfig {
  const path = join(projectRoot, CONFIG_FILE);
  if (!existsSync(path)) {
    return { requiredTools: [] };
  }

  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { requiredTools: [], error: `${CONFIG_FILE} must contain a JSON object` };
    }
    return parseProjectConfig(parsed as Record<string, unknown>);
  } catch {
    return { requiredTools: [], error: `${CONFIG_FILE} is not valid JSON` };
  }
}

function parseProjectConfig(object: Record<string, unknown>): ProjectConfig {
  const rawTools = object.requiredTools ?? [];
  if (!Array.isArray(rawTools)) {
    return { requiredTools: [], error: `${CONFIG_FILE} requiredTools must be an array` };
  }

  const requiredTools: ToolRequirement[] = [];
  for (const rawTool of rawTools) {
    if (!isNamedObject(rawTool)) {
      return { requiredTools: [], error: `${CONFIG_FILE} contains an invalid requiredTools entry` };
    }
    requiredTools.push({
      name: rawTool.name,
      command: asOptionalString(rawTool.command),
      minVersion: asOptionalString(rawTool.minVersion),
      required: rawTool.required !== false
    });
  }

  const mode = object.executionMode;
  if (mode !== undefined && mode !== null && typeof mode !== "string") {
    return { requiredTools, error: `${CONFIG_FILE} executionMode must be a string` };
  }
  return { executionMode: mode as string | null | undefined, requiredTools };
}

function isNamedObject(value: unknown): value is Record<string, unknown> & { name: string } {
  return value !== null
    && typeof value === "object"
    && !Array.isArray(value)
    && typeof (value as Record<string, unknown>).name === "string";
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function readPackageJson(projectRoot: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function hasProjectDependencies(
  projectRoot: string,
  packageJson: Record<string, unknown> | null
): boolean {
  if (packageJson === null) {
    return false;
  }
  const dependencies = {
    ...asStringRecord(packageJson.dependencies),
    ...asStringRecord(packageJson.devDependencies)
  };
  return Object.keys(dependencies).every((name) =>
    existsSync(join(projectRoot, "node_modules", ...name.split("/"), "package.json"))
  );
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
