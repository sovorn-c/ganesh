// story: e17s05
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  renderReleaseQualificationReport,
  runReleaseQualification
} from "../../src/index.js";
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

describe("e17s05 local automation-ready release-qualification gate", () => {
  // SC-e17s05-P0-01: Composed qualification gate and renderers
  it("e17s05 runReleaseQualification composes acceptance, adversarial, competency and human-evaluation (SC-e17s05-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempProjectCatalog(dir, createValidOutcomeEvidence(), "outcome-evidence.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "pass");
      assert.ok(report.acceptance);
      assert.ok(report.adversarial);
      assert.ok(report.competency);
      assert.ok(report.humanEvaluation);
      assert.equal(report.scholarlyCertification, "not-inferred");
      assert.equal(report.hostedCi, false);
      assert.equal(report.productionReady, false);

      const humanRender = renderReleaseQualificationReport(report);
      assert.ok(humanRender.includes("Local Qualification: PASS"));
      assert.ok(humanRender.includes("Acceptance Catalog:"));
      assert.ok(humanRender.includes("Adversarial Classes:"));
      assert.ok(humanRender.includes("Competency Metadata:"));
      assert.ok(humanRender.includes("Human Evaluation:"));
    } finally {
      cleanup();
    }
  });

  it("e17s05 repository canonical files pass localQualification in catalog mode (SC-e17s05-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const report = runReleaseQualification(repoRoot, { mode: "catalog" });
    assert.equal(report.localQualification, "pass");
    assert.equal(report.shipment, "blocked"); // R18 and B06 block shipment
    assert.equal(report.hostedCi, false);
    assert.equal(report.productionReady, false);
    assert.equal(report.scholarlyCertification, "not-inferred");
  });

  // SC-e17s05-P0-02: Critical defects block local qualification and shipment
  it("e17s05 critical safety defect blocks localQualification and shipment (SC-e17s05-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempProjectCatalog(dir, createValidOutcomeEvidence(), "outcome-evidence.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      // Insert a critical safety defect
      const defectLedger = {
        version: "0.1.0",
        defects: [
          {
            id: "DEFECT-CRIT-01",
            severity: "critical",
            title: "Cross-project file boundary bypass vulnerability",
            status: "open"
          }
        ]
      };
      writeTempProjectCatalog(dir, defectLedger, "safety-defects.json");

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "failed");
      assert.equal(report.shipment, "blocked");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("DEFECT-CRIT-01")));
    } finally {
      cleanup();
    }
  });

  // SC-e17s05-P0-03: Outcomes listed; R18 not invented
  it("e17s05 lists outcomes R01 through R19 without inventing R18 pass (SC-e17s05-P0-03)", () => {
    const repoRoot = path.resolve(".");
    const report = runReleaseQualification(repoRoot, { mode: "catalog" });

    assert.equal(report.outcomes.length, 19);
    const r18 = report.outcomes.find((o) => o.id === "R18");
    assert.ok(r18, "R18 must be present in outcome list");
    assert.equal(r18.status, "blocked");
    assert.notEqual(r18.status, "passed");

    for (let i = 1; i <= 19; i++) {
      const id = `R${String(i).padStart(2, "0")}`;
      const found = report.outcomes.find((o) => o.id === id);
      assert.ok(found, `Expected outcome ${id} in report`);
    }
  });

  it("e17s05 blocks shipment when human evaluation lacks qualified-human coverage (SC-e17s05-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempProjectCatalog(dir, createValidOutcomeEvidence(), "outcome-evidence.json");
      writeTempCasePacks(dir, createValidCasePacks());
      // createValidHumanEvaluations has evaluatorKind: "synthetic"
      writeTempEvaluations(dir, createValidHumanEvaluations());

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "pass");
      assert.equal(report.shipment, "blocked");
      assert.equal(report.humanEvaluation.hasQualifiedHumanCoverage, false);
    } finally {
      cleanup();
    }
  });

  // SC-e17s05-P1-04: Forbidden flags stay unset
  it("e17s05 guarantees hosted-ci, production-ready and scholarly-certified cannot be set (SC-e17s05-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempProjectCatalog(dir, createValidOutcomeEvidence(), "outcome-evidence.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      const report = runReleaseQualification(dir);
      assert.strictEqual(report.hostedCi, false);
      assert.strictEqual(report.productionReady, false);
      assert.strictEqual(report.scholarlyCertification, "not-inferred");
    } finally {
      cleanup();
    }
  });

  // CLI execution test
  it("e17s05 qualify CLI outputs JSON with --json and exits 0 on local pass (SC-e17s05-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const cliPath = path.join(repoRoot, "dist", "src", "qualify-cli.js");

    const stdout = execFileSync("node", [cliPath, "--json"], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    const parsed = JSON.parse(stdout);
    assert.equal(parsed.localQualification, "pass");
    assert.equal(parsed.shipment, "blocked");
    assert.equal(parsed.hostedCi, false);
    assert.equal(parsed.productionReady, false);
    assert.equal(parsed.scholarlyCertification, "not-inferred");
    assert.equal(parsed.outcomes.length, 19);
  });

  it("e17s05 qualify CLI renders human summary by default (SC-e17s05-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const cliPath = path.join(repoRoot, "dist", "src", "qualify-cli.js");

    const stdout = execFileSync("node", [cliPath], {
      cwd: repoRoot,
      encoding: "utf8"
    });

    assert.ok(stdout.includes("Ganesh Release Qualification Report"));
    assert.ok(stdout.includes("Local Qualification: PASS"));
    assert.ok(stdout.includes("Shipment:            BLOCKED"));
  });

  // E17-004: Incomplete scope outcomes fail local qualification
  it("e17s05 fails local qualification when required scope outcomes R01-R17 are missing or incomplete (E17-004)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      // Write incomplete outcome catalog missing R18 and R10
      const incomplete = {
        version: "0.1.0",
        outcomes: [
          { id: "R01", epicId: "e01", title: "Outcome R01", status: "passed" }
        ]
      };
      writeTempProjectCatalog(dir, incomplete, "outcome-evidence.json");

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("Missing scope outcome in catalog")));
      // E17-004: All 18 outcome rows must be emitted even when missing from catalog
      assert.equal(report.outcomes.length, 19);
      const r02 = report.outcomes.find((o) => o.id === "R02");
      assert.ok(r02);
      assert.equal(r02.status, "unimplemented");
      const r18 = report.outcomes.find((o) => o.id === "R18");
      assert.ok(r18);
      assert.equal(r18.status, "blocked");
    } finally {
      cleanup();
    }
  });

  it("e17s05 passes local qualification when R18 is absent from catalog but emits blocked placeholder and blocks shipment (E17-004)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      // Valid outcomes catalog containing only R01-R17 (R18 absent)
      const outcomesWithoutR18 = {
        version: "0.1.0",
        outcomes: Array.from({ length: 17 }, (_, i) => ({
          id: `R${String(i + 1).padStart(2, "0")}`,
          epicId: `e${String(i + 1).padStart(2, "0")}`,
          title: `Outcome R${String(i + 1).padStart(2, "0")}`,
          status: "passed"
        }))
      };
      writeTempProjectCatalog(dir, outcomesWithoutR18, "outcome-evidence.json");

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "pass");
      assert.equal(report.shipment, "blocked");
      assert.equal(report.outcomes.length, 19);
      const r18 = report.outcomes.find((o) => o.id === "R18");
      assert.ok(r18);
      assert.equal(r18.status, "blocked");
      assert.ok(r18.verificationPointer?.includes("E18 release packaging"));
      assert.ok(!report.reasons || !report.reasons.some((r) => r.includes("R18")));
    } finally {
      cleanup();
    }
  });

  it("e17s05 fails local qualification when a local scope outcome is not passed (E17-004)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());

      // Valid R01-R18 outcomes, but R03 is blocked
      const validOutcomes = createValidOutcomeEvidence();
      const r03 = validOutcomes.outcomes.find((o) => o.id === "R03");
      if (r03) {
        r03.status = "blocked";
      }
      writeTempProjectCatalog(dir, validOutcomes, "outcome-evidence.json");

      const report = runReleaseQualification(dir);
      assert.equal(report.localQualification, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("Required local scope outcome R03 is not passed")));
      assert.equal(report.outcomes.length, 19);
    } finally {
      cleanup();
    }
  });
});
