import { cpSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const BASELINE_PATHS = ["package.json", "package-lock.json", "tsconfig.json", "eslint.config.js", "src", "test"] as const;

export function runCleanInstall(sourceRoot = process.cwd()): 0 | 1 {
  let temporaryRoot: string | undefined;
  try {
    temporaryRoot = mkdtempSync(join(tmpdir(), "ganesh-clean-"));
    for (const path of BASELINE_PATHS) {
      const sourcePath = join(sourceRoot, path);
      if (!existsSync(sourcePath)) {
        throw new Error(`required baseline path is missing: ${path}`);
      }
      cpSync(sourcePath, join(temporaryRoot, path), { recursive: true });
    }

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
