// story: e18s05
import fs from "node:fs";
import path from "node:path";
import { loadSupportMatrix, validateSupportMatrix } from "./support-matrix.js";
import { validateLicenseInventory } from "./license-inventory.js";
import { validateSigningApplicability } from "./signing-applicability.js";
import { validateGuideInventory } from "./guide-inventory.js";
import type { PackagingEvidenceReport } from "./types.js";

export function validatePackagingEvidence(
  root: string = process.cwd()
): PackagingEvidenceReport {
  const projectRoot = path.resolve(root);
  const reasons: string[] = [];

  // 1. Support matrix
  let supportMatrixValid = false;
  try {
    const matrix = loadSupportMatrix(projectRoot);
    const report = validateSupportMatrix(matrix);
    if (report.status === "pass" && matrix.combinations.some((c) => c.status === "verified")) {
      supportMatrixValid = true;
    } else {
      reasons.push("Support matrix validation failed or has no verified combinations");
    }
  } catch (err) {
    reasons.push(`Support matrix missing or invalid: ${(err as Error).message}`);
  }

  // 2. Package manifest and files whitelist
  let packageManifestValid = false;
  const packageJsonPath = path.join(projectRoot, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { files?: string[] };
      if (Array.isArray(pkg.files) && pkg.files.length > 0) {
        packageManifestValid = true;
      } else {
        reasons.push("package.json files whitelist missing or empty");
      }
    } catch {
      reasons.push("package.json unreadable");
    }
  } else {
    reasons.push("package.json not found");
  }

  // 3. License inventory
  let licenseInventoryValid = false;
  try {
    const licReport = validateLicenseInventory(projectRoot);
    if (licReport.status === "pass" && licReport.lgplCompliant) {
      licenseInventoryValid = true;
    } else {
      reasons.push("License inventory validation failed");
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
      reasons.push("Signing applicability validation failed");
    }
  } catch (err) {
    reasons.push(`Signing applicability missing or invalid: ${(err as Error).message}`);
  }

  // 5. Guide inventory
  let guideInventoryValid = false;
  try {
    const guideReport = validateGuideInventory(projectRoot);
    if (guideReport.status === "pass") {
      guideInventoryValid = true;
    } else {
      reasons.push(`Guide inventory validation failed: ${guideReport.reasons?.join("; ") ?? "missing guides"}`);
    }
  } catch (err) {
    reasons.push(`Guide inventory missing or invalid: ${(err as Error).message}`);
  }

  // 6. Lifecycle preservation
  let lifecyclePreserved = false;
  const setupDocsPath = path.join(projectRoot, "docs", "setup-and-recovery.md");
  const s03VerifyPath = path.join(projectRoot, "specs", "verifications", "e18s03-verify.yaml");
  if (fs.existsSync(setupDocsPath)) {
    const content = fs.readFileSync(setupDocsPath, "utf8");
    if (content.includes("Upgrade, rollback, and product uninstall")) {
      lifecyclePreserved = true;
    }
  }
  if (!lifecyclePreserved && fs.existsSync(s03VerifyPath)) {
    lifecyclePreserved = true;
  }
  if (!lifecyclePreserved) {
    reasons.push("Lifecycle preservation documentation or verification evidence missing");
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
