// story: e18s02
import fs from "node:fs";
import path from "node:path";
import type { LicenseInventory, LicenseInventoryReport } from "./types.js";

const AUTHORIZED_PRODUCT_LICENSES = new Set(["UNLICENSED", undefined, ""]);

export function validateLicenseInventory(
  root: string = process.cwd(),
  options?: {
    inventoryPath?: string;
    noticePath?: string;
    packageJsonPath?: string;
  }
): LicenseInventoryReport {
  const projectRoot = path.resolve(root);
  const packageJsonPath = options?.packageJsonPath ?? path.join(projectRoot, "package.json");

  if (!fs.existsSync(packageJsonPath)) {
    throw new Error(`package.json not found at ${packageJsonPath}`);
  }

  const pkg = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as {
    license?: string;
    dependencies?: Record<string, string>;
  };

  const reasons: string[] = [];

  // Check product license honesty - no invented open-source SPDX identifier allowed without owner pin
  const rawLicense = pkg.license?.trim();
  if (rawLicense && !AUTHORIZED_PRODUCT_LICENSES.has(rawLicense)) {
    reasons.push(
      `Invented Ganesh SPDX license: "${rawLicense}" is not authorized; product license must be undeclared or UNLICENSED`
    );
  }

  const inventoryPath =
    options?.inventoryPath ??
    path.join(projectRoot, "specs", "distribution", "license-inventory.json");

  if (!fs.existsSync(inventoryPath)) {
    reasons.push(`License inventory file not found at ${inventoryPath}`);
    return {
      status: "fail",
      dependenciesCount: 0,
      lgplCompliant: false,
      productLicense: rawLicense ?? "UNLICENSED",
      reasons
    };
  }

  const inventory = JSON.parse(fs.readFileSync(inventoryPath, "utf8")) as LicenseInventory;
  const directDeps = Object.keys(pkg.dependencies ?? {});
  const inventoriedMap = new Map(inventory.dependencies?.map((d) => [d.name, d]) ?? []);

  for (const dep of directDeps) {
    if (!inventoriedMap.has(dep)) {
      reasons.push(`Direct dependency "${dep}" is missing from license inventory`);
    }
  }

  // Check LGPL-3.0 compliance for biblatex-csl-converter
  let lgplCompliant = false;
  const biblatex = inventoriedMap.get("biblatex-csl-converter");
  if (!biblatex) {
    reasons.push("biblatex-csl-converter is missing from license inventory");
  } else {
    if (!biblatex.license.includes("LGPL-3.0")) {
      reasons.push(`biblatex-csl-converter must declare LGPL-3.0, got ${biblatex.license}`);
    }
    if (!biblatex.sourceLink || !biblatex.sourceLink.includes("biblatex-csl-converter")) {
      reasons.push("biblatex-csl-converter must declare source-link for LGPL-3.0 obligation");
    }

    const noticeFileName = biblatex.noticePointer ?? "NOTICE";
    const noticePath = options?.noticePath ?? path.join(projectRoot, noticeFileName);
    if (!fs.existsSync(noticePath)) {
      reasons.push(`NOTICE file not found at ${noticePath}`);
    } else {
      const noticeContent = fs.readFileSync(noticePath, "utf8");
      const mentionsBiblatex = noticeContent.includes("biblatex-csl-converter");
      const mentionsLgpl = noticeContent.includes("LGPL-3.0");
      const mentionsSource = biblatex.sourceLink ? noticeContent.includes(biblatex.sourceLink) : false;

      if (!mentionsBiblatex || !mentionsLgpl || !mentionsSource) {
        reasons.push("NOTICE file must contain biblatex-csl-converter LGPL-3.0 notice and source link");
      } else {
        lgplCompliant = true;
      }
    }
  }

  const passed = reasons.length === 0;

  return {
    status: passed ? "pass" : "fail",
    dependenciesCount: inventory.dependencies?.length ?? 0,
    lgplCompliant,
    productLicense: rawLicense ?? "UNLICENSED",
    reasons: passed ? undefined : reasons
  };
}
