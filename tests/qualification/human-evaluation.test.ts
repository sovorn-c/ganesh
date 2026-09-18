// story: e17s04
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  evaluateHumanProtocol,
  loadCasePacks,
  loadHumanEvaluationRecords
} from "../../src/index.js";
import {
  createTempDir,
  createValidCasePacks,
  createValidHumanEvaluations,
  writeTempCasePacks,
  writeTempEvaluations
} from "../support/qualification-fixtures.js";

describe("e17s04 qualified-human evaluation protocol across method profiles and contexts", () => {
  // SC-e17s04-P0-01: Profiles, contexts and rubrics coverage
  it("e17s04 case-pack coverage includes all four method profiles and five supported contexts with rubrics (SC-e17s04-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      const evals = createValidHumanEvaluations();
      writeTempCasePacks(dir, casePacks);
      writeTempEvaluations(dir, evals);

      const loadedPacks = loadCasePacks(dir);
      assert.equal(loadedPacks.length, 5);

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "pass");
      assert.equal(report.casesTotal, 5);
      assert.equal(report.casesEvaluated, 5);
      assert.equal(report.scholarlyCertification, "not-inferred");

      const expectedProfiles = ["quantitative", "qualitative", "mixed-methods", "artifact-evaluation"];
      for (const p of expectedProfiles) {
        assert.ok(report.profilesCovered.includes(p), `Expected profile ${p}`);
      }

      const expectedContexts = [
        "empirical-social-science",
        "information-systems",
        "hci",
        "education",
        "computing"
      ];
      for (const c of expectedContexts) {
        assert.ok(report.contextsCovered.includes(c), `Expected context ${c}`);
      }
    } finally {
      cleanup();
    }
  });

  it("e17s04 repository canonical case-pack set covers all 4 profiles, 5 contexts, and has evaluations (SC-e17s04-P0-01)", () => {
    const repoRoot = path.resolve(".");
    const packs = loadCasePacks(repoRoot);
    assert.equal(packs.length, 8);

    const evals = loadHumanEvaluationRecords(repoRoot);
    assert.equal(evals.length, 8);

    const report = evaluateHumanProtocol(repoRoot);
    assert.equal(report.status, "pass");
    assert.equal(report.casesTotal, 8);
    assert.equal(report.casesEvaluated, 8);
    assert.equal(report.scholarlyCertification, "not-inferred");
    assert.equal(report.hasQualifiedHumanCoverage, false); // synthetic fixtures
    assert.ok(report.evaluatorKindsPresent.includes("synthetic"));
  });

  it("e17s04 loads individual case-pack and evaluation JSON files when aggregate files are absent", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacksDir = path.join(dir, "case-packs");
      fs.mkdirSync(casePacksDir, { recursive: true });
      fs.writeFileSync(
        path.join(casePacksDir, "case.json"),
        JSON.stringify({ id: "CP-FALLBACK", methodProfile: "quantitative" }),
        "utf8"
      );

      const evaluationsDir = path.join(dir, "human-evaluations");
      fs.mkdirSync(evaluationsDir, { recursive: true });
      fs.writeFileSync(
        path.join(evaluationsDir, "evaluation.json"),
        JSON.stringify({ caseId: "CP-FALLBACK", evaluatorKind: "synthetic" }),
        "utf8"
      );

      const packs = loadCasePacks(dir, { casePacksDir });
      const evaluations = loadHumanEvaluationRecords(dir, { evaluationsDir });
      assert.equal(packs.length, 1);
      assert.equal(packs[0]?.id, "CP-FALLBACK");
      assert.equal(evaluations.length, 1);
      assert.equal(evaluations[0]?.caseId, "CP-FALLBACK");
    } finally {
      cleanup();
    }
  });

  it("e17s04 case-pack fails closed on missing method profile or context coverage (SC-e17s04-P0-01)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      // Drop artifact-evaluation case
      const cases = (casePacks.cases as Array<Record<string, unknown>>).filter(
        (c) => c.methodProfile !== "artifact-evaluation"
      );
      writeTempCasePacks(dir, { ...casePacks, cases });
      writeTempEvaluations(dir, createValidHumanEvaluations());

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /missing.*method profile.*artifact-evaluation/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // SC-e17s04-P0-02: Missing records fail closed
  it("e17s04 fails closed when a required case pack has no human-evaluation record (SC-e17s04-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      const evals = createValidHumanEvaluations();
      // Remove record for CP-TEST-03
      const records = (evals.records as Array<Record<string, unknown>>).filter(
        (r) => r.caseId !== "CP-TEST-03"
      );
      writeTempCasePacks(dir, casePacks);
      writeTempEvaluations(dir, { ...evals, records });

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => r.includes("CP-TEST-03")));
      const failedRow = report.rows.find((r) => r.caseId === "CP-TEST-03");
      assert.ok(failedRow);
      assert.equal(failedRow.status, "failed");
    } finally {
      cleanup();
    }
  });

  it("e17s04 fails closed on missing case-pack directory (SC-e17s04-P0-02)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "failed");
      assert.ok(report.reasons && report.reasons.some((r) => /not found|missing/i.test(r)));
    } finally {
      cleanup();
    }
  });

  // SC-e17s04-P0-03: Disagreement retention and rejection of model-only ground truth
  it("e17s04 rejects model-only ground truth on disagreement case (SC-e17s04-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      // Mark CP-TEST-03 as disagreement case
      (casePacks.cases as Array<Record<string, unknown>>)[2].isDisagreementCase = true;
      writeTempCasePacks(dir, casePacks);

      const evals = createValidHumanEvaluations();
      // Set model-only ground truth on CP-TEST-03
      (evals.records as Array<Record<string, unknown>>)[2].modelGroundTruthOnly = true;
      (evals.records as Array<Record<string, unknown>>)[2].oracleKind = "model-written-answer";
      writeTempEvaluations(dir, evals);

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "failed");
      assert.ok(
        report.reasons &&
          report.reasons.some((r) => /model-written answer as sole ground truth/i.test(r))
      );
    } finally {
      cleanup();
    }
  });

  it("e17s04 accepts disagreement case when both positions and dissent are retained (SC-e17s04-P0-03)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      (casePacks.cases as Array<Record<string, unknown>>)[2].isDisagreementCase = true;
      writeTempCasePacks(dir, casePacks);

      const evals = createValidHumanEvaluations();
      (evals.records as Array<Record<string, unknown>>)[2].dissentPreserved = true;
      (evals.records as Array<Record<string, unknown>>)[2].retainedPositions = [
        "Position A: quantitative metrics indicate usability improvement",
        "Position B: qualitative interviews reveal workflow disruption"
      ];
      (evals.records as Array<Record<string, unknown>>)[2].modelGroundTruthOnly = false;
      writeTempEvaluations(dir, evals);

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "pass");
      const row = report.rows.find((r) => r.caseId === "CP-TEST-03");
      assert.ok(row);
      assert.equal(row.status, "pass");
    } finally {
      cleanup();
    }
  });

  // SC-e17s04-P1-04: Out-of-competence requires escalation
  it("e17s04 fails closed when out-of-competence case is graded without escalation (SC-e17s04-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      (casePacks.cases as Array<Record<string, unknown>>)[0].outOfCompetence = true;
      writeTempCasePacks(dir, casePacks);

      const evals = createValidHumanEvaluations();
      // Grade without escalation
      (evals.records as Array<Record<string, unknown>>)[0].disposition = "accept";
      (evals.records as Array<Record<string, unknown>>)[0].escalated = false;
      (evals.records as Array<Record<string, unknown>>)[0].escalationRequired = false;
      writeTempEvaluations(dir, evals);

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "failed");
      assert.ok(
        report.reasons &&
          report.reasons.some((r) => /out-of-competence.*requires escalation/i.test(r))
      );
    } finally {
      cleanup();
    }
  });

  it("e17s04 accepts out-of-competence case when escalation is recorded (SC-e17s04-P1-04)", () => {
    const { dir, cleanup } = createTempDir();
    try {
      const casePacks = createValidCasePacks();
      (casePacks.cases as Array<Record<string, unknown>>)[0].outOfCompetence = true;
      writeTempCasePacks(dir, casePacks);

      const evals = createValidHumanEvaluations();
      (evals.records as Array<Record<string, unknown>>)[0].disposition = "escalated";
      (evals.records as Array<Record<string, unknown>>)[0].escalated = true;
      (evals.records as Array<Record<string, unknown>>)[0].escalationRequired = true;
      writeTempEvaluations(dir, evals);

      const report = evaluateHumanProtocol(dir);
      assert.equal(report.status, "pass");
      const row = report.rows.find((r) => r.caseId === "CP-TEST-01");
      assert.ok(row);
      assert.equal(row.status, "pass");
    } finally {
      cleanup();
    }
  });
});
