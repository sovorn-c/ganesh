// story: e18s01
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { loadSupportMatrix } from "./support-matrix.js";
import type { PackagedSmokeOptions, PackagedSmokeReport } from "./types.js";

const BANNED_PREFIXES = new Set(["/", "/usr", "/usr/local", "/etc", "/var", "/bin", "/sbin", "/opt", "/sys", "/proc", "/dev", "/root", os.homedir()]);
const SYSTEM_PREFIX_ROOTS = ["/usr", "/etc", "/var", "/bin", "/sbin", "/opt", "/sys", "/proc", "/dev", "/root"];

export function validateIsolatedPrefix(prefix: string, caller: string = "runPackagedSmoke"): string {
  if (!prefix || prefix.trim().length === 0) {
    throw new Error(`${caller} requires an isolated prefix directory; rejected unsafe prefix: ${prefix}`);
  }
  const resolved = path.resolve(prefix);
  if (BANNED_PREFIXES.has(resolved) || resolved === "/" || resolved === os.homedir()) {
    throw new Error(`${caller} requires an isolated prefix directory; rejected unsafe prefix: ${prefix}`);
  }

  let canonical = resolved;
  try {
    canonical = fs.realpathSync(resolved);
  } catch {
    let curr = resolved;
    while (!fs.existsSync(curr) && curr !== path.dirname(curr)) {
      curr = path.dirname(curr);
    }
    try {
      const parentCanonical = fs.realpathSync(curr);
      canonical = path.join(parentCanonical, path.relative(curr, resolved));
    } catch {
      canonical = resolved;
    }
  }

  for (const check of [resolved, canonical]) {
    if (BANNED_PREFIXES.has(check) || check === "/" || check === os.homedir()) {
      throw new Error(`${caller} requires an isolated prefix directory; rejected unsafe prefix: ${prefix}`);
    }
    for (const sysRoot of SYSTEM_PREFIX_ROOTS) {
      if (check === sysRoot || check.startsWith(`${sysRoot}/`)) {
        throw new Error(`${caller} requires an isolated prefix directory; rejected unsafe prefix: ${prefix}`);
      }
    }
  }

  return canonical;
}

export async function runPackagedSmoke(
  options: PackagedSmokeOptions
): Promise<PackagedSmokeReport> {
  const root = path.resolve(options.root ?? process.cwd());
  const prefix = validateIsolatedPrefix(options.prefix, "runPackagedSmoke");

  if (!fs.existsSync(prefix)) {
    fs.mkdirSync(prefix, { recursive: true });
  }

  const projectDir = options.projectDir
    ? path.resolve(options.projectDir)
    : path.join(prefix, "smoke-project");

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  const reasons: string[] = [];

  // 1. Verify support matrix catalog declares this host as verified with valid evidence
  let matrixRowVerified = false;
  try {
    const matrix = loadSupportMatrix(root);
    const hostRow = matrix.combinations.find(
      (c) =>
        c.os === process.platform &&
        c.arch === process.arch &&
        c.nodeMajor === 24
    );
    if (hostRow && hostRow.status === "verified") {
      if (!hostRow.evidencePointer || hostRow.evidencePointer.trim().length === 0) {
        reasons.push(
          `Host combination ${process.platform}-${process.arch}-node24 is marked verified but has no evidencePointer`
        );
      } else {
        const rootResolved = path.resolve(root);
        const evidenceFile = path.resolve(rootResolved, hostRow.evidencePointer);
        const relative = path.relative(rootResolved, evidenceFile);
        if (relative.startsWith("..") || path.isAbsolute(relative)) {
          reasons.push(
            `Host combination ${process.platform}-${process.arch}-node24 evidence pointer must be under project root: ${hostRow.evidencePointer}`
          );
        } else if (!fs.existsSync(evidenceFile)) {
          reasons.push(
            `Host combination ${process.platform}-${process.arch}-node24 evidence pointer not found: ${hostRow.evidencePointer}`
          );
        } else {
          try {
            const canonicalRoot = fs.realpathSync(rootResolved);
            const canonicalEvidence = fs.realpathSync(evidenceFile);
            const canonicalRelative = path.relative(canonicalRoot, canonicalEvidence);
            if (canonicalRelative.startsWith("..") || path.isAbsolute(canonicalRelative)) {
              reasons.push(
                `Host combination ${process.platform}-${process.arch}-node24 evidence pointer must be under project root: ${hostRow.evidencePointer}`
              );
            } else {
              const stat = fs.statSync(canonicalEvidence);
              if (!stat.isFile()) {
                reasons.push(
                  `Host combination ${process.platform}-${process.arch}-node24 evidence pointer must be a regular file: ${hostRow.evidencePointer}`
                );
              } else {
                matrixRowVerified = true;
              }
            }
          } catch {
            reasons.push(
              `Host combination ${process.platform}-${process.arch}-node24 evidence pointer stat failed: ${hostRow.evidencePointer}`
            );
          }
        }
      }
    } else {
      reasons.push(
        `Host combination ${process.platform}-${process.arch}-node24 is not marked verified in support matrix`
      );
    }
  } catch (error) {
    reasons.push(`Failed to load support matrix: ${(error as Error).message}`);
  }

  // 2. npm pack to prefix destination
  const packResult = spawnSync("npm", ["pack", "--pack-destination", prefix], {
    cwd: root,
    encoding: "utf8"
  });

  if (packResult.status !== 0) {
    reasons.push(`npm pack failed with exit code ${packResult.status}: ${packResult.stderr}`);
    return {
      status: "fail",
      tarballPath: "",
      prefix,
      printLaunchExitCode: -1,
      printLaunchOutput: "",
      preflightExitCode: -1,
      preflightOutput: "",
      matrixRowVerified,
      reasons
    };
  }

  const tarballName = packResult.stdout.trim().split("\n").filter(Boolean).pop() ?? "ganesh-0.1.0.tgz";
  const tarballPath = path.join(prefix, tarballName);

  if (!fs.existsSync(tarballPath)) {
    reasons.push(`Tarball not found at expected location: ${tarballPath}`);
    return {
      status: "fail",
      tarballPath,
      prefix,
      printLaunchExitCode: -1,
      printLaunchOutput: "",
      preflightExitCode: -1,
      preflightOutput: "",
      matrixRowVerified,
      reasons
    };
  }

  // 3. npm install into prefix
  const installResult = spawnSync(
    "npm",
    ["install", tarballPath, "--prefix", prefix, "--no-audit", "--no-fund"],
    {
      cwd: prefix,
      encoding: "utf8"
    }
  );

  if (installResult.status !== 0) {
    reasons.push(`npm install into prefix failed: ${installResult.stderr}`);
    return {
      status: "fail",
      tarballPath,
      prefix,
      printLaunchExitCode: -1,
      printLaunchOutput: "",
      preflightExitCode: -1,
      preflightOutput: "",
      matrixRowVerified,
      reasons
    };
  }

  // 4. Run packaged CLI with --print-launch
  const cliPath = path.join(prefix, "node_modules", "ganesh", "dist", "src", "cli.js");
  const launchResult = spawnSync(process.execPath, [cliPath, "--print-launch", projectDir], {
    cwd: prefix,
    encoding: "utf8"
  });

  const printLaunchExitCode = launchResult.status ?? 1;
  const printLaunchOutput = `${launchResult.stdout ?? ""}${launchResult.stderr ?? ""}`;

  if (printLaunchExitCode !== 0) {
    reasons.push(`Packaged CLI --print-launch failed with exit ${printLaunchExitCode}: ${printLaunchOutput}`);
  }

  // 5. Run packaged preflight
  const preflightCliPath = path.join(
    prefix,
    "node_modules",
    "ganesh",
    "dist",
    "src",
    "preflight-cli.js"
  );
  const preflightResult = spawnSync(process.execPath, [preflightCliPath, "--json"], {
    cwd: prefix,
    encoding: "utf8"
  });

  const preflightExitCode = preflightResult.status ?? 1;
  const preflightOutput = `${preflightResult.stdout ?? ""}${preflightResult.stderr ?? ""}`;

  if (preflightExitCode !== 0) {
    reasons.push(`Packaged preflight failed with exit ${preflightExitCode}: ${preflightOutput}`);
  }

  const passed = printLaunchExitCode === 0 && preflightExitCode === 0 && matrixRowVerified && reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    tarballPath,
    prefix,
    printLaunchExitCode,
    printLaunchOutput,
    preflightExitCode,
    preflightOutput,
    matrixRowVerified,
    reasons: passed ? undefined : reasons
  };
}
