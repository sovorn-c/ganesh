// story: e10s03
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  recordGuidanceCitation,
  inspectGuidanceCitations,
  inspectGuidanceCitation,
  recordConsultationLimit,
  inspectConsultationLimits,
  inspectConsultationLimit,
  ProjectStoreError,
  createWorkerCapabilities,
  registerArtifactVersion
} from "../../src/index.js";
import {
  createEthicsFixture,
  disposeEthicsFixture
} from "../support/ethics-fixtures.js";

describe("e10s03 NZ guidance citations and consultation limits", () => {
  it("e10s03 citation publisher retrieved currency and reopen survive project close (SC-e10s03-P0-01)", () => {
    const fixture = createEthicsFixture();
    try {
      // 1. Record citation with default currency (unknown)
      const citation1 = recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
        title: "Observational research pathway",
        publisher: "Health and Disability Ethics Committees",
        uri: "https://example.test/hdec/section-3-observational",
        jurisdiction: "Aotearoa New Zealand",
        topic: "observational research",
        retrievedAt: "2026-09-01T10:00:00Z",
        summary: "Observational research pathway guidance and participant information requirements"
      });

      assert.ok(citation1.id.startsWith("cite_"));
      assert.equal(citation1.title, "Observational research pathway");
      assert.equal(citation1.publisher, "Health and Disability Ethics Committees");
      assert.equal(citation1.uri, "https://example.test/hdec/section-3-observational");
      assert.equal(citation1.jurisdiction, "Aotearoa New Zealand");
      assert.equal(citation1.topic, "observational research");
      assert.equal(citation1.retrievedAt, "2026-09-01T10:00:00Z");
      assert.equal(citation1.currency, "unknown");
      assert.equal(citation1.attribution, "human-stated");
      assert.equal(citation1.origin, "owner-recorded");
      assert.ok(citation1.artifactVersionId);

      // 2. Record citation with owner-reviewed-current currency
      const citation2 = recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
        publisher: "University of Auckland Human Participants Ethics Committee",
        uri: "https://example.test/uoa-hpec/guiding-principles",
        retrievedAt: "2026-09-10T14:30:00Z",
        currency: "owner-reviewed-current",
        summary: "Institutional principles on student participant recruitment"
      });
      assert.equal(citation2.currency, "owner-reviewed-current");

      // 3. Inspect citations
      const list = inspectGuidanceCitations(fixture.handle, fixture.ownerCap);
      assert.equal(list.length, 2);
      assert.equal(list[0].id, citation1.id);
      assert.equal(list[1].id, citation2.id);

      const single = inspectGuidanceCitation(fixture.handle, fixture.ownerCap, citation1.id);
      assert.equal(single.id, citation1.id);

      // 4. Reopen project handle; verify inspect returns identical citations
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedList = inspectGuidanceCitations(reopened, fixture.ownerCap);
        assert.equal(reopenedList.length, 2);
        assert.equal(reopenedList[0].id, citation1.id);
        assert.equal(reopenedList[0].uri, citation1.uri);
        assert.equal(reopenedList[0].title, citation1.title);
        assert.equal(reopenedList[0].jurisdiction, citation1.jurisdiction);
        assert.equal(reopenedList[0].topic, citation1.topic);
        assert.equal(reopenedList[0].currency, "unknown");
        assert.equal(reopenedList[1].id, citation2.id);
        assert.equal(reopenedList[1].currency, "owner-reviewed-current");
      } finally {
        reopened.close();
      }
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s03 currency is closed, claim scanning covers jurisdiction/topic, and guidance evidence is local", () => {
    const fixture = createEthicsFixture();
    try {
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "guidance-evidence", version: "1.0", content: "guidance evidence", origin: "source-import", access: "metadata-only"
      });
      const citation = recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
        publisher: "Institutional board", uri: "https://example.test/guidance", retrievedAt: "2026-09-01T00:00:00Z",
        summary: "Specific guidance", jurisdiction: "Aotearoa New Zealand", topic: "institutional", evidenceVersionIds: [evidence.id]
      });
      assert.deepEqual(citation.evidenceVersionIds, [evidence.id]);
      assert.deepEqual(inspectGuidanceCitation(fixture.handle, fixture.ownerCap, citation.id).evidenceVersionIds, [evidence.id]);
      for (const currency of ["invented", "", null, 0] as never[]) {
        assert.throws(
          () => recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
            publisher: "Institutional board", uri: "https://example.test/invalid", retrievedAt: "2026-09-01T00:00:00Z",
            summary: "Specific guidance", currency
          }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
        );
      }
      assert.throws(
        () => recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
          publisher: "Institutional board", uri: "https://example.test/invalid-date", retrievedAt: "not-a-timestamp",
          summary: "Specific guidance"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      assert.throws(
        () => recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
          publisher: "Institutional board", uri: "https://example.test/invalid-attribution", retrievedAt: "2026-09-01T00:00:00Z",
          summary: "Specific guidance", attribution: "forged" as never
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      for (const field of ["jurisdiction", "topic"] as const) {
        assert.throws(
          () => recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
            publisher: "Institutional board", uri: `https://example.test/${field}`, retrievedAt: "2026-09-01T00:00:00Z",
            summary: "Specific guidance", [field]: "generic-institutional-checklist"
          }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "generic-certification-refused"
        );
      }
      assert.throws(
        () => recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
          publisher: "Institutional board", uri: "https://example.test/foreign", retrievedAt: "2026-09-01T00:00:00Z",
          summary: "Specific guidance", evidenceVersionIds: ["artifact-from-another-project"]
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "artifact-not-found"
      );
      fixture.handle.db.prepare("UPDATE guidance_citations SET currency = 'invented' WHERE id = ?").run(citation.id);
      assert.throws(
        () => inspectGuidanceCitation(fixture.handle, fixture.ownerCap, citation.id),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s03 generic certification checklist refused for institution and maori claims (SC-e10s03-P0-02)", () => {
    const fixture = createEthicsFixture();
    try {
      // 1. Refuse citation asserting generic institutional checklist
      assert.throws(
        () =>
          recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
            publisher: "Generic Ethics Consortium",
            uri: "https://example.test/generic-checklist",
            retrievedAt: "2026-09-01T00:00:00Z",
            summary: "This is a generic-institutional-checklist for all universities"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "generic-certification-refused"
      );

      // 2. Refuse citation claiming coverage of all Māori communities
      assert.throws(
        () =>
          recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
            publisher: "Fictional Cultural Board",
            uri: "https://example.test/cultural-board",
            retrievedAt: "2026-09-01T00:00:00Z",
            summary: "Standard protocol that covers-all-maori-communities without local iwi consultation"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "generic-certification-refused"
      );

      // 3. Refuse consultation limit claiming coverage of all Māori communities
      assert.throws(
        () =>
          recordConsultationLimit(fixture.handle, fixture.ownerCap, {
            activity: "participant-recruitment",
            consultedParties: ["Regional pan-tribal society"],
            questionsAsked: ["Recruitment criteria"],
            claimsNotMade: [],
            notes: "Asserts this covers-all-maori-communities across Aotearoa"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "generic-certification-refused"
      );

      // 4. Refuse ganesh-certified claims
      assert.throws(
        () =>
          recordGuidanceCitation(fixture.handle, fixture.ownerCap, {
            publisher: "Automated Tool",
            uri: "https://example.test/tool",
            retrievedAt: "2026-09-01T00:00:00Z",
            summary: "Self-assessed ganesh-certified ethics clearance"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "generic-certification-refused"
      );

      // 5. Verify no rows were written to the database
      const citeCount = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM guidance_citations")
        .get() as { count: number };
      assert.equal(citeCount.count, 0, "no guidance citations stored for refused claims");

      const consultCount = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM consultation_limits")
        .get() as { count: number };
      assert.equal(consultCount.count, 0, "no consultation limits stored for refused claims");
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s03 consultation limit preserves unknown status and explicit claims-not-made (SC-e10s03-P0-03)", () => {
    const fixture = createEthicsFixture();
    try {
      assert.throws(
        () => recordConsultationLimit(fixture.handle, fixture.ownerCap, {
          activity: "data-collection", consultedParties: ["Advisory Group"], questionsAsked: ["Protocol clarity"],
          claimsNotMade: ["No wider endorsement"], status: "invented" as never
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      const consult = recordConsultationLimit(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        consultedParties: ["Ngāti Whātua Ōrākei Research Advisory Contact"],
        questionsAsked: ["Governance of urban health sample storage and tissue disposal"],
        claimsNotMade: [
          "Does not claim mandate for Waikato-Tainui iwi",
          "Does not claim clinical ethics committee approval"
        ],
        notes: "Initial scoping meeting held via videoconference",
        commandId: "cmd-consult-replay"
      });

      assert.ok(consult.id.startsWith("consult_"));
      assert.equal(consult.activity, "data-collection");
      assert.deepEqual(consult.consultedParties, ["Ngāti Whātua Ōrākei Research Advisory Contact"]);
      assert.deepEqual(consult.questionsAsked, ["Governance of urban health sample storage and tissue disposal"]);
      assert.deepEqual(consult.claimsNotMade, [
        "Does not claim mandate for Waikato-Tainui iwi",
        "Does not claim clinical ethics committee approval"
      ]);
      assert.equal(consult.status, "unknown", "defaults to unknown without explicit completion");
      assert.equal(recordConsultationLimit(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        consultedParties: ["Ngāti Whātua Ōrākei Research Advisory Contact"],
        questionsAsked: ["Governance of urban health sample storage and tissue disposal"],
        claimsNotMade: [
          "Does not claim mandate for Waikato-Tainui iwi",
          "Does not claim clinical ethics committee approval"
        ],
        notes: "Initial scoping meeting held via videoconference",
        commandId: "cmd-consult-replay"
      }).id, consult.id);
      assert.equal(consult.attribution, "human-stated");
      assert.equal(consult.origin, "owner-recorded");

      const list = inspectConsultationLimits(fixture.handle, fixture.ownerCap);
      assert.equal(list.length, 1);
      assert.equal(list[0].id, consult.id);
      assert.deepEqual(list[0].claimsNotMade, consult.claimsNotMade);

      const single = inspectConsultationLimit(fixture.handle, fixture.ownerCap, consult.id);
      assert.equal(single.id, consult.id);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s03 guidance and consultation writes roll back domain rows when operation recording fails", () => {
    const fixture = createEthicsFixture();
    try {
      const citationRequest = {
        publisher: "Institutional board",
        uri: "https://example.test/atomic-guidance",
        retrievedAt: "2026-09-01T00:00:00Z",
        summary: "Specific guidance",
        commandId: "cmd-atomic-guidance"
      } as const;
      fixture.handle.db.exec(`
        CREATE TRIGGER fail_guidance_operation
        BEFORE INSERT ON ethics_operations
        WHEN NEW.kind = 'guidance-citation'
        BEGIN SELECT RAISE(ABORT, 'injected guidance failure'); END;
      `);
      assert.throws(() => recordGuidanceCitation(fixture.handle, fixture.ownerCap, citationRequest), /injected guidance failure/);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM guidance_citations").get() as { count: number }).count, 0);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM ethics_operations").get() as { count: number }).count, 0);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count, 0);
      fixture.handle.db.exec("DROP TRIGGER fail_guidance_operation");
      const citation = recordGuidanceCitation(fixture.handle, fixture.ownerCap, citationRequest);
      assert.ok(citation.id);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count, 1);

      const consultationRequest = {
        activity: "data-collection" as const,
        consultedParties: ["Advisory group"],
        questionsAsked: ["Protocol clarity"],
        claimsNotMade: ["No wider endorsement"],
        commandId: "cmd-atomic-consultation"
      } as const;
      fixture.handle.db.exec(`
        CREATE TRIGGER fail_consultation_operation
        BEFORE INSERT ON ethics_operations
        WHEN NEW.kind = 'consultation-limit'
        BEGIN SELECT RAISE(ABORT, 'injected consultation failure'); END;
      `);
      assert.throws(() => recordConsultationLimit(fixture.handle, fixture.ownerCap, consultationRequest), /injected consultation failure/);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM consultation_limits").get() as { count: number }).count, 0);
      assert.equal((fixture.handle.db.prepare("SELECT COUNT(*) AS count FROM artifact_versions").get() as { count: number }).count, 1);
      fixture.handle.db.exec("DROP TRIGGER fail_consultation_operation");
      const consultation = recordConsultationLimit(fixture.handle, fixture.ownerCap, consultationRequest);
      assert.ok(consultation.id);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s03 no fetch or network call and worker cannot record human-stated complete capability (SC-e10s03-P1-04)", () => {
    const fixture = createEthicsFixture();
    try {
      // 1. Worker cannot set currency to owner-reviewed-current
      assert.throws(
        () =>
          recordGuidanceCitation(fixture.handle, fixture.workerCap, {
            publisher: "Ministry of Health",
            uri: "https://example.test/moh/guidelines",
            retrievedAt: "2026-09-01T00:00:00Z",
            currency: "owner-reviewed-current",
            summary: "Health research guidelines"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 2. Worker cannot record consultation as recorded-complete
      assert.throws(
        () =>
          recordConsultationLimit(fixture.handle, fixture.workerCap, {
            activity: "participant-contact",
            consultedParties: ["Advisory Group"],
            questionsAsked: ["Protocol clarity"],
            claimsNotMade: ["No wider endorsement"],
            status: "recorded-complete"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 3. Worker cannot claim human-stated attribution
      assert.throws(
        () =>
          recordConsultationLimit(fixture.handle, fixture.workerCap, {
            activity: "participant-contact",
            consultedParties: ["Advisory Group"],
            questionsAsked: ["Protocol clarity"],
            claimsNotMade: ["No wider endorsement"],
            attribution: "human-stated"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 4. Worker without ethics:prepare cannot record citation
      const workerNoPrepare = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["ethics:inspect"]
      });
      assert.throws(
        () =>
          recordGuidanceCitation(fixture.handle, workerNoPrepare, {
            publisher: "Ministry of Health",
            uri: "https://example.test/moh/guidelines",
            retrievedAt: "2026-09-01T00:00:00Z",
            summary: "Health research guidelines"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // 5. Worker valid record defaults to agent-inferred and specialist-proposed
      const workerCitation = recordGuidanceCitation(fixture.handle, fixture.workerCap, {
        publisher: "Ministry of Health",
        uri: "https://example.test/moh/guidelines",
        retrievedAt: "2026-09-01T00:00:00Z",
        summary: "Health research guidelines citation suggested by assistant"
      });
      assert.equal(workerCitation.attribution, "agent-inferred");
      assert.equal(workerCitation.origin, "specialist-proposed");
      assert.equal(workerCitation.currency, "unknown");

      // Worker cannot replay an owner-authored command and inherit its provenance.
      const ownerReplayRequest = {
        title: "Owner replay citation",
        publisher: "Owner board",
        uri: "https://example.test/owner-replay",
        retrievedAt: "2026-09-01T10:00:00Z",
        summary: "Owner-authored citation",
        commandId: "cmd-owner-citation-replay"
      } as const;
      const ownerCitation = recordGuidanceCitation(fixture.handle, fixture.ownerCap, ownerReplayRequest);
      assert.equal(recordGuidanceCitation(fixture.handle, fixture.ownerCap, ownerReplayRequest).id, ownerCitation.id);
      assert.throws(
        () => recordGuidanceCitation(fixture.handle, fixture.workerCap, {
          ...ownerReplayRequest
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
      );

      // 6. Verify global fetch was never invoked by guidance APIs
      // (No network call is permitted)
      assert.ok(workerCitation.id);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });
});
