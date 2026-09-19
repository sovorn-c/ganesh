// story: e18s02
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import type {
  PackageArtifactOptions,
  PackageArtifactReport,
  PackageManifest,
  VerifyPackageArtifactOptions,
  VerifyPackageArtifactResult
} from "./types.js";

export async function buildPackageArtifact(
  root: string = process.cwd(),
  options?: PackageArtifactOptions
): Promise<PackageArtifactReport> {
  const projectRoot = path.resolve(root);
  const packageJsonPath = path.join(projectRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    name?: string;
    version?: string;
    files?: string[];
  };

  const name = pkg.name ?? "ganesh";
  const version = pkg.version ?? "0.1.0";
  const filesWhitelist = Array.isArray(pkg.files) && pkg.files.length > 0;

  const destination = path.resolve(options?.destination ?? projectRoot);
  if (!fs.existsSync(destination)) {
    fs.mkdirSync(destination, { recursive: true });
  }

  const reasons: string[] = [];

  if (!filesWhitelist) {
    reasons.push("package.json does not declare a files whitelist");
  }

  const packResult = spawnSync(
    "npm",
    ["pack", "--json", "--pack-destination", destination],
    {
      cwd: projectRoot,
      encoding: "utf8"
    }
  );

  if (packResult.status !== 0) {
    reasons.push(`npm pack failed with exit ${packResult.status}: ${packResult.stderr}`);
    return {
      status: "fail",
      tarballPath: "",
      digest: "",
      filesWhitelisted: false,
      sensitiveFilesExcluded: false,
      reasons
    };
  }

  let packedInfo: { filename?: string; files?: Array<{ path: string }> } | undefined;
  try {
    const parsed = JSON.parse(packResult.stdout.trim());
    packedInfo = Array.isArray(parsed) ? parsed[0] : parsed;
  } catch {
    reasons.push("Failed to parse npm pack --json output");
  }

  const tarballName = packedInfo?.filename ?? `${name}-${version}.tgz`;
  const tarballPath = path.join(destination, tarballName);

  if (!fs.existsSync(tarballPath)) {
    reasons.push(`Tarball not found at ${tarballPath}`);
    return {
      status: "fail",
      tarballPath,
      digest: "",
      filesWhitelisted: filesWhitelist,
      sensitiveFilesExcluded: false,
      reasons
    };
  }

  // Compute SHA-256 digest
  const tarballBytes = fs.readFileSync(tarballPath);
  const digest = crypto.createHash("sha256").update(tarballBytes).digest("hex");

  const filesList: string[] = packedInfo?.files?.map((f) => f.path) ?? [];

  // Check exclusion of sensitive files
  const hasEnv = filesList.some((f) => f.includes(".env"));
  const hasGanesh = filesList.some((f) => f.includes(".ganesh"));
  const hasTests = filesList.some((f) => f.startsWith("tests/"));

  if (hasEnv) {
    reasons.push("Tarball contains .env file");
  }
  if (hasGanesh) {
    reasons.push("Tarball contains .ganesh directory");
  }
  if (hasTests) {
    reasons.push("Tarball contains tests/ directory");
  }

  const sensitiveFilesExcluded = !hasEnv && !hasGanesh && !hasTests;

  const manifest: PackageManifest = {
    name,
    version,
    tarball: tarballName,
    digest,
    files: filesList
  };

  let manifestPath: string | undefined;
  if (options?.writeManifest !== false) {
    const manifestDir = path.join(projectRoot, "specs", "distribution");
    if (!fs.existsSync(manifestDir)) {
      fs.mkdirSync(manifestDir, { recursive: true });
    }
    manifestPath = path.join(manifestDir, "package-manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  }

  const passed = filesWhitelist && sensitiveFilesExcluded && reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    tarballPath,
    manifestPath,
    digest,
    manifest,
    filesWhitelisted: filesWhitelist,
    sensitiveFilesExcluded,
    reasons: passed ? undefined : reasons
  };
}

export function verifyPackageArtifact(
  options: VerifyPackageArtifactOptions
): VerifyPackageArtifactResult {
  const reasons: string[] = [];

  if (!options.expectedDigest || options.expectedDigest.trim().length === 0) {
    reasons.push("Expected digest is empty");
    return { status: "fail", reasons };
  }

  if (!fs.existsSync(options.tarballPath)) {
    reasons.push(`Tarball does not exist at ${options.tarballPath}`);
    return { status: "fail", reasons };
  }

  const bytes = fs.readFileSync(options.tarballPath);
  const actualDigest = crypto.createHash("sha256").update(bytes).digest("hex");

  if (actualDigest.toLowerCase() !== options.expectedDigest.toLowerCase()) {
    reasons.push(`Tarball digest mismatch: expected ${options.expectedDigest}, got ${actualDigest}`);
    return { status: "fail", actualDigest, reasons };
  }

  return {
    status: "pass",
    actualDigest
  };
}
