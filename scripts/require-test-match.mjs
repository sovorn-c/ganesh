import { spawnSync } from "node:child_process";

const [, , pattern, ...files] = process.argv;
if (!pattern || files.length === 0) {
  console.error("usage: node scripts/require-test-match.mjs <pattern> <test-file>...");
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", "--test-name-pattern", pattern, ...files], {
  encoding: "utf8"
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) process.exit(result.status ?? 1);
const summary = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/(?:ℹ|#) tests (\d+)/);
if (!summary) {
  console.error("filtered test command produced no test summary");
  process.exit(1);
}
if (Number(summary[1]) < 1) {
  console.error(`filtered test command matched no tests: ${pattern}`);
  process.exit(1);
}
