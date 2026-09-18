// story: e17s03
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {
  loadCompetencyInventory,
  validateCompetencyInventory,
  extractDirectDependencies
} from "../../src/index.js";
import {
  createTempDir,
  createValidCompetencyInventory,
  writeTempProjectCatalog
} from "../support/qualification-fixtures.js";

describe("e17s03 competency metadata, worked failures, licenses and provenance", () => {
  // SC-e17s03-P0-01: Valid inventory is accepted
  it("e17s03 valid inventory with required docs/03 metadata and worked-failure examples passes (SC-e17s03-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const loaded = loadCompetencyInventory(dir);
      assert.equal(loaded.competencies.length, 1);

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "pass");
      assert.equal(report.competenciesTotal, 1);
      assert.equal(report.competenciesPassing, 1);
      assert.equal(report.competenciesFailing, 0);
      assert.equal(report.scholarlyCertification, "not-inferred");
    } finally {
      cleanup();
    }
  });

  it("e17s03 repository canonical competency inventory loads all 22 competencies and is valid (SC-e17s03-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const loaded = loadCompetencyInventory(repoRoot);
    assert.equal(loaded.competencies.length, 22);

    const report = validateCompetencyInventory(repoRoot);
    assert.equal(report.status, "pass");
    assert.equal(report.competenciesTotal, 22);
    assert.equal(report.competenciesPassing, 22);
    assert.equal(report.competenciesFailing, 0);
    assert.equal(report.scholarlyCertification, "not-inferred");
  });

  // SC-e17s03-P0-02: Missing required fields fail
  it("e17s03 fails closed on missing worked-failure example in competency item (SC-e17s03-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      delete comp[0].workedFailure;
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /missing.*workedFailure/i.test(r)));
      assert.equal(report.rows[0].status, "failed");
      assert.ok(report.rows[0].reason && /workedFailure/i.test(report.rows[0].reason));
    } finally {
      cleanup();
    }
  });

  it("e17s03 fails closed on missing license or source fields in competency item (SC-e17s03-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      delete comp[0].license;
      delete comp[0].source;
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /missing.*(license|source)/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s03 fails closed on missing catalog file or invalid JSON (SC-e17s03-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /not found|missing/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // SC-e17s03-P0-03: Certification claims are rejected
  it("e17s03 rejects scholarlyCertified claim at top level of inventory (SC-e17s03-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = {
        ...createValidCompetencyInventory(),
        scholarlyCertified: true
      };
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      assert.throws(() => loadCompetencyInventory(dir), /certified|statistically/i);
      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /certified|statistically/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s03 rejects statisticallyValidated claim in competency item (SC-e17s03-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      comp[0].statisticallyValidated = true;
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /statistically.*validated|certified/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // SC-e17s03-P1-04: Weak output provenance fails
  it("e17s03 fails closed when outputSchema does not separate observations from inference (SC-e17s03-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      comp[0].outputSchema = {
        separatesObservationsFromInferences: false,
        includesContraryOrLimitations: true
      };
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /separate.*observation/i.test(r)));
    } finally {
      cleanup();
    }
  });

  it("e17s03 fails closed when outputSchema omits contrary or limitation fields (SC-e17s03-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      comp[0].outputSchema = {
        separatesObservationsFromInferences: true,
        includesContraryOrLimitations: false
      };
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /contrary.*limitation/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // Task e17s03-t03: Direct package license cross-check
  it("e17s03 cross-checks direct-package license evidence against docs/dependencies.md (SC-e17s03-P0-02)", () => {
    const repoRoot = path.resolve(".");
    const deps = extractDirectDependencies(path.join(repoRoot, "docs", "dependencies.md"));
    assert.ok(deps.has("typescript"));
    assert.ok(deps.has("eslint"));
    assert.ok(deps.has("@types/node"));
    assert.ok(deps.has("@earendil-works/pi-coding-agent"));

    const { dir, cleanup } = createTempDir();
    try {
      const inventory = createValidCompetencyInventory();
      // Add an unlisted direct package dependency
      const comp = inventory.competencies as Array<Record<string, unknown>>;
      comp[0].directDependencies = ["unauthorized-external-package-xyz"];
      writeTempProjectCatalog(dir, inventory, "competency-inventory.json");

      const report = validateCompetencyInventory(dir, {
        dependenciesDocPath: path.join(repoRoot, "docs", "dependencies.md")
      });
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /direct package.*unauthorized-external-package-xyz/i.test(r)));
    } finally {
      cleanup();
    }
  });
});
