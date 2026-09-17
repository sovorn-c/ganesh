import { spawnSync } from "node:child_process";

const [, , pattern, ...files] = process.argv;
if (!pattern || files.length === 0) {
  console.error("usage: node scripts/require-test-match.mjs <pattern> <test-file>...");
  process.exit(2);
}

const result = spawnSync(process.execPath, ["--test", `--test-name-pattern=${pattern}`, "--test-reporter=tap", ...files], {
  encoding: "utf8"
});
process.stdout.write(result.stdout ?? "");
process.stderr.write(result.stderr ?? "");
if (result.status !== 0) process.exit(result.status ?? 1);
const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
const summary = output.match(/(?:ℹ|#) tests (\d+)/);
const passed = output.match(/(?:ℹ|#) pass (\d+)/);
const fileNames = new Set(files.map((file) => file.trim()));
const matchedSubtests = [...output.matchAll(/^\s*# Subtest: (.+)$/gm)]
  .filter((match) => !fileNames.has(match[1].trim()));
if (!summary || !passed) {
  console.error("filtered test command produced no test summary");
  process.exit(1);
}
if (Number(passed[1]) < 1 || matchedSubtests.length === 0) {
  console.error(`filtered test command matched no tests: ${pattern}`);
  process.exit(1);
}
