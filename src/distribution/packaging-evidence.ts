// story: e18s05
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { loadSupportMatrix, validateSupportMatrix } from "./support-matrix.js";
import { validateLicenseInventory } from "./license-inventory.js";
import { validateSigningApplicability } from "./signing-applicability.js";
import { loadGuideInventory, validateGuideInventory } from "./guide-inventory.js";
import type { PackagingEvidenceReport, PackageManifest } from "./types.js";

const REQUIRED_PACKAGE_WHITELIST = ["dist/src/**", "docs/**", "README.md", "NOTICE"];

export function validatePackagingEvidence(
  root: string = process.cwd()
): PackagingEvidenceReport {
  const projectRoot = path.resolve(root);
  const reasons: string[] = [];

  // 1. Support matrix with projectRoot evidence validation
  let supportMatrixValid = false;
  try {
    const matrix = loadSupportMatrix(projectRoot);
    const report = validateSupportMatrix(matrix, { projectRoot });
    if (report.status === "pass" && matrix.combinations.some((c) => c.status === "verified")) {
      supportMatrixValid = true;
    } else {
      reasons.push(
        `Support matrix validation failed: ${report.reasons?.join("; ") ?? "no verified combinations"}`
      );
    }
  } catch (err) {
    reasons.push(`Support matrix missing or invalid: ${(err as Error).message}`);
  }

  // 2. Package manifest, files whitelist, digest, and required packed guides
  let packageManifestValid = false;
  let packedFilesList: string[] | undefined;
  const packageJsonPath = path.join(projectRoot, "package.json");
  const manifestPath = path.join(projectRoot, "specs", "distribution", "package-manifest.json");

  let packageJsonOk = false;
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { files?: string[] };
      if (!Array.isArray(pkg.files) || pkg.files.length === 0) {
        reasons.push("package.json files whitelist missing or empty");
      } else {
        const hasRequired = REQUIRED_PACKAGE_WHITELIST.every((pattern) =>
          pkg.files?.some((f) => f === pattern || f.startsWith(pattern.replace("/**", "")))
        );
        if (!hasRequired) {
          reasons.push(
            `package.json files whitelist missing required paths: ${REQUIRED_PACKAGE_WHITELIST.join(", ")}`
          );
        } else {
          packageJsonOk = true;
        }
      }
    } catch {
      reasons.push("package.json unreadable");
    }
  } else {
    reasons.push("package.json not found");
  }

  let manifestOk = false;
  if (!fs.existsSync(manifestPath)) {
    reasons.push(`package-manifest.json not found at ${manifestPath}`);
  } else {
    try {
      const manifestRaw = fs.readFileSync(manifestPath, "utf8");
      const manifest = JSON.parse(manifestRaw) as Partial<PackageManifest>;

      if (!manifest.name || !manifest.version || !manifest.tarball || !manifest.digest) {
        reasons.push("package-manifest.json missing required metadata fields (name, version, tarball, digest)");
      } else if (!/^[a-f0-9]{64}$/i.test(manifest.digest)) {
        reasons.push(`package-manifest.json has invalid sha256 digest: "${manifest.digest}"`);
      } else if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
        reasons.push("package-manifest.json files list is missing or empty");
      } else {
        packedFilesList = manifest.files;

        // If tarball is present on disk, verify its digest against manifest
        const potentialTarballPaths = [
          path.join(projectRoot, manifest.tarball),
          path.join(projectRoot, "specs", "distribution", manifest.tarball)
        ];
        const existingTarball = potentialTarballPaths.find((p) => fs.existsSync(p));
        if (existingTarball) {
          const tarballBytes = fs.readFileSync(existingTarball);
          const actualDigest = crypto.createHash("sha256").update(tarballBytes).digest("hex");
          if (actualDigest.toLowerCase() !== manifest.digest.toLowerCase()) {
            reasons.push(
              `Tarball digest mismatch: manifest declares ${manifest.digest}, actual is ${actualDigest}`
            );
          } else {
            manifestOk = true;
          }
        } else {
          manifestOk = true;
        }

        // Compare required guides vs packed files
        try {
          const guideInv = loadGuideInventory(projectRoot);
          const packedSet = new Set(manifest.files.map((f) => f.replace(/^\.\//, "").replace(/\\/g, "/")));
          const missingPackedGuides: string[] = [];
          for (const guide of guideInv.guides) {
            const normPath = guide.path.replace(/^\.\//, "").replace(/\\/g, "/");
            if (!packedSet.has(normPath) && !packedSet.has(`package/${normPath}`)) {
              missingPackedGuides.push(normPath);
            }
          }
          if (missingPackedGuides.length > 0) {
            reasons.push(`Package manifest files omit required guides: ${missingPackedGuides.join(", ")}`);
            manifestOk = false;
          }
        } catch (guideErr) {
          reasons.push(`Failed to verify packed guides against guide inventory: ${(guideErr as Error).message}`);
          manifestOk = false;
        }
      }
    } catch {
      reasons.push("package-manifest.json unreadable or invalid JSON");
    }
  }

  if (packageJsonOk && manifestOk) {
    packageManifestValid = true;
  }

  // 3. License inventory
  let licenseInventoryValid = false;
  try {
    const licReport = validateLicenseInventory(projectRoot);
    if (licReport.status === "pass" && licReport.lgplCompliant) {
      licenseInventoryValid = true;
    } else {
      reasons.push(
        `License inventory validation failed: ${licReport.reasons?.join("; ") ?? "LGPL non-compliant"}`
      );
    }
  } catch (err) {
    reasons.push(`License inventory missing or invalid: ${(err as Error).message}`);
  }

  // 4. Signing applicability
  let signingApplicabilityValid = false;
  try {
    const signReport = validateSigningApplicability(projectRoot);
    if (signReport.status === "pass" && signReport.lockfileIntegrity) {
      signingApplicabilityValid = true;
    } else {
      reasons.push(
        `Signing applicability validation failed: ${signReport.reasons?.join("; ") ?? "lockfile integrity failure"}`
      );
    }
  } catch (err) {
    reasons.push(`Signing applicability missing or invalid: ${(err as Error).message}`);
  }

  // 5. Guide inventory
  let guideInventoryValid = false;
  try {
    const guideReport = validateGuideInventory(projectRoot, { packedFiles: packedFilesList });
    if (guideReport.status === "pass") {
      guideInventoryValid = true;
    } else {
      reasons.push(`Guide inventory validation failed: ${guideReport.reasons?.join("; ") ?? "missing guides"}`);
    }
  } catch (err) {
    reasons.push(`Guide inventory missing or invalid: ${(err as Error).message}`);
  }

  // 6. Lifecycle preservation (verified evidence check, not existence-only)
  let lifecyclePreserved = false;
  const setupDocsPath = path.join(projectRoot, "docs", "setup-and-recovery.md");
  const s03VerifyPath = path.join(projectRoot, "specs", "verifications", "e18s03-verify.yaml");

  let docsValid = false;
  if (fs.existsSync(setupDocsPath)) {
    const content = fs.readFileSync(setupDocsPath, "utf8");
    if (content.includes("Upgrade, rollback, and product uninstall")) {
      docsValid = true;
    } else {
      reasons.push("docs/setup-and-recovery.md missing required lifecycle section");
    }
  } else {
    reasons.push("docs/setup-and-recovery.md not found");
  }

  let verifyEvidenceValid = false;
  if (fs.existsSync(s03VerifyPath)) {
    const vContent = fs.readFileSync(s03VerifyPath, "utf8").trim();
    if (vContent.length === 0) {
      reasons.push("e18s03 verification evidence is empty");
    } else {
      const hasStoryId = /story_id:\s*e18s03/.test(vContent);
      const hasPassed = /^status:\s*passed/m.test(vContent);
      const hasTasksPassed = /task_verifications:\s*\n\s*passed:\s*true/.test(vContent);
      const hasTestsPassed = /tests:\s*\n\s*passed:\s*true/.test(vContent);

      if (!hasStoryId || !hasPassed || !hasTasksPassed || !hasTestsPassed) {
        reasons.push("e18s03 verification evidence does not record passing status and verified tasks");
      } else {
        verifyEvidenceValid = true;
      }
    }
  } else {
    reasons.push("e18s03-verify.yaml not found");
  }

  if (docsValid && verifyEvidenceValid) {
    lifecyclePreserved = true;
  }

  const passed =
    supportMatrixValid &&
    packageManifestValid &&
    licenseInventoryValid &&
    signingApplicabilityValid &&
    guideInventoryValid &&
    lifecyclePreserved &&
    reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    supportMatrixValid,
    packageManifestValid,
    licenseInventoryValid,
    signingApplicabilityValid,
    guideInventoryValid,
    lifecyclePreserved,
    reasons: passed ? undefined : reasons
  };
}
