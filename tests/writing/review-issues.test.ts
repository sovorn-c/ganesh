// story: e13s02
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  openProject,
  ProjectStoreError,
  listCommitments,
  recordDraft,
  inspectDraft,
  recordReviewIssue,
  listReviewIssues,
  requestDraftRevision,
  type ProjectHandle
} from "../../src/index.js";
import { projectFixture, disposeFixture, artifact } from "../support/project-fixtures.js";
import { writingWorker } from "../support/writing-fixtures.js";

describe("e13s02 ranked review issues without rewriting originals", () => {
  it("e13s02 SC-e13s02-P0-01 ranked review issues persist against draft version with version-linked evidence and survive reopen", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const reviewerWorker = writingWorker(fixture.handle, ["writing:review", "writing:inspect"]);

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s02-draft-1",
        title: "Draft for Review",
        bodyMarkdown: "Initial draft text before peer review."
      });

      // Register an evidence artifact version
      const evArtifact = artifact(fixture.handle, "evidence-item-1", "v1", "Source evidence excerpt");

      // Record ranked issue 1 by reviewer worker
      const issue1 = recordReviewIssue(fixture.handle, reviewerWorker, {
        commandId: "e13s02-issue-1",
        draftId: draft.id,
        rank: 1,
        title: "Clarify baseline methodology",
        description: "The baseline cohort definition should link to the empirical trial evidence.",
        evidenceVersionId: evArtifact.id
      });

      assert.ok(issue1.id);
      assert.equal(issue1.draftId, draft.id);
      assert.equal(issue1.rank, 1);
      assert.equal(issue1.title, "Clarify baseline methodology");
      assert.equal(issue1.evidenceVersionId, evArtifact.id);
      assert.equal(issue1.status, "open");

      // Record ranked issue 2 by owner
      const issue2 = recordReviewIssue(fixture.handle, owner, {
        commandId: "e13s02-issue-2",
        draftId: draft.id,
        rank: 2,
        title: "Add limitation on sample size",
        description: "Sample size caveats are missing from the conclusion."
      });
      assert.equal(issue2.rank, 2);

      // Idempotency check
      const dupIssue1 = recordReviewIssue(fixture.handle, reviewerWorker, {
        commandId: "e13s02-issue-1",
        draftId: draft.id,
        rank: 1,
        title: "Clarify baseline methodology",
        description: "The baseline cohort definition should link to the empirical trial evidence."
      });
      assert.equal(dupIssue1.id, issue1.id);

      // List issues
      const issuesBefore = listReviewIssues(fixture.handle, owner, { draftId: draft.id });
      assert.equal(issuesBefore.length, 2);
      assert.equal(issuesBefore[0].id, issue1.id);
      assert.equal(issuesBefore[1].id, issue2.id);

      // Reopen
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const issuesAfter = listReviewIssues(reopened, owner, { draftId: draft.id });
        assert.equal(issuesAfter.length, 2);
        assert.equal(issuesAfter[0].id, issue1.id);
        assert.equal(issuesAfter[0].evidenceVersionId, evArtifact.id);
        assert.equal(issuesAfter[1].id, issue2.id);
      } finally {
        reopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s02 SC-e13s02-P0-02 recording issues does not rewrite original draft bytes and revision creates new-version candidate", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const originalBody = "Original draft immutable content.";
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s02-draft-orig",
        title: "Original Draft",
        bodyMarkdown: originalBody
      });
      const originalHash = draft.bodyHash;
      const originalArtifactVersionId = draft.artifactVersionId;

      // Record issue
      recordReviewIssue(fixture.handle, owner, {
        commandId: "e13s02-issue-rev",
        draftId: draft.id,
        rank: 1,
        title: "Needs Revision",
        description: "Revise section 2."
      });

      // Verify original draft is completely unchanged
      const inspectedOriginal = inspectDraft(fixture.handle, owner, { draftId: draft.id });
      assert.equal(inspectedOriginal.draft.bodyMarkdown, originalBody);
      assert.equal(inspectedOriginal.draft.bodyHash, originalHash);
      assert.equal(inspectedOriginal.draft.artifactVersionId, originalArtifactVersionId);

      // Request revision
      const revisedBody = "Original draft immutable content with revised section 2 additions.";
      const revision = requestDraftRevision(fixture.handle, owner, {
        commandId: "e13s02-rev-1",
        draftId: draft.id,
        revisedBodyMarkdown: revisedBody,
        reason: "Addressed peer review issue on section 2."
      });

      assert.ok(revision.id);
      assert.notEqual(revision.id, draft.id);
      assert.equal(revision.versionNumber, 2);
      assert.equal(revision.priorDraftId, draft.id);
      assert.equal(revision.bodyMarkdown, revisedBody);
      assert.notEqual(revision.bodyHash, originalHash);
      assert.notEqual(revision.artifactVersionId, originalArtifactVersionId);
      assert.equal(revision.status, "candidate");

      // Idempotent revision
      const dupRevision = requestDraftRevision(fixture.handle, owner, {
        commandId: "e13s02-rev-1",
        draftId: draft.id,
        revisedBodyMarkdown: revisedBody,
        reason: "Addressed peer review issue on section 2."
      });
      assert.equal(dupRevision.id, revision.id);

      // Verify original draft remains intact and accessible
      const originalStillIntact = inspectDraft(fixture.handle, owner, { draftId: draft.id });
      assert.equal(originalStillIntact.draft.bodyMarkdown, originalBody);
      assert.equal(originalStillIntact.draft.bodyHash, originalHash);

      // Verify new revision is inspectable
      const revisionInspected = inspectDraft(fixture.handle, owner, { draftId: revision.id });
      assert.equal(revisionInspected.draft.bodyMarkdown, revisedBody);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s02 SC-e13s02-P1-04 capability checks deny forged wrong-owner worker and star-worker authority revision callers", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const wrongOwner = createOwnerCapability("wrong-owner");
    const workerNoReview = writingWorker(fixture.handle, ["writing:inspect"]);
    const starWorker = createWorkerCapabilities({
      projectId: fixture.handle.project.id,
      projectRoot: fixture.handle.project.rootPath,
      allowedOperations: ["*"]
    });
    const forgedCapability = { role: "owner", ownerId: "owner-test" };

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s02-cap-draft",
        title: "Draft for Auth Test",
        bodyMarkdown: "Draft text."
      });

      // 1. Forged capability cannot record review issue
      assert.throws(
        () => recordReviewIssue(fixture.handle, forgedCapability, {
          commandId: "e13s02-forged-issue",
          draftId: draft.id,
          rank: 1,
          title: "Forged Issue",
          description: "Forged"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 2. Wrong owner cannot record review issue
      assert.throws(
        () => recordReviewIssue(fixture.handle, wrongOwner, {
          commandId: "e13s02-wrong-owner-issue",
          draftId: draft.id,
          rank: 1,
          title: "Wrong Owner Issue",
          description: "Denied"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 3. Worker lacking writing:review cannot record review issue
      assert.throws(
        () => recordReviewIssue(fixture.handle, workerNoReview, {
          commandId: "e13s02-worker-no-review",
          draftId: draft.id,
          rank: 1,
          title: "Unauthorized Worker Issue",
          description: "Denied"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 4. requestDraftRevision is owner-only: worker cannot request revision
      assert.throws(
        () => requestDraftRevision(fixture.handle, workerNoReview, {
          commandId: "e13s02-worker-rev",
          draftId: draft.id,
          revisedBodyMarkdown: "Worker revision",
          reason: "Unauthorized"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 5. requestDraftRevision is owner-only: even star-worker ["*"] MUST BE DENIED
      assert.throws(
        () => requestDraftRevision(fixture.handle, starWorker, {
          commandId: "e13s02-star-rev",
          draftId: draft.id,
          revisedBodyMarkdown: "Star worker revision",
          reason: "Star worker attempt"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s02 SC-e13s02-P0-03 review APIs do not call recordOwnerDecision or queueRun leaving commitment and specialist-reviewer counts unchanged", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s02-reg-draft",
        title: "Regression Draft",
        bodyMarkdown: "Draft text."
      });

      recordReviewIssue(fixture.handle, owner, {
        commandId: "e13s02-reg-issue",
        draftId: draft.id,
        rank: 1,
        title: "Peer critique",
        description: "Clarification needed."
      });

      requestDraftRevision(fixture.handle, owner, {
        commandId: "e13s02-reg-rev",
        draftId: draft.id,
        revisedBodyMarkdown: "Revised draft text.",
        reason: "Peer critique addressed."
      });

      // Assert commitments table is empty (no E04 recordOwnerDecision)
      const commitments = listCommitments(fixture.handle);
      assert.equal(commitments.length, 0);

      // Assert E05 specialist runs / disagreements count is 0
      const workRuns = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM work_runs"
      ).get() as { count: number }).count;
      assert.equal(workRuns, 0);

      const disagreements = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM review_revisions"
      ).get() as { count: number }).count;
      assert.equal(disagreements, 0);
    } finally {
      disposeFixture(fixture);
    }
  });
});
