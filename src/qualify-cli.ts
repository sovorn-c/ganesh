// story: e17s05
import {
  renderReleaseQualificationReport,
  runReleaseQualification
} from "./qualification/release-gate.js";
import type { ReleaseQualificationOptions } from "./qualification/qualification-types.js";

const argumentsList = process.argv.slice(2);
let jsonOutput = false;
let projectRoot = process.cwd();
let mode: "catalog" | "execute" = "catalog";
let argumentError: string | undefined;

for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--json") {
    jsonOutput = true;
  } else if (argument === "--execute") {
    mode = "execute";
  } else if (argument === "--project-root") {
    const value = argumentsList[index + 1];
    if (!value) {
      argumentError = "--project-root requires a directory path";
    } else {
      projectRoot = value;
      index += 1;
    }
  } else {
    argumentError = `unknown argument: ${argument}`;
  }
}

if (argumentError) {
  process.stderr.write(`qualify: ${argumentError}\n`);
  process.exitCode = 2;
} else {
  const options: ReleaseQualificationOptions = { mode };
  const report = runReleaseQualification(projectRoot, options);
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReleaseQualificationReport(report)}\n`);
  }
  process.exitCode = report.localQualification === "pass" ? 0 : 1;
}
