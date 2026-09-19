import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import {
  runReleaseProcedure,
  validatePackagingEvidence,
  proposeSemverBump
} from "../../src/distribution/release-procedure.js";
import { runReleaseQualification } from "../../src/qualification/release-gate.js";
import {
  createTempDir,
  createValidAcceptanceCatalog,
  createValidAdversarialCatalog,
  createValidCompetencyInventory,
  createValidCasePacks,
  createValidHumanEvaluations,
  createValidOutcomeEvidence,
  writeTempProjectCatalog,
  writeTempCasePacks,
  writeTempEvaluations
} from "../support/qualification-fixtures.js";

test("e18s05 SC-e18s05-P0-01 release procedure composes qualify packaging evidence and semver proposal with not-authorized default", () => {
  const root = process.cwd();
  const report = runReleaseProcedure(root);

  assert.equal(report.publication, "not-authorized");
  assert.equal(report.hostedCi, false);
  assert.equal(report.productionReady, false);

  assert.ok(report.qualify);
  assert.equal(report.qualify.localQualification, "pass");

  assert.ok(report.packagingEvidence);
  assert.equal(report.packagingEvidence.status, "pass");
  assert.equal(report.packagingEvidence.supportMatrixValid, true);
  assert.equal(report.packagingEvidence.packageManifestValid, true);
  assert.equal(report.packagingEvidence.licenseInventoryValid, true);
  assert.equal(report.packagingEvidence.signingApplicabilityValid, true);
  assert.equal(report.packagingEvidence.guideInventoryValid, true);
  assert.equal(report.packagingEvidence.lifecyclePreserved, true);

  assert.ok(report.semverProposal);
  assert.equal(report.semverProposal.currentVersion, "0.1.0");
  assert.ok(["major", "minor", "patch", "none"].includes(report.semverProposal.bumpType));
  assert.ok(report.semverProposal.commitsAnalyzed > 0);

  // Verify CLI with --json
  const cliPath = path.join(root, "dist", "src", "release-cli.js");
  const stdout = execFileSync("node", [cliPath, "--json"], {
    cwd: root,
    encoding: "utf8"
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.publication, "not-authorized");
  assert.equal(parsed.qualify.localQualification, "pass");
  assert.equal(parsed.packagingEvidence.status, "pass");
  assert.equal(parsed.hostedCi, false);
  assert.equal(parsed.productionReady, false);
});

test("e18s05 SC-e18s05-P0-02 authorize publication flag sets authorized-local without npm publish or hosted production-ready", () => {
  const root = process.cwd();
  const report = runReleaseProcedure(root, { authorizePublication: true });

  assert.equal(report.publication, "authorized-local");
  assert.equal(report.hostedCi, false);
  assert.equal(report.productionReady, false);
  assert.equal(report.status, "pass");

  // Verify CLI with --i-authorize-publication --json
  const cliPath = path.join(root, "dist", "src", "release-cli.js");
  const stdout = execFileSync("node", [cliPath, "--i-authorize-publication", "--json"], {
    cwd: root,
    encoding: "utf8"
  });

  const parsed = JSON.parse(stdout);
  assert.equal(parsed.publication, "authorized-local");
  assert.equal(parsed.status, "pass");
  assert.equal(parsed.hostedCi, false);
  assert.equal(parsed.productionReady, false);
});

test("e18s05 SC-e18s05-P0-03 R18 requires packaging-evidence and rejects invented catalog-passed rows", () => {
  const { dir, cleanup } = createTempDir();
  try {
    writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
    writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
    writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
    writeTempCasePacks(dir, createValidCasePacks());
    writeTempEvaluations(dir, createValidHumanEvaluations());

    // Create outcome evidence claiming R18 is passed, but NO packaging evidence files exist
    const outcomesWithR18Passed = {
      version: "0.1.0",
      outcomes: Array.from({ length: 18 }, (_, i) => ({
        id: `R${String(i + 1).padStart(2, "0")}`,
        epicId: `e${String(i + 1).padStart(2, "0")}`,
        title: `Outcome R${String(i + 1).padStart(2, "0")}`,
        status: "passed"
      }))
    };
    writeTempProjectCatalog(dir, outcomesWithR18Passed, "outcome-evidence.json");

    const report = runReleaseQualification(dir);
    assert.equal(report.localQualification, "failed");
    assert.equal(report.shipment, "blocked");

    const r18 = report.outcomes.find((o) => o.id === "R18");
    assert.ok(r18);
    assert.equal(r18.status, "blocked");
    assert.ok(r18.verificationPointer?.includes("invented evidence"));
    assert.ok(report.reasons?.some((r) => r.includes("Invented evidence")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P1-04 valid packaging-evidence allows R18 passed but missing B06 qualified human coverage blocks shipment", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
    writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
    writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
    writeTempCasePacks(dir, createValidCasePacks());
    writeTempEvaluations(dir, createValidHumanEvaluations());

    // Copy valid packaging evidence into temp project
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Set R18 passed in catalog
    const outcomesWithR18Passed = {
      version: "0.1.0",
      outcomes: Array.from({ length: 18 }, (_, i) => ({
        id: `R${String(i + 1).padStart(2, "0")}`,
        epicId: `e${String(i + 1).padStart(2, "0")}`,
        title: `Outcome R${String(i + 1).padStart(2, "0")}`,
        status: "passed"
      }))
    };
    writeTempProjectCatalog(dir, outcomesWithR18Passed, "outcome-evidence.json");

    const pkgReport = validatePackagingEvidence(dir);
    assert.equal(pkgReport.status, "pass");

    const report = runReleaseQualification(dir);
    assert.equal(report.localQualification, "pass");
    const r18 = report.outcomes.find((o) => o.id === "R18");
    assert.ok(r18);
    assert.equal(r18.status, "passed");

    // Human evaluation has only synthetic evaluations -> B06 qualified human coverage is absent
    assert.equal(report.humanEvaluation.hasQualifiedHumanCoverage, false);
    // Shipment must stay blocked because of B06!
    assert.equal(report.shipment, "blocked");
  } finally {
    cleanup();
  }
});
