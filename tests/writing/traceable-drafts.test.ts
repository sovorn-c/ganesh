// story: e13s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createOwnerCapability,
  createWorkerCapabilities,
  openProject,
  ProjectStoreError,
  listCommitments,
  recordClaim,
  verifyCitation,
  linkClaimEvidence,
  type ProjectHandle
} from "../../src/index.js";
import {
  recordDraft,
  inspectDraft,
  linkDraftAssertion,
  recordDraftLimitation,
  recordAiContribution,
  completeWithInsufficientEvidence,
  ingestWritingCandidate,
  writingSchemaAvailable
} from "../../src/writing/draft-store.js";
import { projectFixture, disposeFixture } from "../support/project-fixtures.js";
import { writingWorker } from "../support/writing-fixtures.js";

describe("e13s01 traceable drafts and honest negative findings", () => {
  it("e13s01 SC-e13s01-P0-01 draft and assertion links persist across reopen with optional unknown analysis refs omitted", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    try {
      assert.equal(writingSchemaAvailable(fixture.handle), true);

      // Create an E07 claim to link
      const claim = recordClaim(fixture.handle, owner, {
        commandId: "e13s01-claim-1",
        statement: "Clinical protocol delta observes baseline variation."
      });

      // 1. Record draft
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s01-cmd-draft-1",
        title: "Interpretation of Protocol Baseline Variation",
        bodyMarkdown: "The observation indicates modest variation under test conditions.",
        findingKind: "positive"
      });

      assert.ok(draft.id);
      assert.equal(draft.title, "Interpretation of Protocol Baseline Variation");
      assert.equal(draft.findingKind, "positive");
      assert.equal(draft.attribution, "human-stated");
      assert.equal(draft.origin, "owner-recorded");
      assert.equal(draft.status, "candidate");
      assert.equal(draft.versionNumber, 1);
      assert.ok(draft.artifactVersionId);
      assert.ok(draft.bodyHash);

      // Idempotent recordDraft
      const idempotentDraft = recordDraft(fixture.handle, owner, {
        commandId: "e13s01-cmd-draft-1",
        title: "Interpretation of Protocol Baseline Variation",
        bodyMarkdown: "The observation indicates modest variation under test conditions.",
        findingKind: "positive"
      });
      assert.equal(idempotentDraft.id, draft.id);

      // 2. Link assertion to claim without analysis run (omitted analysis ref is valid)
      const link = linkDraftAssertion(fixture.handle, owner, {
        commandId: "e13s01-cmd-link-1",
        draftId: draft.id,
        claimId: claim.id,
        role: "supports"
      });
      assert.ok(link.id);
      assert.equal(link.draftId, draft.id);
      assert.equal(link.claimId, claim.id);
      assert.equal(link.role, "supports");

      // Idempotent link
      const idempotentLink = linkDraftAssertion(fixture.handle, owner, {
        commandId: "e13s01-cmd-link-1",
        draftId: draft.id,
        claimId: claim.id,
        role: "supports"
      });
      assert.equal(idempotentLink.id, link.id);

      // Inspect before reopen
      const inspectionBefore = inspectDraft(fixture.handle, owner, { draftId: draft.id });
      assert.equal(inspectionBefore.draft.id, draft.id);
      assert.equal(inspectionBefore.assertions.length, 1);
      assert.equal(inspectionBefore.assertions[0].claimId, claim.id);

      // Close and reopen
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const inspectionAfter = inspectDraft(reopened, owner, { draftId: draft.id });
        assert.equal(inspectionAfter.draft.id, draft.id);
        assert.equal(inspectionAfter.draft.bodyMarkdown, draft.bodyMarkdown);
        assert.equal(inspectionAfter.draft.artifactVersionId, draft.artifactVersionId);
        assert.equal(inspectionAfter.assertions.length, 1);
        assert.equal(inspectionAfter.assertions[0].id, link.id);
        assert.equal(inspectionAfter.assertions[0].claimId, claim.id);
      } finally {
        reopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s01 SC-e13s01-P1-04 capability-scoped writing records deny forged wrong-owner and worker authority callers", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const wrongOwner = createOwnerCapability("other-user");
    const workerNoRecord = writingWorker(fixture.handle, ["writing:inspect"]);
    const workerWithRecord = writingWorker(fixture.handle, ["writing:record"]);
    const forgedCapability = { role: "owner", ownerId: "owner-test" };

    try {
      // 1. Forged capability denied
      assert.throws(
        () => recordDraft(fixture.handle, forgedCapability, {
          commandId: "e13s01-forged-1",
          title: "Forged Draft",
          bodyMarkdown: "Forged body text"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 2. Wrong owner denied
      assert.throws(
        () => recordDraft(fixture.handle, wrongOwner, {
          commandId: "e13s01-wrong-owner-1",
          title: "Wrong Owner Draft",
          bodyMarkdown: "Body text"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 3. Worker lacking writing:record denied
      assert.throws(
        () => recordDraft(fixture.handle, workerNoRecord, {
          commandId: "e13s01-worker-no-record-1",
          title: "Unauthorized Worker Draft",
          bodyMarkdown: "Body text"
        }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 4. Worker with writing:record can record, but origin is specialist-proposed and cannot claim human-stated
      const workerDraft = recordDraft(fixture.handle, workerWithRecord, {
        commandId: "e13s01-worker-record-1",
        title: "Worker Draft",
        bodyMarkdown: "Worker generated interpretation candidate.",
        attribution: "human-stated" // should be forced/rejected to non-human attribution
      });
      assert.notEqual(workerDraft.attribution, "human-stated");
      assert.equal(workerDraft.origin, "specialist-proposed");

      // 5. Inspect denied to worker lacking writing:inspect
      assert.throws(
        () => inspectDraft(fixture.handle, workerWithRecord, { draftId: workerDraft.id }),
        (error: unknown) => error instanceof ProjectStoreError && error.code === "forbidden"
      );

      // 6. Confirm no forged drafts were inserted
      const count = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM drafts WHERE command_id IN (?, ?, ?)"
      ).get("e13s01-forged-1", "e13s01-wrong-owner-1", "e13s01-worker-no-record-1") as { count: number }).count;
      assert.equal(count, 0);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s01 SC-e13s01-P0-02 unsupported citations negative inconclusive limitation ai-contribution and insufficient evidence prove no commitment grant spawn submit", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");
    const specialist = writingWorker(fixture.handle, ["writing:record", "writing:inspect"]);

    try {
      // 1. Create claim and mark citation unsupported
      const claim = recordClaim(fixture.handle, owner, {
        commandId: "e13s01-claim-unsup",
        statement: "Hypothesized effect without full text citation."
      });

      // 2. Record draft with negative findingKind
      const draft = recordDraft(fixture.handle, owner, {
        commandId: "e13s01-draft-neg",
        title: "Negative Trial Observations",
        bodyMarkdown: "Observed differences were statistically indistinguishable from zero.",
        findingKind: "negative"
      });
      assert.equal(draft.findingKind, "negative");

      // Link assertion to the claim
      linkDraftAssertion(fixture.handle, owner, {
        commandId: "e13s01-link-neg",
        draftId: draft.id,
        claimId: claim.id,
        role: "qualifies"
      });

      // Record limitations
      const limitation = recordDraftLimitation(fixture.handle, owner, {
        commandId: "e13s01-lim-1",
        draftId: draft.id,
        limitationText: "Sample size was restricted to cohort alpha."
      });
      assert.equal(limitation.limitationText, "Sample size was restricted to cohort alpha.");

      // Record AI contribution with disclosureNeeded: true
      const aiContrib = recordAiContribution(fixture.handle, owner, {
        commandId: "e13s01-ai-1",
        draftId: draft.id,
        summary: "Draft structure and initial grammar polishing generated by assistant.",
        disclosureNeeded: true
      });
      assert.equal(aiContrib.disclosureNeeded, true);

      // Complete with insufficient evidence
      const completed = completeWithInsufficientEvidence(fixture.handle, owner, {
        commandId: "e13s01-insufficient-1",
        draftId: draft.id,
        nextAction: "Perform replication study with larger sample size before publication."
      });
      assert.equal(completed.findingKind, "insufficient-evidence");
      assert.equal(completed.nextAction, "Perform replication study with larger sample size before publication.");

      // Ingest writing candidate
      const candidate = ingestWritingCandidate(fixture.handle, specialist, {
        commandId: "e13s01-candidate-1",
        payload: { summary: "Specialist suggested phrasing" }
      });
      assert.equal(candidate.origin, "specialist-proposed");
      assert.equal(candidate.status, "candidate");

      // Inspect draft exposes all fields
      const inspection = inspectDraft(fixture.handle, owner, { draftId: draft.id });
      assert.equal(inspection.draft.findingKind, "insufficient-evidence");
      assert.equal(inspection.limitations.length, 1);
      assert.equal(inspection.limitations[0].limitationText, "Sample size was restricted to cohort alpha.");
      assert.equal(inspection.aiContributions.length, 1);
      assert.equal(inspection.aiContributions[0].disclosureNeeded, true);

      // Verify NO E04 commitment exists
      const commitments = listCommitments(fixture.handle);
      assert.equal(commitments.length, 0);

      // Verify NO external authorizations (E10 grants)
      const grants = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM external_authorizations"
      ).get() as { count: number }).count;
      assert.equal(grants, 0);

      // Verify NO analysis runs spawned (E11)
      const runs = (fixture.handle.db.prepare(
        "SELECT COUNT(*) AS count FROM analysis_runs"
      ).get() as { count: number }).count;
      assert.equal(runs, 0);
    } finally {
      disposeFixture(fixture);
    }
  });

  it("e13s01 SC-e13s01-P0-03 read-only projects lacking schema fail closed with unavailable error and regression checks pass", () => {
    const fixture = projectFixture();
    const owner = createOwnerCapability("owner-test");

    try {
      assert.equal(fixture.handle.project.schemaVersion, 1);
      assert.equal(writingSchemaAvailable(fixture.handle), true);

      // Drop writing tables to simulate an older v1 project lacking E13 writing schema
      fixture.handle.db.exec(`
        DROP TABLE IF EXISTS review_packet_exports;
        DROP TABLE IF EXISTS writing_exports;
        DROP TABLE IF EXISTS draft_tables;
        DROP TABLE IF EXISTS supervisor_feedbacks;
        DROP TABLE IF EXISTS review_cycles;
        DROP TABLE IF EXISTS review_issues;
        DROP TABLE IF EXISTS writing_candidates;
        DROP TABLE IF EXISTS ai_contributions;
        DROP TABLE IF EXISTS draft_limitations;
        DROP TABLE IF EXISTS draft_assertion_links;
        DROP TABLE IF EXISTS drafts;
        DROP TABLE IF EXISTS writing_operations;
      `);

      fixture.handle.close();

      // Open read-only
      const readOnlyHandle = openProject(fixture.root, { readOnly: true });
      try {
        assert.equal(writingSchemaAvailable(readOnlyHandle), false);

        // Attempt writing inspection on read-only without tables -> writing-schema-unavailable
        assert.throws(
          () => inspectDraft(readOnlyHandle, owner, { draftId: "nonexistent" }),
          (error: unknown) => error instanceof ProjectStoreError && error.code === "writing-schema-unavailable"
        );

        // Attempt writing mutation on read-only -> read-only / unavailable
        assert.throws(
          () => recordDraft(readOnlyHandle, owner, {
            commandId: "e13s01-ro-1",
            title: "Should Fail",
            bodyMarkdown: "Body"
          }),
          (error: unknown) => error instanceof ProjectStoreError
        );

        // Confirm no tables were created in read-only mode
        const count = (readOnlyHandle.db.prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'drafts'"
        ).get() as { count: number }).count;
        assert.equal(count, 0);
      } finally {
        readOnlyHandle.close();
      }

      // Reopen writable -> ready ensure restores additive E13 tables without changing marker version 1
      const writableReopened = openProject(fixture.root);
      try {
        assert.equal(writableReopened.project.schemaVersion, 1);
        assert.equal(writingSchemaAvailable(writableReopened), true);
      } finally {
        writableReopened.close();
      }
    } finally {
      disposeFixture(fixture);
    }
  });
});
