// story: e09s03
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  createBranch,
  recordOrientation,
  recordResearchQuestionAlternative,
  recordDesignComparison,
  updateDesignComparison,
  recordSamplingPlan,
  recordInstrument,
  recordPilotPlan,
  inspectStudyDesign,
  createOwnerCapability,
  ProjectStoreError
} from "../../src/index.js";
import {
  createMethodologyFixture,
  disposeMethodologyFixture
} from "../support/methodology-fixtures.js";

describe("e09s03 methodology comparison, sampling, measurement, and pilot plans", () => {
  it("e09s03 design comparison sampling instrument and pilot feasibility without recruitment execution (SC-e09s03-P0-01)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "API Usability and Developer Cognition",
        discipline: "human-computer-interaction",
        immediateGoal: "Compare API design trade-offs"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do declarative vs imperative API styles affect cognitive error rates?"
      });

      // Record design comparison with at least two designs
      const comparison = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "main",
        researchQuestionIds: [rq.id],
        designs: [
          {
            id: "design-interviews",
            name: "Semi-Structured Developer Interviews",
            rationale: "Deep exploratory qualitative insights into developer mental models",
            fit: "High fit for early conceptual discovery",
            feasibility: "Accessible local sample of professional developers",
            tensions: "Relies on self-reported perception rather than direct error measurement",
            limits: "Small non-random sample; qualitative findings are not statistical generalizations"
          },
          {
            id: "design-experiment",
            name: "Between-Subjects Controlled Experiment",
            rationale: "Rigorous measurement of task completion time and cognitive error count",
            fit: "High fit for quantitative comparative claims",
            feasibility: "Requires instrumented lab environment and recruitment pool",
            tensions: "Higher setup cost and potential artificiality of benchmark tasks",
            limits: "Tasks may not represent full real-world codebases"
          }
        ]
      });

      assert.ok(comparison.id.startsWith("cmp_"));
      assert.equal(comparison.branchId, "main");
      assert.equal(comparison.designs.length, 2);

      // Record sampling plan (planning only, non-execution)
      const sampling = recordSamplingPlan(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "design-interviews",
        population: "Senior software engineers with TypeScript experience",
        accessPath: "Local developer meetups and professional networks",
        recruitmentApproach: "Direct informational outreach outlining interview scope and consent"
      });
      assert.ok(sampling.id.startsWith("smp_"));
      assert.equal(sampling.nonExecutionFlag, true);

      // Record instrument with rights basis
      const instrument = recordInstrument(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "design-interviews",
        name: "Developer Cognitive Walkthrough Protocol",
        purpose: "Measure usability friction and verbalized cognitive load during API usage",
        rightsBasis: "owner-original",
        fitNotes: "Authored specifically for this study with standardized think-aloud prompts"
      });
      assert.ok(instrument.id.startsWith("ins_"));
      assert.equal(instrument.rightsBasis, "owner-original");
      assert.equal(instrument.rightsIssue, false);
      assert.equal(instrument.validatedByGeneration, false);

      // Record pilot plan
      const pilot = recordPilotPlan(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "design-interviews",
        feasibilityQuestions: [
          "Do participants understand the scenario briefing within 5 minutes?",
          "Does think-aloud protocol cause noticeable fatigue after 30 minutes?"
        ],
        stopConditions: [
          "Abort session if task setup software fails twice consecutively",
          "Pause study if participant express significant cognitive distress"
        ]
      });
      assert.ok(pilot.id.startsWith("plt_"));
      assert.equal(pilot.completed, false);

      // Inspect study design
      const inspection = inspectStudyDesign(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspection.comparison.id, comparison.id);
      assert.equal(inspection.samplingPlans.length, 1);
      assert.equal(inspection.samplingPlans[0].nonExecutionFlag, true);
      assert.equal(inspection.instruments.length, 1);
      assert.equal(inspection.pilotPlans.length, 1);
      assert.equal(inspection.pilotPlans[0].completed, false);
      assert.equal(inspection.fitSummary.designCount, 2);
      assert.equal(inspection.fitSummary.hasSamplingPlan, true);
      assert.equal(inspection.fitSummary.hasInstruments, true);
      assert.equal(inspection.fitSummary.hasPilotPlan, true);
      assert.equal(inspection.fitSummary.rightsIssuesCount, 0);

      // Reopen project and verify persistence
      const reopened = openProject(fixture.root);
      try {
        const reopenedCap = createOwnerCapability(fixture.ownerId);
        const reopenedInspection = inspectStudyDesign(reopened, reopenedCap, comparison.id);
        assert.equal(reopenedInspection.comparison.id, comparison.id);
        assert.equal(reopenedInspection.samplingPlans.length, 1);
        assert.equal(reopenedInspection.instruments.length, 1);
        assert.equal(reopenedInspection.pilotPlans.length, 1);
      } finally {
        reopened.close();
      }
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s03 sampling plan refuses execute recruit contact consent collect with recruitment-not-executed (SC-e09s03-P0-02)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Participant Recruitment Invariants",
        discipline: "empirical-software-engineering",
        immediateGoal: "Test recruitment safety controls"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do researchers safeguard participant contact?"
      });

      const comparison = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "main",
        researchQuestionIds: [rq.id],
        designs: [
          {
            id: "design-a",
            name: "Observational Case Study",
            rationale: "Study in situ code reviews",
            fit: "High",
            feasibility: "High",
            tensions: "None",
            limits: "None"
          },
          {
            id: "design-b",
            name: "Repository Mining",
            rationale: "Analyze commit telemetry",
            fit: "High",
            feasibility: "High",
            tensions: "None",
            limits: "None"
          }
        ]
      });

      // Refuse forbidden recruitment actions
      const forbiddenActions = ["recruit", "execute", "contact", "consent", "collect", "RECRUIT", " Contact "];
      for (const action of forbiddenActions) {
        assert.throws(
          () =>
            recordSamplingPlan(fixture.handle, fixture.ownerCap, {
              comparisonId: comparison.id,
              designId: "design-a",
              population: "Dev participants",
              accessPath: "Direct outreach",
              recruitmentApproach: "Sending automated emails",
              action
            }),
          (err: unknown) => {
            assert.ok(err instanceof ProjectStoreError);
            assert.equal(err.code, "recruitment-not-executed");
            return true;
          }
        );
      }

      // Verify no sampling plan was recorded
      const inspection = inspectStudyDesign(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspection.samplingPlans.length, 0);
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s03 candidate designs isolate across research branches and do not mutate committed branch (SC-e09s03-P0-03)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Branch Isolation for Study Designs",
        discipline: "information-systems",
        immediateGoal: "Evaluate candidate design isolation"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do candidate designs isolate across branches?"
      });

      // Design on main branch
      const mainComp = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "main",
        researchQuestionIds: [rq.id],
        designs: [
          {
            id: "main-design-1",
            name: "Committed Baseline Design",
            rationale: "Baseline methodology",
            fit: "Established fit",
            feasibility: "Verified",
            tensions: "None",
            limits: "None"
          },
          {
            id: "main-design-2",
            name: "Alternative Baseline",
            rationale: "Secondary option",
            fit: "Moderate",
            feasibility: "Verified",
            tensions: "None",
            limits: "None"
          }
        ]
      });

      // Create branch B
      createBranch(fixture.handle, { name: "branch-experiment", branchId: "branch-experiment" });

      // Record candidate design comparison on branch B
      const branchBComp = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "branch-experiment",
        researchQuestionIds: [rq.id],
        designs: [
          {
            id: "branch-b-design-1",
            name: "Exploratory Prototype Study",
            rationale: "Radical exploratory protocol",
            fit: "High exploratory fit",
            feasibility: "Unverified",
            tensions: "High risk of dropout",
            limits: "Exploratory only"
          },
          {
            id: "branch-b-design-2",
            name: "Simulation Benchmark",
            rationale: "Automated test harness",
            fit: "Quantitative verification",
            feasibility: "High",
            tensions: "Synthetic workload",
            limits: "Synthetic only"
          }
        ]
      });

      // Mutate branch B comparison
      updateDesignComparison(fixture.handle, fixture.ownerCap, branchBComp.id, {
        designs: [
          {
            id: "branch-b-design-1-revised",
            name: "Revised Prototype Study",
            rationale: "Refined exploratory protocol",
            fit: "Refined fit",
            feasibility: "Moderate",
            tensions: "Refined tensions",
            limits: "Exploratory only"
          },
          {
            id: "branch-b-design-2",
            name: "Simulation Benchmark",
            rationale: "Automated test harness",
            fit: "Quantitative verification",
            feasibility: "High",
            tensions: "Synthetic workload",
            limits: "Synthetic only"
          }
        ]
      });

      // Verify main branch comparison was NOT mutated
      const mainInspect = inspectStudyDesign(fixture.handle, fixture.ownerCap, mainComp.id);
      assert.equal(mainInspect.branchId, "main");
      assert.equal(mainInspect.comparison.designs.length, 2);
      assert.equal(mainInspect.comparison.designs[0].id, "main-design-1");
      assert.equal(mainInspect.comparison.designs[0].name, "Committed Baseline Design");
      assert.equal(mainInspect.comparison.updatedAt, mainComp.updatedAt);

      // Verify branch B comparison has the revised designs
      const branchBInspect = inspectStudyDesign(fixture.handle, fixture.ownerCap, branchBComp.id);
      assert.equal(branchBInspect.branchId, "branch-experiment");
      assert.equal(branchBInspect.comparison.designs[0].id, "branch-b-design-1-revised");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s03 instrument rights issues record without validated-by-generation regression (SC-e09s03-P1-04)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Measurement Instrument Provenance and Rights",
        discipline: "educational-technology",
        immediateGoal: "Assess instrument rights and fake validation prevention"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do measurement instruments handle licensing and validation honesty?"
      });

      const comparison = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "main",
        researchQuestionIds: [rq.id],
        designs: [
          {
            id: "d1",
            name: "Survey Design",
            rationale: "Broad survey",
            fit: "Good",
            feasibility: "High",
            tensions: "None",
            limits: "None"
          },
          {
            id: "d2",
            name: "Interview Design",
            rationale: "Depth interview",
            fit: "Good",
            feasibility: "High",
            tensions: "None",
            limits: "None"
          }
        ]
      });

      // Instrument with unknown rights: rightsIssue must be true, validatedByGeneration must be false
      const instUnknown = recordInstrument(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "d1",
        name: "Standardized Literacy Survey",
        purpose: "Measure digital literacy",
        rightsBasis: "unknown",
        fitNotes: "Source license is currently untracked"
      });
      assert.equal(instUnknown.rightsIssue, true);
      assert.equal(instUnknown.validatedByGeneration, false);

      // Instrument with unverified reuse and caller attempt to set validatedByGeneration: true
      const instUnverified = recordInstrument(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "d1",
        name: "Adapted Motivation Scale",
        purpose: "Assess student motivation",
        rightsBasis: "unverified-reuse",
        fitNotes: "Adapted from an academic paper with unknown permissions",
        validatedByGeneration: true
      });
      assert.equal(instUnverified.rightsIssue, true);
      // Generation must never claim validated
      assert.equal(instUnverified.validatedByGeneration, false);

      // Instrument with stated-license
      const instLicensed = recordInstrument(fixture.handle, fixture.ownerCap, {
        comparisonId: comparison.id,
        designId: "d1",
        name: "Open Source Usability Scale (SUS)",
        purpose: "Standard SUS evaluation",
        rightsBasis: "stated-license",
        fitNotes: "Public domain / CC0"
      });
      assert.equal(instLicensed.rightsIssue, false);
      assert.equal(instLicensed.validatedByGeneration, false);

      const inspection = inspectStudyDesign(fixture.handle, fixture.ownerCap, comparison.id);
      assert.equal(inspection.instruments.length, 3);
      assert.equal(inspection.fitSummary.rightsIssuesCount, 2);
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s03 regression: design comparisons, sampling, instruments, and pilot plans enforce referential integrity", () => {
    const fixture = createMethodologyFixture();
    try {
      const o1 = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Topic 1",
        discipline: "hci",
        immediateGoal: "Goal 1"
      });
      const o2 = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Topic 2",
        discipline: "computing",
        immediateGoal: "Goal 2"
      });
      const rq1 = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: o1.id,
        questionText: "RQ 1?"
      });
      const rq2 = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: o2.id,
        questionText: "RQ 2?"
      });

      const validDesigns = [
        { id: "d1", name: "Design 1", rationale: "R1", fit: "F1", feasibility: "High", tensions: "None", limits: "None" },
        { id: "d2", name: "Design 2", rationale: "R2", fit: "F2", feasibility: "Med", tensions: "None", limits: "None" }
      ];

      // Nonexistent RQ in recordDesignComparison -> not-found
      assert.throws(
        () =>
          recordDesignComparison(fixture.handle, fixture.ownerCap, {
            branchId: "main",
            researchQuestionIds: ["nonexistent-rq"],
            designs: validDesigns
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Cross-orientation RQs in recordDesignComparison -> invalid-argument
      assert.throws(
        () =>
          recordDesignComparison(fixture.handle, fixture.ownerCap, {
            branchId: "main",
            researchQuestionIds: [rq1.id, rq2.id],
            designs: validDesigns
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      const comp = recordDesignComparison(fixture.handle, fixture.ownerCap, {
        branchId: "main",
        researchQuestionIds: [rq1.id],
        designs: validDesigns
      });

      // updateDesignComparison with nonexistent RQ -> not-found
      assert.throws(
        () =>
          updateDesignComparison(fixture.handle, fixture.ownerCap, comp.id, {
            researchQuestionIds: ["nonexistent-rq"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // updateDesignComparison with cross-orientation RQs -> invalid-argument
      assert.throws(
        () =>
          updateDesignComparison(fixture.handle, fixture.ownerCap, comp.id, {
            researchQuestionIds: [rq1.id, rq2.id]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // SamplingPlan with nonexistent comparisonId -> not-found
      assert.throws(
        () =>
          recordSamplingPlan(fixture.handle, fixture.ownerCap, {
            comparisonId: "nonexistent-comp",
            designId: "d1",
            population: "P",
            accessPath: "A",
            recruitmentApproach: "R"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // SamplingPlan with designId not in comparison -> invalid-argument
      assert.throws(
        () =>
          recordSamplingPlan(fixture.handle, fixture.ownerCap, {
            comparisonId: comp.id,
            designId: "nonexistent-design",
            population: "P",
            accessPath: "A",
            recruitmentApproach: "R"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Instrument with nonexistent comparisonId -> not-found
      assert.throws(
        () =>
          recordInstrument(fixture.handle, fixture.ownerCap, {
            comparisonId: "nonexistent-comp",
            designId: "d1",
            name: "I",
            purpose: "P",
            rightsBasis: "stated-license",
            fitNotes: "FN"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Instrument with designId not in comparison -> invalid-argument
      assert.throws(
        () =>
          recordInstrument(fixture.handle, fixture.ownerCap, {
            comparisonId: comp.id,
            designId: "nonexistent-design",
            name: "I",
            purpose: "P",
            rightsBasis: "stated-license",
            fitNotes: "FN"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Instrument with nonexistent constructId -> not-found
      assert.throws(
        () =>
          recordInstrument(fixture.handle, fixture.ownerCap, {
            comparisonId: comp.id,
            designId: "d1",
            name: "I",
            purpose: "P",
            rightsBasis: "stated-license",
            fitNotes: "FN",
            constructIds: ["nonexistent-construct"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // PilotPlan with nonexistent comparisonId -> not-found
      assert.throws(
        () =>
          recordPilotPlan(fixture.handle, fixture.ownerCap, {
            comparisonId: "nonexistent-comp",
            designId: "d1",
            feasibilityQuestions: ["Q1?"],
            stopConditions: ["S1"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // PilotPlan with designId not in comparison -> invalid-argument
      assert.throws(
        () =>
          recordPilotPlan(fixture.handle, fixture.ownerCap, {
            comparisonId: comp.id,
            designId: "nonexistent-design",
            feasibilityQuestions: ["Q1?"],
            stopConditions: ["S1"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s03 regression: read-only handle fails closed on study design writers", () => {
    const fixture = createMethodologyFixture();
    try {
      const roHandle = openProject(fixture.root, { readOnly: true });
      try {
        assert.throws(
          () =>
            recordDesignComparison(roHandle, fixture.ownerCap, {
              branchId: "main",
              researchQuestionIds: ["rq1"],
              designs: [
                { id: "d1", name: "D1", rationale: "R1", fit: "F1", feasibility: "H", tensions: "None", limits: "None" },
                { id: "d2", name: "D2", rationale: "R2", fit: "F2", feasibility: "M", tensions: "None", limits: "None" }
              ]
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            updateDesignComparison(roHandle, fixture.ownerCap, "cmp1", {
              designs: [
                { id: "d1", name: "D1", rationale: "R1", fit: "F1", feasibility: "H", tensions: "None", limits: "None" },
                { id: "d2", name: "D2", rationale: "R2", fit: "F2", feasibility: "M", tensions: "None", limits: "None" }
              ]
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordSamplingPlan(roHandle, fixture.ownerCap, {
              comparisonId: "cmp1",
              designId: "d1",
              population: "P",
              accessPath: "A",
              recruitmentApproach: "R"
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordInstrument(roHandle, fixture.ownerCap, {
              comparisonId: "cmp1",
              designId: "d1",
              name: "I",
              purpose: "P",
              rightsBasis: "stated-license",
              fitNotes: "FN"
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordPilotPlan(roHandle, fixture.ownerCap, {
              comparisonId: "cmp1",
              designId: "d1",
              feasibilityQuestions: ["Q"],
              stopConditions: ["S"]
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
      } finally {
        roHandle.close();
      }
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });
});
