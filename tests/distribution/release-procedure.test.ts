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
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
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

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed on incomplete files whitelist or missing package-manifest.json", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Case 1: files whitelist only ["README.md"]
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "ganesh", version: "0.1.0", files: ["README.md"] }, null, 2),
      "utf8"
    );
    const report1 = validatePackagingEvidence(dir);
    assert.equal(report1.status, "fail");
    assert.equal(report1.packageManifestValid, false);
    assert.ok(report1.reasons?.some((r) => r.includes("files whitelist missing")));

    // Case 2: valid package.json but package-manifest.json deleted
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.rmSync(path.join(dir, "specs", "distribution", "package-manifest.json"));
    const report2 = validatePackagingEvidence(dir);
    assert.equal(report2.status, "fail");
    assert.equal(report2.packageManifestValid, false);
    assert.ok(report2.reasons?.some((r) => r.includes("package-manifest.json not found")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed when e18s03-verify.yaml is empty or invalid", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Overwrite e18s03-verify.yaml with empty string
    fs.writeFileSync(path.join(dir, "specs", "verifications", "e18s03-verify.yaml"), "", "utf8");

    const report = validatePackagingEvidence(dir);
    assert.equal(report.status, "fail");
    assert.equal(report.lifecyclePreserved, false);
    assert.ok(report.reasons?.some((r) => r.includes("e18s03 verification evidence is empty")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed when existing tarball digest mismatches manifest", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Write a corrupted tarball at the manifest's tarball path
    fs.writeFileSync(path.join(dir, "ganesh-0.1.0.tgz"), "corrupted tarball content", "utf8");

    const report = validatePackagingEvidence(dir);
    assert.equal(report.status, "fail");
    assert.equal(report.packageManifestValid, false);
    assert.ok(report.reasons?.some((r) => r.includes("Tarball digest mismatch")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed on reproduction case: files: [README.md] and deleted package-manifest.json", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Exact review reproduction: files: ["README.md"] and delete package-manifest.json
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ name: "ganesh", version: "0.1.0", files: ["README.md"] }, null, 2),
      "utf8"
    );
    const manifestPath = path.join(dir, "specs", "distribution", "package-manifest.json");
    if (fs.existsSync(manifestPath)) {
      fs.rmSync(manifestPath);
    }

    const report = validatePackagingEvidence(dir);
    assert.equal(report.status, "fail");
    assert.equal(report.packageManifestValid, false);
    assert.ok(report.reasons?.some((r) => r.includes("files whitelist missing")));
    assert.ok(report.reasons?.some((r) => r.includes("package-manifest.json not found")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed when support matrix verified row evidence pointer is nonexistent", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Overwrite support matrix with verified row pointing to nonexistent evidence
    fs.writeFileSync(
      path.join(dir, "specs", "distribution", "support-matrix.json"),
      JSON.stringify({
        version: "0.1.0",
        scholarlyCertification: false,
        combinations: [
          {
            os: process.platform,
            arch: process.arch,
            nodeMajor: 24,
            status: "verified",
            evidencePointer: "specs/verifications/nonexistent-e18-evidence.yaml"
          }
        ]
      }, null, 2),
      "utf8"
    );

    const report = validatePackagingEvidence(dir);
    assert.equal(report.status, "fail");
    assert.equal(report.supportMatrixValid, false);
    assert.ok(report.reasons?.some((r) => r.includes("evidence pointer not found")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-03 validatePackagingEvidence fails closed when package manifest files omit required guides", () => {
  const { dir, cleanup } = createTempDir();
  try {
    const root = process.cwd();
    fs.cpSync(path.join(root, "specs", "distribution"), path.join(dir, "specs", "distribution"), { recursive: true });
    fs.cpSync(path.join(root, "specs", "verifications"), path.join(dir, "specs", "verifications"), { recursive: true });
    fs.cpSync(path.join(root, "docs"), path.join(dir, "docs"), { recursive: true });
    fs.copyFileSync(path.join(root, "package.json"), path.join(dir, "package.json"));
    fs.copyFileSync(path.join(root, "NOTICE"), path.join(dir, "NOTICE"));

    // Overwrite package-manifest.json to omit docs
    const manifestPath = path.join(dir, "specs", "distribution", "package-manifest.json");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    manifest.files = ["package.json", "README.md", "NOTICE"]; // no docs!
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf8");

    const report = validatePackagingEvidence(dir);
    assert.equal(report.status, "fail");
    assert.equal(report.packageManifestValid, false);
    assert.ok(report.reasons?.some((r) => r.includes("omit required guides")));
  } finally {
    cleanup();
  }
});

test("e18s05 SC-e18s05-P0-01 proposeSemverBump analyzes full history without -n 100 truncation when untagged", () => {
  const proposal = proposeSemverBump(process.cwd());
  assert.equal(proposal.currentVersion, "0.1.0");
  assert.ok(proposal.commitsAnalyzed > 100, `expected full untagged commit history > 100 commits, got ${proposal.commitsAnalyzed}`);
  assert.equal(proposal.bumpType, "minor");
  assert.equal(proposal.proposedVersion, "0.2.0");
});
