// story: e18s05
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { runReleaseQualification } from "../qualification/release-gate.js";
import { validatePackagingEvidence } from "./packaging-evidence.js";
import type {
  ReleaseProcedureOptions,
  ReleaseProcedureReport,
  SemVerProposal
} from "./types.js";

export { validatePackagingEvidence } from "./packaging-evidence.js";

export function proposeSemverBump(root: string = process.cwd()): SemVerProposal {
  const projectRoot = path.resolve(root);
  const packageJsonPath = path.join(projectRoot, "package.json");
  let currentVersion = "0.1.0";
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
      if (pkg.version) {
        currentVersion = pkg.version;
      }
    } catch {
      // ignore
    }
  }

  let gitLogOutput = "";
  try {
    const tagRes = spawnSync("git", ["describe", "--tags", "--abbrev=0"], { cwd: projectRoot, encoding: "utf8" });
    const lastTag = tagRes.status === 0 ? tagRes.stdout.trim() : null;

    const gitArgs = lastTag
      ? ["log", `${lastTag}..HEAD`, "--pretty=format:%B%x00"]
      : ["log", "-n", "100", "--pretty=format:%B%x00"];

    const logRes = spawnSync("git", gitArgs, { cwd: projectRoot, encoding: "utf8" });
    if (logRes.status === 0) {
      gitLogOutput = logRes.stdout;
    }
  } catch {
    // git not available or not a git repo
  }

  const commitMessages = gitLogOutput.split("\0").map((m) => m.trim()).filter(Boolean);
  let breakingCount = 0;
  let featCount = 0;
  let fixCount = 0;

  for (const msg of commitMessages) {
    if (/BREAKING CHANGE:/i.test(msg) || /^[a-z]+(\([a-z0-9_-]+\))?!:/im.test(msg)) {
      breakingCount++;
    } else if (/^feat(\([a-z0-9_-]+\))?:/im.test(msg)) {
      featCount++;
    } else if (/^fix(\([a-z0-9_-]+\))?:/im.test(msg)) {
      fixCount++;
    }
  }

  let bumpType: "major" | "minor" | "patch" | "none" = "none";
  if (breakingCount > 0) {
    bumpType = "major";
  } else if (featCount > 0) {
    bumpType = "minor";
  } else if (fixCount > 0) {
    bumpType = "patch";
  }

  const [majorStr, minorStr, patchStr] = currentVersion.split(".").map(Number);
  const major = Number.isInteger(majorStr) ? majorStr : 0;
  const minor = Number.isInteger(minorStr) ? minorStr : 1;
  const patch = Number.isInteger(patchStr) ? patchStr : 0;

  let proposedVersion = currentVersion;
  if (bumpType === "major") {
    proposedVersion = `${major + 1}.0.0`;
  } else if (bumpType === "minor") {
    proposedVersion = `${major}.${minor + 1}.0`;
  } else if (bumpType === "patch") {
    proposedVersion = `${major}.${minor}.${patch + 1}`;
  }

  return {
    currentVersion,
    proposedVersion,
    bumpType,
    commitsAnalyzed: commitMessages.length,
    breakingCount,
    featCount,
    fixCount
  };
}

export function runReleaseProcedure(
  root: string = process.cwd(),
  options?: ReleaseProcedureOptions
): ReleaseProcedureReport {
  const projectRoot = path.resolve(root);
  const reasons: string[] = [];

  const qualify = runReleaseQualification(projectRoot, options?.qualifyOptions);
  const packagingEvidence = validatePackagingEvidence(projectRoot);
  const semverProposal = proposeSemverBump(projectRoot);

  const isPublicationAuthorized = options?.authorizePublication === true;
  const publication: "not-authorized" | "authorized-local" = isPublicationAuthorized
    ? "authorized-local"
    : "not-authorized";

  if (qualify.localQualification !== "pass") {
    reasons.push("Local qualification failed");
  }
  if (packagingEvidence.status !== "pass") {
    reasons.push("Packaging evidence validation failed");
  }

  const passed = qualify.localQualification === "pass" && packagingEvidence.status === "pass";

  return {
    status: passed ? "pass" : "fail",
    publication,
    qualify,
    packagingEvidence,
    semverProposal,
    hostedCi: false,
    productionReady: false,
    reasons: passed ? undefined : reasons
  };
}
