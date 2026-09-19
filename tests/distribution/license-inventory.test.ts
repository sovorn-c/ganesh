import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import fs from "node:fs";
import { validateLicenseInventory } from "../../src/distribution/license-inventory.js";
import { createTempPrefix } from "../support/distribution-fixtures.js";

test("e18s02 SC-e18s02-P0-02 validateLicenseInventory verifies direct dependencies and LGPL notices for biblatex-csl-converter", () => {
  const report = validateLicenseInventory(process.cwd());
  assert.equal(report.status, "pass");
  assert.equal(report.lgplCompliant, true);
  assert.ok(report.dependenciesCount >= 9, "all direct dependencies must be inventoried");
  assert.equal(report.productLicense, "UNLICENSED");
});

test("e18s02 SC-e18s02-P0-02 validateLicenseInventory fails closed when an invented Ganesh SPDX license is declared", () => {
  const temp = createTempPrefix("license-spdx-");
  try {
    const fakePkg = {
      name: "ganesh",
      version: "0.1.0",
      license: "MIT", // Invented SPDX license without owner pin!
      dependencies: {
        "csv-parse": "7.0.2"
      }
    };
    const pkgPath = path.join(temp.dir, "package.json");
    fs.writeFileSync(pkgPath, JSON.stringify(fakePkg, null, 2), "utf8");

    const report = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath
    });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("invented") || r.includes("SPDX") || r.includes("MIT")),
      "must fail closed on invented SPDX license"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s02 SC-e18s02-P0-02 validateLicenseInventory fails closed when direct dependency is missing from inventory", () => {
  const temp = createTempPrefix("license-missing-");
  try {
    const fakePkg = {
      name: "ganesh",
      version: "0.1.0",
      dependencies: {
        "csv-parse": "7.0.2",
        "some-new-dep": "1.0.0"
      }
    };
    const fakeInventory = {
      version: "0.1.0",
      productLicense: "UNLICENSED",
      dependencies: [
        {
          name: "csv-parse",
          version: "7.0.2",
          license: "MIT"
        }
      ]
    };
    const pkgPath = path.join(temp.dir, "package.json");
    const invPath = path.join(temp.dir, "inventory.json");
    fs.writeFileSync(pkgPath, JSON.stringify(fakePkg, null, 2), "utf8");
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");

    const report = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("some-new-dep")),
      "must fail closed when dependency is missing from inventory"
    );
  } finally {
    temp.cleanup();
  }
});
