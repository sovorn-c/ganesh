// story: e16s04
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { RunbookSummary } from "./diagnostic-types.js";

export function listRunbooks(options?: { runbooksDir?: string }): readonly RunbookSummary[] {
  let targetDir = options?.runbooksDir;
  if (!targetDir) {
    const fromCompiled = resolve(fileURLToPath(new URL("../../../docs/runbooks", import.meta.url)));
    if (existsSync(fromCompiled)) {
      targetDir = fromCompiled;
    } else {
      const fromCwd = resolve(process.cwd(), "docs/runbooks");
      if (existsSync(fromCwd)) {
        targetDir = fromCwd;
      } else {
        targetDir = resolve(fileURLToPath(new URL("../../docs/runbooks", import.meta.url)));
      }
    }
  }

  if (!existsSync(targetDir)) {
    return [];
  }

  const entries = readdirSync(targetDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .sort((a, b) => a.name.localeCompare(b.name));

  const runbooks: RunbookSummary[] = [];

  for (const entry of entries) {
    const id = basename(entry.name, ".md");
    const filePath = join(targetDir, entry.name);
    const content = readFileSync(filePath, "utf8");

    let title = id;
    const titleMatch = content.match(/^#\s+(.+)$/m);
    if (titleMatch && titleMatch[1]) {
      title = titleMatch[1].trim();
    }

    runbooks.push({
      id,
      title,
      path: filePath,
      content
    });
  }

  return runbooks;
}
