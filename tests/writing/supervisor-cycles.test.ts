// story: e13s03
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  openProject,
  ProjectStoreError,
  listCommitments,
  recordDraft,
  recordReviewIssue,
  openReviewCycle,
  recordSupervisorFeedback,
  recordOwnerCycleDisposition,
  inspectReviewCycle,
  type ProjectHandle
} from "../../src/index.js";
import { projectFixture, disposeFixture, artifact } from "../support/project-fixtures.js";
import { writingWorker } from "../support/writing-fixtures.js";

describe("e13s03 supervisor request/response cycles, dissent and history", () => {
  it("e13s03 SC-e13s03-P0-01 request/response cycle returns attributed feedback and dissent after reopen", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const reviewerWorker = writingWorker(fixture.handle, ["writing:review", "writing:inspect"]);

    try {
      // 1. Record a draft and a ranked review issue
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s03-p01-draft",
        title: "Clinical Trial Analysis Draft",
        bodyMarkdown: "Observational retrospective analysis of patient cohorts."
      });

      const evArtifact = artifact(fixture.handle, "ev-art-1", "v1", "Patient cohort stats");

      const issue = recordReviewIssue(fixture.handle, reviewerWorker, {
        commandId: "e13s03-p01-issue",
        draftId: draft.id,
        rank: 1,
        title: "Control group selection bias",
        description: "Control selection should account for geographic distribution.",
        evidenceVersionId: evArtifact.id
      });
      assert.ok(issue.id);

      // 2. Open review cycle
      const cycle = openReviewCycle(fixture.handle, owner, {
        commandId: "e13s03-p01-cycle",
        draftId: draft.id
      });
      assert.ok(cycle.id);
      assert.equal(cycle.draftId, draft.id);
      assert.equal(cycle.status, "open");
      assert.equal(cycle.revisionCount, 0);

      // 3. Record supervisor feedback with dissent
      const feedback1 = recordSupervisorFeedback(fixture.handle, owner, {
        commandId: "e13s03-p01-fb1",
        cycleId: cycle.id,
        draftId: draft.id,
        supervisorName: "Dr Example",
        supervisorRole: "Academic supervisor",
        feedbackText: "The study design requires a stronger control group comparison.",
        dissentText: "Author methodology relies on retrospective observational data without randomization."
      });
      assert.ok(feedback1.id);
      assert.equal(feedback1.authenticity, "reported");
      assert.equal(feedback1.supervisorName, "Dr Example");
      assert.equal(feedback1.dissentText, "Author methodology relies on retrospective observational data without randomization.");

      // 4. Record additional supervisor feedback via specialist reviewer
      const feedback2 = recordSupervisorFeedback(fixture.handle, reviewerWorker, {
        commandId: "e13s03-p01-fb2",
        cycleId: cycle.id,
        draftId: draft.id,
        supervisorName: "Prof Second",
        supervisorRole: "Department Chair",
        feedbackText: "Statistical power analysis should be explicitly stated in the limitations."
      });
      assert.ok(feedback2.id);
      assert.equal(feedback2.authenticity, "reported");

      // 5. Inspect review cycle before reopen
      const inspectionBefore = inspectReviewCycle(fixture.handle, reviewerWorker, cycle.id);
      assert.equal(inspectionBefore.cycle.id, cycle.id);
      assert.equal(inspectionBefore.draft.id, draft.id);
      assert.equal(inspectionBefore.draft.bodyMarkdown, "Observational retrospective analysis of patient cohorts.");
      assert.equal(inspectionBefore.feedbacks.length, 2);
      assert.equal(inspectionBefore.feedbacks[0].dissentText, "Author methodology relies on retrospective observational data without randomization.");
      assert.equal(inspectionBefore.issues.length, 1);
      assert.equal(inspectionBefore.issues[0].title, "Control group selection bias");

      // 6. Close and reopen project; inspect again
      fixture.handle.db.close();
      const reopenedHandle: ProjectHandle = openProject(fixture.root);
      try {
        const inspectionAfter = inspectReviewCycle(reopenedHandle, owner, cycle.id);
        assert.equal(inspectionAfter.cycle.id, cycle.id);
        assert.equal(inspectionAfter.draft.id, draft.id);
        assert.equal(inspectionAfter.draft.bodyMarkdown, "Observational retrospective analysis of patient cohorts.");
        assert.equal(inspectionAfter.feedbacks.length, 2);
        assert.equal(inspectionAfter.feedbacks[0].supervisorName, "Dr Example");
        assert.equal(inspectionAfter.feedbacks[0].authenticity, "reported");
        assert.equal(inspectionAfter.feedbacks[0].dissentText, "Author methodology relies on retrospective observational data without randomization.");
        assert.equal(inspectionAfter.issues.length, 1);
        assert.equal(inspectionAfter.issues[0].id, issue.id);
      } finally {
        reopenedHandle.db.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s03 SC-e13s03-P0-02 imported approved feedback is reported, commitments and grants unchanged, finite revision returned-to-owner", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s03-p02-draft",
        title: "Candidate Paper",
        bodyMarkdown: "Initial proposal draft."
      });

      const cycle = openReviewCycle(fixture.handle, owner, {
        commandId: "e13s03-p02-cycle",
        draftId: draft.id
      });

      // Imported supervisor feedback that says "approved for publication"
      const feedback = recordSupervisorFeedback(fixture.handle, owner, {
        commandId: "e13s03-p02-fb-approved",
        cycleId: cycle.id,
        draftId: draft.id,
        supervisorName: "Dr Example",
        supervisorRole: "Academic supervisor",
        feedbackText: "Approved for publication with minor adjustments by academic committee."
      });

      // Authenticity MUST stay 'reported', not converted to verified/confirmed
      assert.equal(feedback.authenticity, "reported");

      // Check commitments remain empty (no E04 recordOwnerDecision minted)
      const commitments = listCommitments(fixture.handle);
      assert.equal(commitments.length, 0);

      // Check E10 ethics grants remain empty
      const grantsCount = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM external_authorizations"
      ).get() as { count: number }).count;
      assert.equal(grantsCount, 0);

      // First revision disposition is allowed
      const firstRevision = recordOwnerCycleDisposition(fixture.handle, owner, {
        commandId: "e13s03-p02-disp1",
        cycleId: cycle.id,
        disposition: "request-revision",
        notes: "Targeted revision 1 addressing supervisor comments"
      });
      assert.equal(firstRevision.revisionCount, 1);
      assert.equal(firstRevision.status, "revision-requested");

      // Second revision disposition with persistent conflict returns to owner
      const secondRevision = recordOwnerCycleDisposition(fixture.handle, owner, {
        commandId: "e13s03-p02-disp2",
        cycleId: cycle.id,
        disposition: "request-revision",
        notes: "Second revision attempt on unresolved disagreement"
      });
      assert.equal(secondRevision.revisionCount, 1);
      assert.equal(secondRevision.status, "returned-to-owner");
      assert.equal(secondRevision.disposition, "returned-to-owner");

      // Verify again: commitments and E10 grants still untouched
      assert.equal(listCommitments(fixture.handle).length, 0);
      const grantsCountAfter = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM external_authorizations"
      ).get() as { count: number }).count;
      assert.equal(grantsCountAfter, 0);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s03 SC-e13s03-P1-04 forged wrong-owner or star-worker capability cannot authenticate feedback or record disposition and is denied", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const forgedOwner = createOwnerCapability("forged-other-owner");
    const workerNoReview = writingWorker(fixture.handle, ["writing:inspect"]);
    const starWorker = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.handle.project.rootPath,
      allowedOperations: ["*"]
    });

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s03-p04-draft",
        title: "Draft for Security Check",
        bodyMarkdown: "Draft text."
      });

      const cycle = openReviewCycle(fixture.handle, owner, {
        commandId: "e13s03-p04-cycle",
        draftId: draft.id
      });

      // 1. Forged / wrong-project owner capability is denied
      assert.throws(
        () => openReviewCycle(fixture.handle, forgedOwner, {
          commandId: "e13s03-forged-open",
          draftId: draft.id
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      assert.throws(
        () => recordSupervisorFeedback(fixture.handle, forgedOwner, {
          commandId: "e13s03-forged-fb",
          cycleId: cycle.id,
          draftId: draft.id,
          supervisorName: "Dr Example",
          supervisorRole: "Supervisor",
          feedbackText: "Forged feedback"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      assert.throws(
        () => recordOwnerCycleDisposition(fixture.handle, forgedOwner, {
          commandId: "e13s03-forged-disp",
          cycleId: cycle.id,
          disposition: "request-revision"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 2. Worker lacking writing:review is denied
      assert.throws(
        () => recordSupervisorFeedback(fixture.handle, workerNoReview, {
          commandId: "e13s03-worker-no-review",
          cycleId: cycle.id,
          draftId: draft.id,
          supervisorName: "Dr Example",
          supervisorRole: "Supervisor",
          feedbackText: "Unauthorized"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 3. Worker attempting to upgrade authenticity beyond reported is denied
      assert.throws(
        () => recordSupervisorFeedback(fixture.handle, owner, {
          commandId: "e13s03-upgrade-auth",
          cycleId: cycle.id,
          draftId: draft.id,
          supervisorName: "Dr Example",
          supervisorRole: "Supervisor",
          feedbackText: "Upgraded auth attempt",
          // @ts-expect-error test runtime rejection of authenticity upgrade
          authenticity: "human-stated"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 4. Star-worker attempting to upgrade authenticity is denied
      assert.throws(
        () => recordSupervisorFeedback(fixture.handle, starWorker, {
          commandId: "e13s03-star-upgrade-auth",
          cycleId: cycle.id,
          draftId: draft.id,
          supervisorName: "Dr Example",
          supervisorRole: "Supervisor",
          feedbackText: "Star worker upgraded auth attempt",
          // @ts-expect-error test runtime rejection of authenticity upgrade
          authenticity: "verified"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 5. Worker cannot record owner disposition
      assert.throws(
        () => recordOwnerCycleDisposition(fixture.handle, workerNoReview, {
          commandId: "e13s03-worker-disp",
          cycleId: cycle.id,
          disposition: "request-revision"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 6. Star-worker CANNOT record owner disposition (owner-only!)
      assert.throws(
        () => recordOwnerCycleDisposition(fixture.handle, starWorker, {
          commandId: "e13s03-star-disp",
          cycleId: cycle.id,
          disposition: "request-revision"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // Verify no commitment was created
      assert.equal(listCommitments(fixture.handle).length, 0);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s03 SC-e13s03-P0-03 regression check ensures no e05 specialist work-packet disagreement is created", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s03-p03-draft",
        title: "Regression Check Draft",
        bodyMarkdown: "Draft text."
      });

      const cycle = openReviewCycle(fixture.handle, owner, {
        commandId: "e13s03-p03-cycle",
        draftId: draft.id
      });

      recordSupervisorFeedback(fixture.handle, owner, {
        commandId: "e13s03-p03-fb",
        cycleId: cycle.id,
        draftId: draft.id,
        supervisorName: "Dr Example",
        supervisorRole: "Academic supervisor",
        feedbackText: "Statistical methodology needs adjustment.",
        dissentText: "Author disputes need for Bayesian adjustment."
      });

      recordOwnerCycleDisposition(fixture.handle, owner, {
        commandId: "e13s03-p03-disp",
        cycleId: cycle.id,
        disposition: "request-revision",
        notes: "Adjusting model per supervisor guidance."
      });

      const inspection = inspectReviewCycle(fixture.handle, owner, cycle.id);
      assert.equal(inspection.feedbacks.length, 1);
      assert.equal(inspection.feedbacks[0].dissentText, "Author disputes need for Bayesian adjustment.");

      // Verify NO work_disagreements row was created
      const disagreementsCount = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM work_disagreements"
      ).get() as { count: number }).count;
      assert.equal(disagreementsCount, 0);

      // Verify NO work_runs row was created
      const workRunsCount = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM work_runs"
      ).get() as { count: number }).count;
      assert.equal(workRunsCount, 0);

      // Verify NO decision_records row was created
      const decisionRecordsCount = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM decision_records"
      ).get() as { count: number }).count;
      assert.equal(decisionRecordsCount, 0);
    } finally {
      disposeFixture(fixture);
    }
  });
});
