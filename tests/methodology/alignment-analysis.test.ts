// story: e09s05
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  recordOrientation,
  recordResearchQuestionAlternative,
  recordDesignComparison,
  bindMethodProfile,
  recordAlignmentAudit,
  recordAnalysisPlan,
  inspectAlignment,
  createWorkerCapabilities,
  ProjectStoreError,
  type AlignmentChainLink
} from "../../src/index.js";
import {
  createMethodologyFixture,
  disposeMethodologyFixture
} from "../support/methodology-fixtures.js";

function setupAlignmentFixture() {
  const fixture = createMethodologyFixture();
  const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
    topic: "Type Safety in Dynamic Languages",
    discipline: "computing",
    immediateGoal: "Assess type checking impact on defects"
  });

  const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
    orientationId: orientation.id,
    questionText: "Does gradual typing reduce production defect density in TypeScript applications?"
  });

  const comparison = recordDesignComparison(fixture.handle, fixture.ownerCap, {
    branchId: "main",
    researchQuestionIds: [rq.id],
    designs: [
      {
        id: "design-cohort",
        name: "Historical Repository Cohort",
        rationale: "Longitudinal observation of commits before and after TypeScript adoption",
        fit: "High fit for observational data",
        feasibility: "Available GitHub commit histories",
        tensions: "Confounding project maturity",
        limits: "Observational only"
      },
      {
        id: "design-experiment",
        name: "Randomized Bug Insertion Experiment",
        rationale: "Synthetic task benchmark",
        fit: "High causal fit",
        feasibility: "Requires participant pool",
        tensions: "Artificial task setup",
        limits: "Synthetic only"
      }
    ]
  });

  const profile = bindMethodProfile(fixture.handle, fixture.ownerCap, {
    comparisonId: comparison.id,
    profileId: "quantitative",
    contextId: "computing",
    details: {
      estimandNotes: "Difference in defect rates per KLOC",
      independentObservations: true
    }
  });

  return { fixture, orientation, rq, comparison, profile };
}

describe("e09s05 alignment audits and analysis plans", () => {
  it("e09s05 alignment audit and confirmatory analysis plan persist chain uncertainty and escalation (SC-e09s05-P0-01)", () => {
    const { fixture, rq, comparison, profile } = setupAlignmentFixture();
    try {
      const chainLinks: AlignmentChainLink[] = [
        { link: "question", status: "aligned", description: "Gradual typing and defect density" },
        { link: "evidence_needed", status: "aligned", description: "Commit histories and bug fix classifications" },
        { link: "assumptions", status: "aligned", description: "Stable team composition across migration window" },
        { link: "design", status: "aligned", description: "Difference-in-differences repository cohort" },
        { link: "sampling", status: "aligned", description: "Open source TypeScript repos with >1k stars" },
        { link: "analysis", status: "aligned", description: "Negative binomial regression with fixed effects" },
        { link: "claim", status: "aligned", description: "Associational claim on defect rate reductions" }
      ];

      const audit = recordAlignmentAudit(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        rqVersionIds: [rq.id],
        chainLinks
      });

      assert.ok(audit.id.startsWith("alg_"));
      assert.equal(audit.status, "aligned");
      assert.equal(audit.chainLinks.length, 7);

      const plan = recordAnalysisPlan(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: profile.profileId,
        rqVersionIds: [rq.id],
        confirmatoryOrExploratory: "confirmatory",
        assumptions: [
          "Parallel trends assumption holds in pre-treatment periods",
          "Bug fix commit labeling has >90% precision"
        ],
        uncertainty: [
          "Possible unmeasured refactoring activity concurrent with type adoption",
          "Potential survivorship bias in active repositories"
        ],
        escalation: "owner-decision",
        escalationReason: "Owner must authorize pre-registration of parallel trends check"
      });

      assert.ok(plan.id.startsWith("anp_"));
      assert.equal(plan.confirmatoryOrExploratory, "confirmatory");
      assert.equal(plan.escalation, "owner-decision");
      assert.equal(plan.status, "current");

      const inspection = inspectAlignment(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspection.comparisonId, comparison.id);
      assert.equal(inspection.status, "aligned");
      assert.equal(inspection.needsReview, false);
      assert.ok(inspection.audit);
      assert.ok(inspection.analysisPlan);
      assert.equal(inspection.analysisPlan.confirmatoryOrExploratory, "confirmatory");
      assert.equal(inspection.analysisPlan.assumptions.length, 2);
      assert.equal(inspection.analysisPlan.uncertainty.length, 2);
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s05 causal claim on associational design flags mismatch and longitudinal label without identification does not clear it (SC-e09s05-P0-02)", () => {
    const { fixture, rq, comparison } = setupAlignmentFixture();
    try {
      const chainLinks: AlignmentChainLink[] = [
        { link: "question", status: "aligned", description: "Causal impact of static analysis" },
        { link: "evidence_needed", status: "aligned", description: "Observational bug logs" },
        { link: "assumptions", status: "mismatch", description: "Confounding not controlled" },
        { link: "design", status: "mismatch", description: "Observational cross-sectional design" },
        { link: "sampling", status: "aligned", description: "Convenience sample" },
        { link: "analysis", status: "aligned", description: "Correlation analysis" },
        { link: "claim", status: "mismatch", description: "Asserts static analysis CAUSES 50% fewer bugs" }
      ];

      // Causal claim on associational evidence with longitudinal label but NO identification strategy
      const audit = recordAlignmentAudit(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        rqVersionIds: [rq.id],
        chainLinks,
        claimType: "causal",
        evidenceType: "associational",
        designLabel: "longitudinal",
        identificationStrategy: "" // empty identification strategy!
      });

      // AC-12: Must remain mismatch!
      assert.equal(audit.status, "mismatch");
      assert.ok(
        audit.issues.some((i) =>
          i.includes("longitudinal design label alone does not establish causal identification")
        )
      );

      const inspection = inspectAlignment(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspection.status, "mismatch");
      assert.ok(
        inspection.issues.some((i) =>
          i.includes("longitudinal design label alone does not establish causal identification")
        )
      );
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s05 analysis plan does not queueRun or execute work runs, and rq version supersession marks needs-review (SC-e09s05-P0-03, SC-e09s05-P1-04)", () => {
    const { fixture, orientation, rq, comparison, profile } = setupAlignmentFixture();
    try {
      // Record analysis plan
      const plan = recordAnalysisPlan(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        profileId: profile.profileId,
        rqVersionIds: [rq.id],
        confirmatoryOrExploratory: "exploratory",
        assumptions: ["Data distribution approximately normal"],
        uncertainty: ["High variance in test coverage"],
        escalation: "none",
        escalationReason: "Exploratory pilot does not require external review"
      });

      // SC-e09s05-P0-03: Verify NO work runs exist in the database (never calls queueRun / execute)
      const workRunRow = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM work_runs")
        .get() as { count: number } | undefined;
      assert.equal(Number(workRunRow?.count ?? 0), 0);

      // Record alignment audit linked to v1 RQ
      recordAlignmentAudit(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        rqVersionIds: [rq.id],
        chainLinks: [{ link: "question", status: "aligned", description: "RQ v1 check" }]
      });

      // Before superseding, inspection is not needs-review
      const beforeInspect = inspectAlignment(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(beforeInspect.needsReview, false);
      assert.equal(beforeInspect.status, "aligned");

      // AC-07: Supersede RQ version v1 with v2
      recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How does strict null checks specifically reduce production crash rates in TypeScript?",
        supersedesId: rq.id
      });

      // SC-e09s05-P1-04 / AC-07: After RQ supersession, inspectAlignment MUST return needs-review
      const afterInspect = inspectAlignment(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(afterInspect.needsReview, true);
      assert.equal(afterInspect.status, "needs-review");
      assert.equal(afterInspect.audit?.status, "needs-review");
      assert.equal(afterInspect.analysisPlan?.status, "needs-review");
      assert.ok(afterInspect.issues.some((i) => i.includes("superseded")));
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s05 worker without methodology:audit is denied and released behavior passes regression (SC-e09s05-P1-04)", () => {
    const { fixture, rq, comparison, profile } = setupAlignmentFixture();
    try {
      // Create worker capability with ONLY methodology:inspect (no methodology:audit)
      const inspectOnlyWorker = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["methodology:inspect", "methodology:frame"]
      });

      // Attempt to record alignment audit without methodology:audit
      assert.throws(
        () =>
          recordAlignmentAudit(fixture.handle, inspectOnlyWorker, {
            comparisonId: comparison.id,
            rqVersionIds: [rq.id],
            chainLinks: [{ link: "question", status: "aligned", description: "Audit attempt" }]
          }),
        (err: unknown) => {
          assert.ok(err instanceof ProjectStoreError);
          assert.equal(err.code, "forbidden");
          return true;
        }
      );

      // Attempt to record analysis plan without methodology:audit
      assert.throws(
        () =>
          recordAnalysisPlan(fixture.handle, inspectOnlyWorker, {
            comparisonId: comparison.id,
            profileId: profile.profileId,
            rqVersionIds: [rq.id],
            confirmatoryOrExploratory: "exploratory",
            assumptions: ["assumed"],
            uncertainty: ["uncertain"],
            escalation: "none",
            escalationReason: "Self contained"
          }),
        (err: unknown) => {
          assert.ok(err instanceof ProjectStoreError);
          assert.equal(err.code, "forbidden");
          return true;
        }
      );

      // Attempt with worker from wrong project
      const wrongProjectWorker = createWorkerCapabilities({
        projectId: "different-project-id",
        projectRoot: fixture.root,
        allowedOperations: ["methodology:audit"]
      });

      assert.throws(
        () =>
          recordAlignmentAudit(fixture.handle, wrongProjectWorker, {
            comparisonId: comparison.id,
            rqVersionIds: [rq.id],
            chainLinks: [{ link: "question", status: "aligned", description: "Audit attempt" }]
          }),
        (err: unknown) => {
          assert.ok(err instanceof ProjectStoreError);
          assert.equal(err.code, "forbidden");
          return true;
        }
      );
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });
});
