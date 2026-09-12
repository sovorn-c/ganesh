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
  try {
    const stats = lstatSync(folder);
    if (!stats.isDirectory()) {
      return failure("not-a-directory", "project folder is not a directory");
    }
    if ((stats.mode & 0o444) === 0) {
      return failure("unreadable", "project folder is not readable");
    }
    accessSync(folder, constants.R_OK);
  } catch {
    return failure("missing-folder", "project folder does not exist or cannot be read");
  }
  return { status: "resolved", path: folder, message: "project folder resolved" };
}
