// story: e17s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  defaultQualificationRunner,
  loadAcceptanceCatalog,
  runAcceptanceEvidence
} from "../../src/index.js";
import {
  createTempDir,
  createValidAcceptanceCatalog,
  createFakeRunner,
  writeTempProjectCatalog
} from "../support/qualification-fixtures.js";

describe("e17s01 acceptance-scenario behavioral evidence catalog", () => {
  // SC-e17s01-P0-01: complete catalog reports all twenty ACs in catalog and execute modes
  it("e17s01 complete catalog reports AC-01 through AC-20 with mapping in catalog mode (SC-e17s01-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      const loaded = loadAcceptanceCatalog(dir);
      assert.equal(loaded.scenarios.length, 20);

      const report = runAcceptanceEvidence(dir, { mode: "catalog" });
      assert.equal(report.status, "pass");
      assert.equal(report.scenariosTotal, 20);
      assert.equal(report.scenariosPassing, 20);
      assert.equal(report.scenariosFailing, 0);
      assert.equal(report.rows.length, 20);

      for (let i = 1; i <= 20; i++) {
        const id = `AC-${String(i).padStart(2, "0")}`;
        const row = report.rows.find((r) => r.scenarioId === id);
        assert.ok(row, `Missing row for ${id}`);
        assert.equal(row.status, "pass");
        assert.ok(row.testPattern.length > 0);
        assert.ok(row.verificationPointer.length > 0);
      }
    } finally {
      cleanup();
    }
  });

  it("e17s01 execute mode runs mapped patterns with runner and reports pass (SC-e17s01-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      const runner = createFakeRunner({ passed: true, matchedCount: 2 });
      const report = runAcceptanceEvidence(dir, { mode: "execute", runner });

      assert.equal(report.status, "pass");
      assert.equal(report.scenariosPassing, 20);
      assert.equal(report.scenariosFailing, 0);
      for (const row of report.rows) {
        assert.equal(row.status, "pass");
        assert.equal(row.matchedCount, 2);
      }
    } finally {
      cleanup();
    }
  });

  it("e17s01 default runner executes a mapped verification test", () => {
    const previousTestContext = process.env.NODE_TEST_CONTEXT;
    delete process.env.NODE_TEST_CONTEXT;
    try {
      const result = defaultQualificationRunner(
        "e17s02.*class",
        "tests/qualification/adversarial-suite.test.ts"
      );

      assert.equal(result.passed, true, result.error);
      assert.ok(result.matchedCount > 0);
    } finally {
      if (previousTestContext === undefined) {
        delete process.env.NODE_TEST_CONTEXT;
      } else {
        process.env.NODE_TEST_CONTEXT = previousTestContext;
      }
    }
  });

  it("e17s01 repository canonical catalog maps AC-01 through AC-20 (SC-e17s01-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const loaded = loadAcceptanceCatalog(repoRoot);
    assert.equal(loaded.scenarios.length, 20);

    const report = runAcceptanceEvidence(repoRoot, { mode: "catalog" });
    assert.equal(report.status, "pass");
    assert.equal(report.scenariosTotal, 20);
    assert.equal(report.scenariosPassing, 20);
    assert.equal(report.scenariosFailing, 0);
  });

  // SC-e17s01-P0-02: fail-closed validation on missing, unknown, duplicate or non-matching
  it("e17s01 fails closed on missing catalog file (SC-e17s01-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      assert.throws(() => loadAcceptanceCatalog(dir), /missing|not found/i);
      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /missing|not found/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s01 fails closed when missing an AC scenario (e.g. omits AC-16) (SC-e17s01-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      const partialScenarios = catalog.scenarios.filter((s) => s.scenarioId !== "AC-16");
      writeTempProjectCatalog(dir, { ...catalog, scenarios: partialScenarios });

      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("AC-16")));
    } finally {
      cleanup();
    }
  });

  it("e17s01 fails closed on unknown scenario id (e.g. AC-21) (SC-e17s01-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      const withExtra = [
        ...catalog.scenarios,
        {
          scenarioId: "AC-21",
          title: "Unknown scenario",
          testPattern: "test.*extra",
          verificationPointer: "tests/extra.test.ts"
        }
      ];
      writeTempProjectCatalog(dir, { ...catalog, scenarios: withExtra });

      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /unknown.*AC-21|AC-21.*unknown/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s01 fails closed on duplicate scenario id (SC-e17s01-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      const duplicateScenarios = [
        ...catalog.scenarios.slice(0, 19),
        catalog.scenarios[0] // duplicate AC-01 instead of AC-20
      ];
      writeTempProjectCatalog(dir, { ...catalog, scenarios: duplicateScenarios });

      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /duplicate|missing/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s01 fails closed on non-match pattern in execute mode (SC-e17s01-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      // Runner reports 0 matches for AC-04
      const runner = createFakeRunner({ passed: true, matchedCount: 1 }, {
        [catalog.scenarios[3].testPattern]: { passed: true, matchedCount: 0 }
      });
      const report = runAcceptanceEvidence(dir, { mode: "execute", runner });

      assert.equal(report.status, "failed");
      const ac04Row = report.rows.find((r) => r.scenarioId === "AC-04");
      assert.ok(ac04Row);
      assert.equal(ac04Row.status, "failed");
      assert.ok(ac04Row.reason && /no tests matched|non-match|0 tests/i.test(ac04Row.reason));
    } finally {
      cleanup();
    }
  });

  // SC-e17s01-P0-03: certification refusal and not-inferred
  it("e17s01 reports scholarlyCertification as not-inferred on success (SC-e17s01-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "pass");
      assert.equal(report.scholarlyCertification, "not-inferred");
    } finally {
      cleanup();
    }
  });

  it("e17s01 refuses certified flag or certified claim in catalog (SC-e17s01-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = {
        ...createValidAcceptanceCatalog(),
        certified: true
      };
      writeTempProjectCatalog(dir, catalog);

      assert.throws(() => loadAcceptanceCatalog(dir), /certified/i);
      const report = runAcceptanceEvidence(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /certified/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // SC-e17s01-P1-04: runner failure and secret/participant redaction
  it("e17s01 fails closed when runner reports test failure (SC-e17s01-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      const runner = createFakeRunner({ passed: true, matchedCount: 1 }, {
        [catalog.scenarios[0].testPattern]: {
          passed: false,
          matchedCount: 1,
          error: "Assertion failed in AC-01 test"
        }
      });
      const report = runAcceptanceEvidence(dir, { mode: "execute", runner });

      assert.equal(report.status, "failed");
      const ac01Row = report.rows.find((r) => r.scenarioId === "AC-01");
      assert.ok(ac01Row);
      assert.equal(ac01Row.status, "failed");
    } finally {
      cleanup();
    }
  });

  it("e17s01 redacts secret and participant strings from report output (SC-e17s01-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAcceptanceCatalog();
      writeTempProjectCatalog(dir, catalog);

      const runner = createFakeRunner({ passed: true, matchedCount: 1 }, {
        [catalog.scenarios[0].testPattern]: {
          passed: false,
          matchedCount: 1,
          error: "token=test-secret-value Bearer secret-auth-key patient@example.test MRN-123456"
        }
      });
      const report = runAcceptanceEvidence(dir, { mode: "execute", runner });

      const serialized = JSON.stringify(report);
      assert.ok(!serialized.includes("test-secret-value"), "Leaked token in report");
      assert.ok(!serialized.includes("secret-auth-key"), "Leaked Bearer key in report");
      assert.ok(!serialized.includes("patient@example.test"), "Leaked participant email in report");
      assert.ok(serialized.includes("[REDACTED]"), "Missing redaction placeholder");
    } finally {
      cleanup();
    }
  });
});
