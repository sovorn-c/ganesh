// story: e19s05
// scenario: SC-e19s05-P1-04
import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
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
import { runReleaseQualification } from "../../src/qualification/release-gate.js";

describe("e19s05 release qualification evidence", () => {
  it("lists R19 with an E19 verification pointer and rejects invented passed evidence", () => {
    const report = runReleaseQualification(process.cwd(), { mode: "catalog" });
    const r19 = report.outcomes.find((outcome) => outcome.id === "R19");
    assert.ok(r19);
    assert.equal(r19.status, "passed");
    assert.match(r19.verificationPointer ?? "", /e19/i);

    const { dir, cleanup } = createTempDir();
    try {
      writeTempProjectCatalog(dir, createValidAcceptanceCatalog(), "acceptance-catalog.json");
      writeTempProjectCatalog(dir, createValidAdversarialCatalog(), "adversarial-catalog.json");
      writeTempProjectCatalog(dir, createValidCompetencyInventory(), "competency-inventory.json");
      writeTempProjectCatalog(dir, { ...createValidOutcomeEvidence(), outcomes: [...createValidOutcomeEvidence().outcomes, { id: "R19", epicId: "e19", title: "Workspace polish", status: "passed", verificationPointer: "invented-e19" }] }, "outcome-evidence.json");
      writeTempCasePacks(dir, createValidCasePacks());
      writeTempEvaluations(dir, createValidHumanEvaluations());
      const invented = runReleaseQualification(dir);
      const inventedR19 = invented.outcomes.find((outcome) => outcome.id === "R19");
      assert.ok(inventedR19);
      assert.equal(inventedR19.status, "blocked");
      assert.ok(invented.reasons?.some((reason) => /invented evidence.*R19/i.test(reason)));
    } finally {
      cleanup();
    }
  });
});
