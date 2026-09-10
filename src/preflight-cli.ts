import { runCleanInstall } from "./runtime/clean-install.js";
import { renderHuman, renderJson, runPreflight } from "./runtime/preflight.js";

type Fixture = "unsupported-runtime";

const argumentsList = process.argv.slice(2);
let jsonOutput = false;
let cleanInstall = false;
let fixture: Fixture | undefined;
let argumentError: string | undefined;

for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--json") {
    jsonOutput = true;
  } else if (argument === "--clean-install") {
    cleanInstall = true;
  } else if (argument === "--fixture") {
    const value = argumentsList[index + 1];
    if (value !== "unsupported-runtime") {
      argumentError = value === undefined
        ? "--fixture requires unsupported-runtime"
        : `unknown fixture: ${value}`;
    } else {
      fixture = value;
      index += 1;
    }
  } else {
    argumentError = `unknown argument: ${argument}`;
  }
}

if (argumentError) {
  process.stderr.write(`preflight: ${argumentError}\n`);
  process.exitCode = 2;
} else if (cleanInstall && fixture !== undefined) {
  process.stderr.write("preflight: --fixture cannot be combined with --clean-install\n");
  process.exitCode = 2;
} else if (cleanInstall) {
  process.exitCode = runCleanInstall();
} else {
  const report = runPreflight({
    runtimeVersion: fixture === "unsupported-runtime" ? "26.7.0" : undefined,
    executionMode: process.env.GANESH_EXECUTION_MODE
  });
  process.stdout.write(
    `${jsonOutput ? renderJson(report) : renderHuman(report)}\n`
  );
  process.exitCode = report.exitCode;
}
