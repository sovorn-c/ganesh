// story: e09s02
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  recordOrientation,
  recordResearchQuestionAlternative,
  recordConstruct,
  recordTheoreticalFramework,
  recordPositionality,
  inspectConceptualGrounding,
  createOwnerCapability,
  createWorkerCapabilities,
  ProjectStoreError
} from "../../src/index.js";
import {
  createMethodologyFixture,
  disposeMethodologyFixture
} from "../support/methodology-fixtures.js";

describe("e09s02 conceptual grounding and positionality", () => {
  it("e09s02 constructs and frameworks link to exact rq versions and survive reopen (SC-e09s02-P0-01)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Program Comprehension in Novice Programmers",
        discipline: "computing-education",
        immediateGoal: "Investigate mental models"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "How do tracing tasks affect novice comprehension of recursion?"
      });

      // Record construct
      const construct = recordConstruct(fixture.handle, fixture.ownerCap, {
        name: "Notional Machine",
        definition: "An idealized model of computer execution that explains semantics.",
        rqVersionIds: [rq.id]
      });
      assert.ok(construct.id.startsWith("construct_"));
      assert.equal(construct.name, "Notional Machine");
      assert.deepEqual(construct.rqVersionIds, [rq.id]);
      assert.equal(construct.attribution, "human-stated");

      // Record theoretical framework
      const framework = recordTheoreticalFramework(fixture.handle, fixture.ownerCap, {
        name: "Cognitive Load Theory",
        description: "Framework predicting learning outcomes from working memory limits.",
        constructRelations: ["reduces extraneous cognitive load"],
        rqVersionIds: [rq.id]
      });
      assert.ok(framework.id.startsWith("framework_"));
      assert.equal(framework.name, "Cognitive Load Theory");
      assert.deepEqual(framework.rqVersionIds, [rq.id]);

      // Inspect
      const inspection = inspectConceptualGrounding(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection.constructs.length, 1);
      assert.equal(inspection.constructs[0].id, construct.id);
      assert.equal(inspection.frameworks.length, 1);
      assert.equal(inspection.frameworks[0].id, framework.id);

      // Close and reopen handle
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedInspect = inspectConceptualGrounding(reopened, fixture.ownerCap, orientation.id);
        assert.equal(reopenedInspect.constructs.length, 1);
        assert.equal(reopenedInspect.constructs[0].id, construct.id);
        assert.equal(reopenedInspect.frameworks.length, 1);
        assert.equal(reopenedInspect.frameworks[0].id, framework.id);
      } finally {
        reopened.close();
      }
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s02 positionality enforces human-stated as owner-only, keeps agent-inferred labeled, and rejects worker invent (SC-e09s02-P0-02)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Critical Data Studies",
        discipline: "information-systems",
        immediateGoal: "Explore data governance"
      });

      // Worker attempting to write human-stated is rejected
      assert.throws(
        () =>
          recordPositionality(fixture.handle, fixture.workerCap, {
            orientationId: orientation.id,
            philosophicalStance: "Critical Realism",
            attribution: "human-stated"
          }),
        (err: any) => err.code === "forbidden"
      );

      // Worker can write agent-inferred stance
      const workerPos = recordPositionality(fixture.handle, fixture.workerCap, {
        orientationId: orientation.id,
        philosophicalStance: "Inferred Pragmatism",
        attribution: "agent-inferred"
      });
      assert.equal(workerPos.attribution, "agent-inferred");
      assert.equal(workerPos.origin, "specialist-proposed");

      // Owner records human-stated stance
      const ownerPos = recordPositionality(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        philosophicalStance: "Critical Constructivism",
        situatedStance: "Senior practitioner in public sector IT",
        attribution: "human-stated"
      });
      assert.equal(ownerPos.attribution, "human-stated");
      assert.equal(ownerPos.origin, "owner-recorded");

      // Inspect returns the latest positionality with exact attribution
      const inspection = inspectConceptualGrounding(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection.attribution, "human-stated");
      assert.equal(inspection.philosophicalStance, "Critical Constructivism");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s02 missing philosophy records unknown without filling a default school attribution (SC-e09s02-P0-03)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Software Architecture Evaluation",
        discipline: "software-engineering",
        immediateGoal: "Assess modularity"
      });

      // Inspect without any positionality recorded
      const inspection = inspectConceptualGrounding(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection.philosophicalStance, "", "philosophical stance is empty");
      assert.equal(inspection.attribution, "unknown", "attribution must remain unknown");
      assert.equal(inspection.positionality, undefined);

      // Owner explicitly records empty stance with unknown attribution
      const recorded = recordPositionality(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        philosophicalStance: "",
        attribution: "unknown"
      });
      assert.equal(recorded.attribution, "unknown");

      const inspection2 = inspectConceptualGrounding(fixture.handle, fixture.ownerCap, orientation.id);
      assert.equal(inspection2.attribution, "unknown");
      assert.equal(inspection2.philosophicalStance, "");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s02 capability denies forged and wrong-project callers on grounding regression (SC-e09s02-P1-04)", () => {
    const fixture = createMethodologyFixture();
    try {
      const orientation = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Distributed Systems",
        discipline: "computer-science",
        immediateGoal: "Consensus protocols"
      });

      const rq = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: orientation.id,
        questionText: "What are Byzantine fault boundaries?"
      });

      const constructReq = {
        name: "Quorum",
        definition: "Minimum number of votes.",
        rqVersionIds: [rq.id]
      };

      // Forged capability
      assert.throws(
        () => recordConstruct(fixture.handle, { role: "owner" }, constructReq),
        (err: any) => err.code === "forbidden"
      );

      // Wrong project worker
      const wrongProjectWorker = createWorkerCapabilities({
        projectId: "different-proj-id",
        projectRoot: fixture.root,
        allowedOperations: ["methodology:frame"]
      });
      assert.throws(
        () => recordConstruct(fixture.handle, wrongProjectWorker, constructReq),
        (err: any) => err.code === "forbidden"
      );

      // Wrong owner
      const wrongOwner = createOwnerCapability("different-owner");
      assert.throws(
        () => recordConstruct(fixture.handle, wrongOwner, constructReq),
        (err: any) => err.code === "forbidden"
      );
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s02 regression: constructs and frameworks validate RQ referential integrity and isolation", () => {
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
      const rq1 = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: o1.id,
        questionText: "RQ 1?"
      });
      const rq2 = recordResearchQuestionAlternative(fixture.handle, fixture.ownerCap, {
        orientationId: o2.id,
        questionText: "RQ 2?"
      });

      // Nonexistent RQ in construct -> not-found
      assert.throws(
        () =>
          recordConstruct(fixture.handle, fixture.ownerCap, {
            name: "C1",
            definition: "D1",
            rqVersionIds: ["nonexistent-rq"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Cross-orientation RQs in construct -> invalid-argument
      assert.throws(
        () =>
          recordConstruct(fixture.handle, fixture.ownerCap, {
            name: "C2",
            definition: "D2",
            rqVersionIds: [rq1.id, rq2.id]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Nonexistent RQ in theoretical framework -> not-found
      assert.throws(
        () =>
          recordTheoreticalFramework(fixture.handle, fixture.ownerCap, {
            name: "TF1",
            description: "Desc1",
            rqVersionIds: ["nonexistent-rq"]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Cross-orientation RQs in theoretical framework -> invalid-argument
      assert.throws(
        () =>
          recordTheoreticalFramework(fixture.handle, fixture.ownerCap, {
            name: "TF2",
            description: "Desc2",
            rqVersionIds: [rq1.id, rq2.id]
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Nonexistent orientation in positionality -> not-found
      assert.throws(
        () =>
          recordPositionality(fixture.handle, fixture.ownerCap, {
            orientationId: "nonexistent-orientation",
            philosophicalStance: "Stance"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "not-found"
      );

      // Grounding isolation: record construct and framework for o1
      recordConstruct(fixture.handle, fixture.ownerCap, {
        name: "Construct O1",
        definition: "Def O1",
        rqVersionIds: [rq1.id]
      });
      recordTheoreticalFramework(fixture.handle, fixture.ownerCap, {
        name: "Framework O1",
        description: "Desc O1",
        rqVersionIds: [rq1.id]
      });

      // Create an orientation o3 with NO research questions
      const o3 = recordOrientation(fixture.handle, fixture.ownerCap, {
        topic: "Topic 3",
        discipline: "education",
        immediateGoal: "Goal 3"
      });

      // o3 has no RQs, so inspectConceptualGrounding must NOT leak o1's constructs/frameworks
      const o3Inspection = inspectConceptualGrounding(fixture.handle, fixture.ownerCap, o3.id);
      assert.equal(o3Inspection.constructs.length, 0, "orientation without RQs must not leak constructs");
      assert.equal(o3Inspection.frameworks.length, 0, "orientation without RQs must not leak frameworks");
    } finally {
      disposeMethodologyFixture(fixture);
    }
  });

  it("e09s02 regression: read-only handle fails closed on grounding writers", () => {
    const fixture = createMethodologyFixture();
    try {
      const roHandle = openProject(fixture.root, { readOnly: true });
      try {
        assert.throws(
          () =>
            recordConstruct(roHandle, fixture.ownerCap, {
              name: "C",
              definition: "D",
              rqVersionIds: ["rq1"]
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordTheoreticalFramework(roHandle, fixture.ownerCap, {
              name: "F",
              description: "D",
              rqVersionIds: ["rq1"]
            }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "read-only"
        );
        assert.throws(
          () =>
            recordPositionality(roHandle, fixture.ownerCap, {
              orientationId: "o1",
              philosophicalStance: "S"
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
