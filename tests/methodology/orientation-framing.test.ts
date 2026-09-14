// story: e09s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  openProject,
  recordOrientation,
  inspectOrientation,
  recordProblemFraming,
  recordResearchQuestionAlternative,
  listResearchQuestionAlternatives,
  inspectFraming,
  ingestMethodologyCandidate,
  listCommitments,
  PROJECT_SCHEMA_VERSION,
  ProjectStoreError,
  methodologySchemaAvailable,
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

  it("e09s01 research questions remain candidates and specialist ingest produces specialist-proposed candidate without E04 commitment (SC-e09s01-P0-02)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Autonomous Coding Agents",
        discipline: "software-engineering",
        immediateGoal: "Investigate supervision mechanisms"
      });

      // Owner records an RQ alternative
      const ownerRq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do deterministic verification gates prevent specification drift in LLM-assisted pipelines?"
      });
      assert.equal(ownerRq.status, "candidate");
      assert.equal(ownerRq.origin, "owner-recorded");
      assert.equal(ownerRq.attribution, "human-stated");

      // Worker ingests a candidate
      const candidate = ingestMethodologyCandidate(fixture.handle, fixture.workerCap, {
        orientationId: orientation.id,
        specialistRole: "methodology",
        candidateType: "research-question",
        payload: {
          questionText: "What feedback loops best constrain speculative abstractions in multi-agent workflows?"
        }
      });
      assert.equal(candidate.origin, "specialist-proposed");
      assert.ok(candidate.researchQuestion, "specialist candidate generates RQ record");
      assert.equal(candidate.researchQuestion?.origin, "specialist-proposed");
      assert.equal(candidate.researchQuestion?.attribution, "agent-inferred");
      assert.equal(candidate.researchQuestion?.status, "candidate");

      // Verify inspectFraming returns both
      const inspection = inspectFraming(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection.researchQuestions.length, 2);
      const specialistRq = inspection.researchQuestions.find((r) => r.id === candidate.researchQuestion?.id);
      assert.ok(specialistRq);
      assert.equal(specialistRq?.origin, "specialist-proposed");
      assert.equal(specialistRq?.attribution, "agent-inferred");

      // Verify no E04 commitment exists
      const commitments = listCommitments(fixture.handle);
      assert.equal(commitments.length, 0, "no E04 commitments minted from methodology records");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s01 regression and read-only handle on database missing methodology tables fails closed with methodology-schema-unavailable (SC-e09s01-P0-03)", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "ganesh-ro-methodology-"));
    const dbDir = join(tempDir, ".ganesh");
    mkdirSync(dbDir, { recursive: true });
    const db = new DatabaseSync(join(dbDir, "project.sqlite"));
    db.exec(`
      CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
      CREATE TABLE projects (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, root_path TEXT NOT NULL, schema_version INTEGER NOT NULL, created_at TEXT NOT NULL);
      INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES ('p-ro-m', 'owner-methodology', '${tempDir}', 1, datetime('now'));
    `);
    db.close();

    const roHandle = openProject(tempDir, { readOnly: true });
    try {
      assert.equal(methodologySchemaAvailable(roHandle), false, "methodology schema must be unavailable");

      const cap = createOwnerCapability("owner-methodology");
      assert.throws(
        () => inspectOrientation(roHandle, cap, "orient_dummy"),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "methodology-schema-unavailable"
      );
      assert.throws(
        () => listResearchQuestionAlternatives(roHandle, cap),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "methodology-schema-unavailable"
      );

      // Verify no tables were created in read-only mode
      assert.equal(methodologySchemaAvailable(roHandle), false, "database must not be mutated");
    } finally {
      roHandle.close();
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("e09s01 regression: supersedesId and framingId reject nonexistent and cross-orientation references", () => {
    const fixture = createMethodologyFixture();
    try {
      const o1 = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Topic 1",
        discipline: "social-science",
        immediateGoal: "Goal 1"
      });
      const o2 = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Topic 2",
        discipline: "information-systems",
        immediateGoal: "Goal 2"
      });
      const f1 = recordProblemFraming(fixture.handle, fixture.ownerCap, {
        orientationId: o1.id,
        statement: "Framing 1",
        boundaries: "Boundaries 1"
      });
      const rq1 = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: o1.id,
        questionText: "RQ 1?"
      });

      // Nonexistent supersedesId -> not-found
      assert.throws(
        () =>
          recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
            orientationId: o1.id,
            questionText: "RQ 2?",
            supersedesId: "nonexistent-rq"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Cross-orientation supersedesId -> invalid-argument
      assert.throws(
        () =>
          recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
            orientationId: o2.id,
            questionText: "RQ from O2?",
            supersedesId: rq1.id
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Nonexistent framingId -> not-found
      assert.throws(
        () =>
          recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
            orientationId: o1.id,
            questionText: "RQ with bad framing?",
            framingId: "nonexistent-framing"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Cross-orientation framingId -> invalid-argument
      assert.throws(
        () =>
          recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
            orientationId: o2.id,
            questionText: "RQ from O2 with framing 1?",
            framingId: f1.id
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s01 regression: read-only handle fails closed on all framing writers", () => {
    const fixture = createMethodologyFixture();
    try {
      const roHandle = openProject(fixture.root, { readOnly: true });
      try {
        assert.throws(
          () =>
            recordOrientation(roHandle, fixture.ownerCap, {
              topic: "T",
              discipline: "D",
              immediateGoal: "G"
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordProblemFraming(roHandle, fixture.ownerCap, {
              orientationId: "any",
              statement: "S",
              boundaries: "B"
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordResearchQuestionAlternative(roHandle, fixture.ownerCap, {
              orientationId: "any",
              questionText: "Q"
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            ingestMethodologyCandidate(roHandle, fixture.ownerCap, {
              orientationId: "any",
              candidateType: "test",
              payload: {}
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
