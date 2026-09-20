// story: e18s05
import { runReleaseProcedure } from "./distribution/release-procedure.js";
import type { ReleaseProcedureReport } from "./distribution/types.js";

function renderReleaseProcedureReport(report: ReleaseProcedureReport): string {
  const lines: string[] = [];
  lines.push("=== Ganesh Release Procedure Report ===");
  lines.push(`Status:              ${report.status.toUpperCase()}`);
  lines.push(`Publication:         ${report.publication.toUpperCase()}`);
  lines.push(`Local Qualification: ${report.qualify.localQualification.toUpperCase()}`);
  lines.push(`Packaging Evidence:  ${report.packagingEvidence.status.toUpperCase()}`);
  lines.push(`Shipment:            ${report.qualify.shipment.toUpperCase()}`);
  lines.push(`Hosted CI:           ${report.hostedCi}`);
  lines.push(`Production Ready:    ${report.productionReady}`);
  lines.push("");
  lines.push("--- Release States ---");
  lines.push(report.releaseStates.text);
  lines.push("");
  lines.push("--- SemVer Proposal ---");
  lines.push(`Current Version:     ${report.semverProposal.currentVersion}`);
  lines.push(`Proposed Version:    ${report.semverProposal.proposedVersion}`);
  lines.push(`Bump Type:           ${report.semverProposal.bumpType}`);
  lines.push(`Commits Analyzed:    ${report.semverProposal.commitsAnalyzed}`);
  lines.push(`Breaking / Feat / Fix: ${report.semverProposal.breakingCount} / ${report.semverProposal.featCount} / ${report.semverProposal.fixCount}`);

  if (report.reasons && report.reasons.length > 0) {
    lines.push("");
    lines.push("--- Blockers & Diagnostics ---");
    for (const r of report.reasons) {
      lines.push(`  * ${r}`);
    }
  }

  return lines.join("\n");
}

const argumentsList = process.argv.slice(2);
let jsonOutput = false;
let projectRoot = process.cwd();
let authorizePublication = false;
let argumentError: string | undefined;

for (let index = 0; index < argumentsList.length; index += 1) {
  const argument = argumentsList[index];
  if (argument === "--json") {
    jsonOutput = true;
  } else if (argument === "--i-authorize-publication") {
    authorizePublication = true;
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
  process.stderr.write(`release-procedure: ${argumentError}\n`);
  process.exitCode = 2;
} else {
  const report = runReleaseProcedure(projectRoot, { authorizePublication });
  if (jsonOutput) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${renderReleaseProcedureReport(report)}\n`);
  }
  process.exitCode = report.status === "pass" ? 0 : 1;
}
