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

test("e18s02 SC-e18s02-P0-02 validateLicenseInventory fails closed on missing version, license, or notice", () => {
  const temp = createTempPrefix("license-fields-");
  try {
    const fakePkg = {
      name: "ganesh",
      version: "0.1.0",
      license: "UNLICENSED",
      dependencies: {
        "csv-parse": "7.0.2"
      }
    };
    const fakeInventory = {
      version: "0.1.0",
      productLicense: "UNLICENSED",
      dependencies: [
        {
          name: "csv-parse",
          version: "", // Missing version!
          license: "MIT",
          noticePointer: "NOTICE"
        }
      ]
    };
    const pkgPath = path.join(temp.dir, "package.json");
    const invPath = path.join(temp.dir, "inventory.json");
    fs.writeFileSync(pkgPath, JSON.stringify(fakePkg, null, 2), "utf8");
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");
    fs.writeFileSync(path.join(temp.dir, "NOTICE"), "notice content", "utf8");

    const report = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("version")),
      "must fail closed when version is empty"
    );

    // Test missing license
    fakeInventory.dependencies[0].version = "7.0.2";
    fakeInventory.dependencies[0].license = "";
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");
    const reportNoLic = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(reportNoLic.status, "fail");
    assert.ok(
      reportNoLic.reasons && reportNoLic.reasons.some((r: string) => r.includes("license")),
      "must fail closed when license is empty"
    );

    // Test missing noticePointer
    fakeInventory.dependencies[0].license = "MIT";
    fakeInventory.dependencies[0].noticePointer = "";
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");
    const reportNoNotice = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(reportNoNotice.status, "fail");
    assert.ok(
      reportNoNotice.reasons && reportNoNotice.reasons.some((r: string) => r.includes("notice")),
      "must fail closed when noticePointer is empty"
    );

    // Test nonexistent notice file
    fakeInventory.dependencies[0].noticePointer = "NONEXISTENT_NOTICE";
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");
    const reportBadNotice = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(reportBadNotice.status, "fail");
    assert.ok(
      reportBadNotice.reasons && reportBadNotice.reasons.some((r: string) => r.includes("not found")),
      "must fail closed when notice file does not exist"
    );
  } finally {
    temp.cleanup();
  }
});

test("e18s02 SC-e18s02-P0-02 validateLicenseInventory fails closed when productLicense mismatches package.json", () => {
  const temp = createTempPrefix("license-mismatch-");
  try {
    const fakePkg = {
      name: "ganesh",
      version: "0.1.0",
      license: "UNLICENSED",
      dependencies: {
        "csv-parse": "7.0.2"
      }
    };
    const fakeInventory = {
      version: "0.1.0",
      productLicense: "Proprietary", // Mismatches UNLICENSED
      dependencies: [
        {
          name: "csv-parse",
          version: "7.0.2",
          license: "MIT",
          noticePointer: "NOTICE"
        }
      ]
    };
    const pkgPath = path.join(temp.dir, "package.json");
    const invPath = path.join(temp.dir, "inventory.json");
    fs.writeFileSync(pkgPath, JSON.stringify(fakePkg, null, 2), "utf8");
    fs.writeFileSync(invPath, JSON.stringify(fakeInventory, null, 2), "utf8");
    fs.writeFileSync(path.join(temp.dir, "NOTICE"), "notice content", "utf8");

    const report = validateLicenseInventory(temp.dir, {
      packageJsonPath: pkgPath,
      inventoryPath: invPath
    });
    assert.equal(report.status, "fail");
    assert.ok(
      report.reasons && report.reasons.some((r: string) => r.includes("mismatch") || r.includes("Proprietary")),
      "must fail closed when productLicense mismatches"
    );
  } finally {
    temp.cleanup();
  }
});
