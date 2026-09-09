import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";

const DISPOSABLE_DIRECTORIES = new Set([
  ".git",
  ".npm",
  "dist",
  "graphify-out",
  "node_modules",
  "specs"
]);

export function runCleanInstall(sourceRoot = process.cwd()): 0 | 1 {
  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = mkdtempSync(join(tmpdir(), "ganesh-clean-"));
    cpSync(sourceRoot, temporaryRoot, {
      recursive: true,
      filter: (sourcePath) => {
        const relativePath = relative(sourceRoot, sourcePath);
        const firstPathPart = relativePath.split(/[\\/]/, 1)[0];
        return relativePath === "" || !DISPOSABLE_DIRECTORIES.has(firstPathPart);
      }
    });

    const commands: readonly [string, readonly string[]][] = [
      ["npm ci", ["ci", "--ignore-scripts"]],
      ["npm run preflight -- --json", ["run", "preflight", "--", "--json"]],
      ["npm run build", ["run", "build"]],
      ["npm test", ["test"]],
      ["npm run lint", ["run", "lint"]],
      ["npm run typecheck", ["run", "typecheck"]]
    ];

    for (const [label, args] of commands) {
      const result = spawnSync("npm", args, {
        cwd: temporaryRoot,
        env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: "false" },
        stdio: "inherit"
      });
      if (result.status !== 0) {
        process.stderr.write(`clean-install: ${label} failed; discard the temporary folder and retry.\n`);
        return 1;
      }
    }
    process.stdout.write("clean-install: disposable project passed npm ci, preflight, build, test, lint, and typecheck.\n");
    return 0;
  } catch (error) {
    process.stderr.write(`clean-install: setup failed: ${error instanceof Error ? error.message : "unknown error"}\n`);
    return 1;
  } finally {
    if (temporaryRoot !== undefined) {
      rmSync(temporaryRoot, { recursive: true, force: true });
    }
  }
}
