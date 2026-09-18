// story: e17s02
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  loadAdversarialCatalog,
  runAdversarialQualification
} from "../../src/index.js";
import {
  createTempDir,
  createValidAdversarialCatalog,
  createFakeRunner,
  writeTempProjectCatalog
} from "../support/qualification-fixtures.js";

describe("e17s02 named adversarial safety classes harness", () => {
  // SC-e17s02-P0-01: Six named classes required in catalog and execute modes
  it("e17s02 complete catalog reports all six safety classes in catalog mode (SC-e17s02-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      writeTempProjectCatalog(dir, catalog, "adversarial-catalog.json");

      const loaded = loadAdversarialCatalog(dir);
      assert.equal(loaded.classes.length, 6);

      const report = runAdversarialQualification(dir, { mode: "catalog" });
      assert.equal(report.status, "pass");
      assert.equal(report.classesTotal, 6);
      assert.equal(report.classesPassing, 6);
      assert.equal(report.classesFailing, 0);
      assert.equal(report.securityCertification, "not-inferred");

      const expectedClasses = [
        "approval-forgery",
        "stale-state",
        "malicious-import",
        "permission-race",
        "cancellation",
        "recovery"
      ];
      for (const cls of expectedClasses) {
        const row = report.rows.find((r) => r.classId === cls);
        assert.ok(row, `Missing row for ${cls}`);
        assert.equal(row.status, "pass");
      }
    } finally {
      cleanup();
    }
  });

  it("e17s02 repository canonical adversarial catalog loads and passes catalog mode (SC-e17s02-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const loaded = loadAdversarialCatalog(repoRoot);
    assert.equal(loaded.classes.length, 6);

    const report = runAdversarialQualification(repoRoot, { mode: "catalog" });
    assert.equal(report.status, "pass");
    assert.equal(report.classesTotal, 6);
    assert.equal(report.classesPassing, 6);
    assert.equal(report.classesFailing, 0);
  });

  // SC-e17s02-P0-03: Mapping and execute mode for fail-closed classes
  it("e17s02 execute mode runs mapped approval-forgery, stale-state, malicious-import, cancellation and recovery tests (SC-e17s02-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      writeTempProjectCatalog(dir, catalog, "adversarial-catalog.json");

      const runner = createFakeRunner({ passed: true, matchedCount: 1 });
      const report = runAdversarialQualification(dir, { mode: "execute", runner });

      assert.equal(report.status, "pass");
      assert.equal(report.classesPassing, 6);
      assert.equal(report.classesFailing, 0);
    } finally {
      cleanup();
    }
  });

  it("e17s02 fails closed when runner reports test failure for a class (SC-e17s02-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      writeTempProjectCatalog(dir, catalog, "adversarial-catalog.json");

      const runner = createFakeRunner({ passed: true, matchedCount: 1 }, {
        "e17s02.*approval-forgery": { passed: false, matchedCount: 1, error: "forgery bypass detected" }
      });
      const report = runAdversarialQualification(dir, { mode: "execute", runner });

      assert.equal(report.status, "failed");
      const row = report.rows.find((r) => r.classId === "approval-forgery");
      assert.ok(row);
      assert.equal(row.status, "failed");
    } finally {
      cleanup();
    }
  });

  // SC-e17s02-P1-04: Omission or unrelated mapping fails closed
  it("e17s02 fails closed when omitting a named safety class (e.g. omits recovery) (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      const partialClasses = catalog.classes.filter((c) => c.classId !== "recovery");
      writeTempProjectCatalog(dir, { ...catalog, classes: partialClasses }, "adversarial-catalog.json");

      const report = runAdversarialQualification(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("recovery")));
    } finally {
      cleanup();
    }
  });

  it("e17s02 fails closed on unknown class id in catalog (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      const withExtra = [
        ...catalog.classes,
        {
          classId: "speculative-safety-class",
          title: "Unknown class",
          testPattern: "test.*extra",
          verificationPointer: "tests/extra.test.ts"
        }
      ];
      writeTempProjectCatalog(dir, { ...catalog, classes: withExtra }, "adversarial-catalog.json");

      const report = runAdversarialQualification(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /unknown/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s02 fails closed on duplicate class id in catalog (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      const withDuplicate = [
        ...catalog.classes.slice(0, 5),
        catalog.classes[0] // duplicate approval-forgery instead of recovery
      ];
      writeTempProjectCatalog(dir, { ...catalog, classes: withDuplicate }, "adversarial-catalog.json");

      const report = runAdversarialQualification(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /duplicate|missing/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s02 fails closed when mapping class to unrelated non-matching test pattern (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      // Map permission-race to an unrelated writing export pattern
      const modifiedClasses = catalog.classes.map((c) => {
        if (c.classId === "permission-race") {
          return {
            ...c,
            testPattern: "e13s04 permitted writing and review packet export",
            verificationPointer: "tests/writing/writing-export.test.ts"
          };
        }
        return c;
      });
      writeTempProjectCatalog(dir, { ...catalog, classes: modifiedClasses }, "adversarial-catalog.json");

      const report = runAdversarialQualification(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /permission-race.*domain|unrelated|non-match/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s02 fails closed on 0 test matches in execute mode (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = createValidAdversarialCatalog();
      writeTempProjectCatalog(dir, catalog, "adversarial-catalog.json");

      const runner = createFakeRunner({ passed: true, matchedCount: 1 }, {
        "e17s02.*cancel": { passed: true, matchedCount: 0 }
      });
      const report = runAdversarialQualification(dir, { mode: "execute", runner });

      assert.equal(report.status, "failed");
      const row = report.rows.find((r) => r.classId === "cancellation");
      assert.ok(row);
      assert.equal(row.status, "failed");
      assert.ok(row.reason && /no tests matched|0 tests/i.test(row.reason));
    } finally {
      cleanup();
    }
  });

  it("e17s02 refuses certified flag in adversarial catalog (SC-e17s02-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const catalog = {
        ...createValidAdversarialCatalog(),
        certified: true
      };
      writeTempProjectCatalog(dir, catalog, "adversarial-catalog.json");

      assert.throws(() => loadAdversarialCatalog(dir), /certified/i);
      const report = runAdversarialQualification(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /certified/i.test(r)));
    } finally {
      cleanup();
    }
  });
});
