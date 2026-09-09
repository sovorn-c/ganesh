import { runCleanInstall } from "./clean-install.js";
import { renderHuman, renderJson, runPreflight } from "./preflight.js";

const argumentsList = process.argv.slice(2);

if (argumentsList.includes("--clean-install")) {
  process.exitCode = runCleanInstall();
} else {
  const report = runPreflight({
    executionMode: process.env.GANESH_EXECUTION_MODE
  });
  process.stdout.write(
    `${argumentsList.includes("--json") ? renderJson(report) : renderHuman(report)}\n`
  );
  process.exitCode = report.exitCode;
}
