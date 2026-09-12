import { accessSync, constants, lstatSync } from "node:fs";
import { resolve } from "node:path";
import { pathInside } from "../persistence/storage-utils.js";
import type { WorkspaceLaunchErrorCode } from "./workspace-types.js";

export interface FolderResolution {
  readonly status: "resolved" | "failed";
  readonly path?: string;
  readonly code?: WorkspaceLaunchErrorCode;
  readonly message: string;
}

function failure(code: WorkspaceLaunchErrorCode, message: string): FolderResolution {
  return { status: "failed", code, message };
}

export function resolveProjectFolder(
  argv: readonly string[],
  cwd: string,
  allowedRoot?: string
): FolderResolution {
  if (argv.length > 1) {
    return failure("launch-failed", "Ganesh accepts at most one project folder");
  }
  const folder = resolve(cwd, argv[0] ?? ".");
  if (allowedRoot !== undefined && !pathInside(allowedRoot, folder)) {
    return failure("path-escape", "project folder must remain inside the allowed local root");
  }
  let stats;
  try {
    stats = lstatSync(folder);
  } catch {
    return failure("missing-folder", "project folder does not exist");
  }
  if (!stats.isDirectory()) {
    return failure("not-a-directory", "project folder is not a directory");
  }
  if ((stats.mode & 0o444) === 0) {
    return failure("unreadable", "project folder is not readable");
  }
  try {
    accessSync(folder, constants.R_OK);
  } catch {
    return failure("unreadable", "project folder is not readable");
  }
  return { status: "resolved", path: folder, message: "project folder resolved" };
}
