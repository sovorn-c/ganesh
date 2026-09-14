// story: e09s04
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordOrientation,
  recordResearchQuestionAlternative,
  recordDesignComparison,
  bindMethodProfile,
  inspectProfileFit,
  listMethodProfiles,
  METHOD_PROFILES,
  SUPPORTED_CONTEXTS,
  recordAppraisal
} from "../../src/index.js";
import {
  createMethodologyFixture,
  disposeMethodologyFixture
} from "../support/methodology-fixtures.js";
import { projectFixture, disposeFixture } from "../support/project-fixtures.js";
import { evidenceWorker, importText } from "../support/evidence-fixtures.js";

function setupComparisonFixture() {
  const fixture = createMethodologyFixture();
  const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
    topic: "Developer Feedback Loops",
    discipline: "computing",
    immediateGoal: "Evaluate method profile suitability"
  });

  const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
    orientationId: orientation.id,
    questionText: "How do structured feedback loops affect pull request turnaround time?"
  });

  const comparison = recordDesignComparison(fixture.handle, fixture.ownerCap, {
    branchId: "main",
    researchQuestionIds: [rq.id],
    designs: [
      {
        id: "design-quant",
        name: "Observational Mining",
        rationale: "Statistical analysis of PR turnaround times",
        fit: "High quantitative fit",
        feasibility: "Available Git histories",
        tensions: "Confounding team sizes",
        limits: "Observational only"
      },
      {
        id: "design-qual",
        name: "Developer Interview Study",
        rationale: "Explore cognitive experience of PR reviews",
        fit: "High qualitative fit",
        feasibility: "Volunteer engineers",
        tensions: "Self-report bias",
        limits: "Qualitative depth not statistical generalization"
      }
    ]
  });

  return { fixture, comparison };
}

describe("e09s04 method profiles across supported contexts", () => {
  it("e09s04 quantitative qualitative mixed-methods and artifact-evaluation profiles bind to supported context (SC-e09s04-P0-01)", () => {
    const { fixture, comparison } = setupComparisonFixture();
    try {
      const profiles = listMethodProfiles();
      assert.equal(profiles.length, 4);
      for (const p of profiles) {
        assert.ok(METHOD_PROFILES.includes(p.id));
      }

      // 1. Quantitative with empirical-social-science
      const quant = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "quantitative",
        contextId: "empirical-social-science",
        details: { estimandNotes: "Average treatment effect of review checklists", independentObservations: true }
      });
      assert.equal(quant.profileId, "quantitative");
      assert.equal(quant.contextId, "empirical-social-science");
      assert.equal(quant.competence, "supported");
      assert.equal(quant.profileFit, "applicable");

      // 2. Qualitative with education
      const qual = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "qualitative",
        contextId: "education",
        details: { approach: "phenomenology" }
      });
      assert.equal(qual.profileId, "qualitative");
      assert.equal(qual.contextId, "education");
      assert.equal(qual.competence, "supported");
      assert.equal(qual.profileFit, "applicable");

      // 3. Mixed methods with hci
      const mixed = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "mixed-methods",
        contextId: "hci",
        details: { integrationRationale: "Interviews contextualize log telemetry distributions" }
      });
      assert.equal(mixed.profileId, "mixed-methods");
      assert.equal(mixed.contextId, "hci");
      assert.equal(mixed.competence, "supported");
      assert.equal(mixed.profileFit, "applicable");

      // 4. Artifact evaluation with computing
      const designSci = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "artifact-evaluation-design-science",
        contextId: "computing",
        details: { evaluationPlan: "Microbenchmarks plus 2-week developer pilot deployment" }
      });
      assert.equal(designSci.profileId, "artifact-evaluation-design-science");
      assert.equal(designSci.contextId, "computing");
      assert.equal(designSci.competence, "supported");
      assert.equal(designSci.profileFit, "applicable");

      // Inspect latest
      const inspect = inspectProfileFit(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspect.profileId, "artifact-evaluation-design-science");
      assert.equal(inspect.contextId, "computing");
      assert.equal(inspect.competence, "supported");
      assert.equal(inspect.profileFit, "applicable");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s04 reflexive TA does not fail for missing inter-coder or statistical-power, mixed-methods needs integration, and artifact-evaluation without evaluation is implementation-not-contribution (SC-e09s04-P0-02, SC-e09s04-P0-03)", () => {
    const { fixture, comparison } = setupComparisonFixture();
    try {
      // AC-11: Reflexive thematic analysis binding without ICR or statistical power MUST NOT fail
      const rta = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "qualitative",
        contextId: "hci",
        details: {
          approach: "reflexive-thematic-analysis"
          // explicitly omitting interCoderAgreement and statisticalPower
        }
      });
      assert.notEqual(rta.profileFit, "fail");
      assert.equal(rta.profileFit, "applicable");

      const rtaInspect = inspectProfileFit(fixture.handle, fixture.ownerCap, comparison.id);
      assert.notEqual(rtaInspect.profileFit, "fail");
      assert.equal(rtaInspect.profileFit, "applicable");
      assert.ok(rtaInspect.rationales.some((r) => r.includes("Reflexive thematic analysis")));

      // AC-13: Mixed methods with empty integrationRationale is incomplete
      const mmIncomplete = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "mixed-methods",
        contextId: "information-systems",
        details: { integrationRationale: "" }
      });
      assert.equal(mmIncomplete.profileFit, "incomplete");

      const mmInspect = inspectProfileFit(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(mmInspect.profileFit, "incomplete");
      assert.ok(mmInspect.rationales.some((r) => r.includes("integration rationale")));

      // AC-13: Artifact evaluation with no evaluation plan is implementation-not-contribution
      const aeNoEval = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "artifact-evaluation-design-science",
        contextId: "computing",
        details: { evaluationPlan: "   " }
      });
      assert.equal(aeNoEval.profileFit, "implementation-not-contribution");

      const aeInspect = inspectProfileFit(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(aeInspect.profileFit, "implementation-not-contribution");
      assert.ok(aeInspect.rationales.some((r) => r.includes("implementation, not an empirical research contribution")));
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s04 unsupported disciplinary context is labeled outside-competence (SC-e09s04-P1-04)", () => {
    const { fixture, comparison } = setupComparisonFixture();
    try {
      const unsupported = bindMethodProfile(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: "quantitative",
        contextId: "quantum-astrophysics",
        details: { estimandNotes: "Cosmic ray density" }
      });

      assert.equal(unsupported.competence, "outside-competence");
      assert.equal(unsupported.profileFit, "outside-competence");

      const inspect = inspectProfileFit(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspect.competence, "outside-competence");
      assert.equal(inspect.profileFit, "outside-competence");
      assert.ok(inspect.rationales.some((r) => r.includes("outside verified system competence")));
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s04 released E07 appraisal methodKind behavior remains intact as regression check (SC-e09s04-P0-01)", () => {
    const fixture = projectFixture();
    try {
      const imported = importText(fixture.handle, "e09s04-e07-regression-source");
      const capability = evidenceWorker(fixture.handle);

      const appraisal = recordAppraisal(fixture.handle, capability, {
        commandId: "e09s04-appraisal-regression",
        sourceVersionId: imported.result.artifactVersionId,
        methodKind: "reflexive-thematic-analysis"
      });

      assert.equal(appraisal.result, "pass");
      assert.ok(appraisal.findings.every((f) => f.result === "not-applicable"));
    } finally {
      disposeFixture(fixture);
    }
  });
});
