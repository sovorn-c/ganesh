// story: e09s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  recordOrientation,
  inspectOrientation,
  recordProblemFraming,
  recordResearchQuestionAlternative,
  listResearchQuestionAlternatives,
  inspectFraming,
  PROJECT_SCHEMA_VERSION,
  createOwnerCapability,
  createWorkerCapabilities
} from "../../src/index.js";
import {
  createMethodologyFixture,
  disposeMethodologyFixture
} from "../support/methodology-fixtures.js";

describe("e09s01 orientation framing research question and reopen", () => {
  it("e09s01 schema, orientation, framing, research question, reopen, and unknowns survive without invented protocols (SC-e09s01-P0-01, SC-e09s01-P0-03)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Peer Code Review in Remote Teams",
        discipline: "empirical-software-engineering",
        immediateGoal: "Understand how asynchronous code review affects developer onboarding",
        unknowns: ["team size threshold", "seniority distribution"]
      });

      assert.ok(orientation.id.startsWith("orient_"), "orientation id prefix");
      assert.equal(orientation.topic, "Peer Code Review in Remote Teams");
      assert.equal(orientation.discipline, "empirical-software-engineering");
      assert.equal(orientation.attribution, "human-stated");
      assert.equal(orientation.origin, "owner-recorded");
      assert.deepEqual(orientation.unknowns, ["team size threshold", "seniority distribution"]);
      assert.ok(orientation.artifactVersionId, "registered artifact version");

      // Idempotency check with same commandId
      const idempotent = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Peer Code Review in Remote Teams",
        discipline: "empirical-software-engineering",
        immediateGoal: "Understand how asynchronous code review affects developer onboarding",
        unknowns: ["team size threshold", "seniority distribution"],
        commandId: orientation.commandId
      });
      assert.equal(idempotent.id, orientation.id);

      // Record problem framing
      const framing = recordProblemFraming(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        statement: "Onboarding developers struggle to receive timely actionable code review feedback.",
        boundaries: "Exclude open-source public repositories without onboarding programs."
      });
      assert.ok(framing.id.startsWith("framing_"), "framing id prefix");
      assert.equal(framing.orientationId, orientation.id);
      assert.equal(framing.attribution, "human-stated");

      // Record research question alternative
      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        framingId: framing.id,
        questionText: "How does review response latency affect time-to-first-commit for remote onboarding engineers?"
      });
      assert.ok(rq.id.startsWith("rq_"), "rq id prefix");
      assert.equal(rq.status, "candidate");
      assert.equal(rq.version, 1);
      assert.equal(rq.attribution, "human-stated");

      // Inspect framing
      const inspection = inspectFraming(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection.orientation.id, orientation.id);
      assert.equal(inspection.problemFramings.length, 1);
      assert.equal(inspection.problemFramings[0].id, framing.id);
      assert.equal(inspection.researchQuestions.length, 1);
      assert.equal(inspection.researchQuestions[0].id, rq.id);
      assert.deepEqual(inspection.unknowns, ["team size threshold", "seniority distribution"]);

      // Reopen handle and verify records survive intact
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedInspection = inspectFraming(reopened, fixture.ownerCap, orientation.id);
        assert.equal(reopenedInspection.orientation.id, orientation.id);
        assert.equal(reopenedInspection.problemFramings[0].id, framing.id);
        assert.equal(reopenedInspection.researchQuestions[0].id, rq.id);
        assert.equal(reopened.project.schemaVersion, PROJECT_SCHEMA_VERSION);
      } finally {
        reopened.close();
      }
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s01 capability authority denies forged, wrong-owner and unauthorized worker callers (SC-e09s01-P1-04)", () => {
    const fixture = createMethodologyFixture();
    try {
      const validReq = {
        topic: "Security Testing",
        discipline: "computer-science",
        immediateGoal: "Test capability boundaries"
      };

      // Forged capability
      const forged = { role: "owner", ownerId: fixture.ownerId };
      assert.throws(() => recordOrientation(fixture.handle, forged, validReq), (err: any) => err.code === "forbidden");

      // Wrong owner
      const wrongOwner = createOwnerCapability("another-owner-id");
      assert.throws(() => recordOrientation(fixture.handle, wrongOwner, validReq), (err: any) => err.code === "forbidden");

      // Worker without methodology:frame
      const inspectOnlyWorker = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["methodology:inspect"]
      });
      assert.throws(() => recordOrientation(fixture.handle, inspectOnlyWorker, validReq), (err: any) => err.code === "forbidden");

      // Cross-project worker
      const crossProjectWorker = createWorkerCapabilities({
        projectId: "different-project",
        projectRoot: fixture.root,
        allowedOperations: ["methodology:frame"]
      });
      assert.throws(() => recordOrientation(fixture.handle, crossProjectWorker, validReq), (err: any) => err.code === "forbidden");

      // Confirm no orientation was inserted
      const count = (fixture.handle.db.prepare("SELECT COUNT(*) as cnt FROM orientations").get() as { cnt: number }).cnt;
      assert.equal(count, 0, "no orientation rows inserted on denied writes");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });
});
