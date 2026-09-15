// story: e10s01
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import {
  openProject,
  recordRiskRegisterItem,
  inspectRiskRegister,
  inspectRiskRegisterItem,
  ingestEthicsCandidate,
  listCommitments,
  PROJECT_SCHEMA_VERSION,
  ProjectStoreError,
  ethicsSchemaAvailable,
  createOwnerCapability,
  createWorkerCapabilities,
  registerArtifactVersion
} from "../../src/index.js";
import {
  createEthicsFixture,
  disposeEthicsFixture
} from "../support/ethics-fixtures.js";
import type { RiskRegisterItemRequest } from "../../src/ethics/ethics-types.js";

describe("e10s01 activity-specific risk registers with evidence", () => {
  it("e10s01 schema, risk register, activity, reopen, and unknowns survive close without invented authority (SC-e10s01-P0-01, SC-e10s01-P0-03)", () => {
    const fixture = createEthicsFixture();
    try {
      // Register an evidence artifact version to link
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "evidence-hdec-notice",
        version: "1.0",
        content: "Institutional risk review guidance excerpt",
        origin: "source-import",
        access: "metadata-only"
      });

      const item = recordRiskRegisterItem(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        requirementText: "Must obtain participant consent with language interpreter support",
        institutionOrCommunity: "Example Clinic North Community Advisory Board",
        evidenceVersionIds: [evidence.id],
        residualRisk: "low",
        mitigations: ["Provide translated information sheets", "Certified interpreter on site"]
      });

      assert.ok(item.id.startsWith("risk_"), "risk register item id prefix");
      assert.equal(item.activity, "data-collection");
      assert.equal(item.requirementText, "Must obtain participant consent with language interpreter support");
      assert.equal(item.institutionOrCommunity, "Example Clinic North Community Advisory Board");
      assert.deepEqual(item.evidenceVersionIds, [evidence.id]);
      assert.equal(item.residualRisk, "low");
      assert.deepEqual(item.mitigations, ["Provide translated information sheets", "Certified interpreter on site"]);
      assert.equal(item.attribution, "human-stated");
      assert.equal(item.origin, "owner-recorded");
      assert.equal(item.status, "recorded");
      assert.ok(item.artifactVersionId, "has registered artifact version");

      // Inspect risk register returns the item
      const list = inspectRiskRegister(fixture.handle, fixture.ownerCap);
      assert.equal(list.length, 1);
      assert.equal(list[0].id, item.id);

      // Single item inspect
      const fetched = inspectRiskRegisterItem(fixture.handle, fixture.ownerCap, item.id);
      assert.equal(fetched.id, item.id);
      assert.equal(fetched.activity, "data-collection");

      // Idempotent record with same commandId
      const idempotent = recordRiskRegisterItem(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        requirementText: "Must obtain participant consent with language interpreter support",
        institutionOrCommunity: "Example Clinic North Community Advisory Board",
        evidenceVersionIds: [evidence.id],
        residualRisk: "low",
        mitigations: ["Provide translated information sheets", "Certified interpreter on site"],
        commandId: item.commandId
      });
      assert.equal(idempotent.id, item.id);

      // Payload conflict throws
      assert.throws(
        () => {
          recordRiskRegisterItem(fixture.handle, fixture.ownerCap, {
            activity: "participant-recruitment",
            requirementText: "Different text",
            institutionOrCommunity: "Different clinic",
            commandId: item.commandId
          });
        },
        (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
      );

      // Invalid activity is rejected
      assert.throws(
        () => {
          recordRiskRegisterItem(fixture.handle, fixture.ownerCap, {
            activity: "invalid-activity" as unknown as RiskRegisterItemRequest["activity"],
            requirementText: "Some text",
            institutionOrCommunity: "Some clinic"
          });
        },
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );

      // Close and reopen project handle; inspect must return identical items
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedList = inspectRiskRegister(reopened, fixture.ownerCap);
        assert.equal(reopenedList.length, 1);
        assert.equal(reopenedList[0].id, item.id);
        assert.equal(reopenedList[0].requirementText, item.requirementText);
        assert.equal(reopenedList[0].institutionOrCommunity, item.institutionOrCommunity);
        assert.deepEqual(reopenedList[0].evidenceVersionIds, [evidence.id]);
        assert.equal(reopenedList[0].attribution, "human-stated");
      } finally {
        reopened.close();
      }
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s01 replay is capability-safe, candidate command reuse conflicts, and evidence stays project-local", () => {
    const fixture = createEthicsFixture();
    try {
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "replay-evidence", version: "1.0", content: "evidence", origin: "source-import", access: "metadata-only"
      });
      const prepareOnly = createWorkerCapabilities({
        projectId: fixture.handle.project.id, projectRoot: fixture.root, allowedOperations: ["ethics:prepare"]
      });
      const request = {
        activity: "literature-only" as const,
        requirementText: "Replay must not widen worker authority",
        institutionOrCommunity: "Example review board",
        evidenceVersionIds: [evidence.id],
        commandId: "cmd-replay-safe"
      };
      const first = recordRiskRegisterItem(fixture.handle, prepareOnly, request);
      const replay = recordRiskRegisterItem(fixture.handle, prepareOnly, request);
      assert.equal(replay.id, first.id);
      assert.throws(
        () => recordRiskRegisterItem(fixture.handle, prepareOnly, { ...request, evidenceVersionIds: ["artifact-from-another-project"] }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "artifact-not-found"
      );

      const candidate = ingestEthicsCandidate(fixture.handle, prepareOnly, {
        kind: "risk-register", commandId: "cmd-candidate-reuse", payload: { requirementText: "first" }
      });
      assert.equal(ingestEthicsCandidate(fixture.handle, prepareOnly, {
        kind: "risk-register", commandId: "cmd-candidate-reuse", payload: { requirementText: "first" }
      }).id, candidate.id);
      assert.throws(
        () => ingestEthicsCandidate(fixture.handle, prepareOnly, {
          kind: "guidance-citation", commandId: "cmd-candidate-reuse", payload: { requirementText: "first" }
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "payload-conflict"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s01 capability, forged, worker, wrong-owner, and denied callers fail before write or inspect (SC-e10s01-P1-04)", () => {
    const fixture = createEthicsFixture();
    try {
      const validPayload = {
        activity: "literature-only" as const,
        requirementText: "Verify secondary dataset license terms",
        institutionOrCommunity: "Academic Repository Board"
      };

      // Forged capability (plain object)
      assert.throws(
        () => recordRiskRegisterItem(fixture.handle, { role: "owner", ownerId: fixture.ownerId }, validPayload),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Wrong-owner capability
      const wrongOwnerCap = createOwnerCapability("different-owner");
      assert.throws(
        () => recordRiskRegisterItem(fixture.handle, wrongOwnerCap, validPayload),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker lacking ethics:prepare
      const workerWithoutPrepare = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["ethics:inspect"]
      });
      assert.throws(
        () => recordRiskRegisterItem(fixture.handle, workerWithoutPrepare, validPayload),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker with ethics:prepare can record, but cannot record human-stated attribution
      assert.throws(
        () =>
          recordRiskRegisterItem(fixture.handle, fixture.workerCap, {
            ...validPayload,
            attribution: "human-stated"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker with ethics:prepare cannot record owner-recorded origin
      assert.throws(
        () =>
          recordRiskRegisterItem(fixture.handle, fixture.workerCap, {
            ...validPayload,
            origin: "owner-recorded"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker recording with defaults gets agent-inferred and specialist-proposed
      const workerItem = recordRiskRegisterItem(fixture.handle, fixture.workerCap, validPayload);
      assert.equal(workerItem.attribution, "agent-inferred");
      assert.equal(workerItem.origin, "specialist-proposed");

      // Worker lacking ethics:inspect cannot inspect
      const workerWithoutInspect = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["ethics:prepare"]
      });
      assert.throws(
        () => inspectRiskRegister(fixture.handle, workerWithoutInspect),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Cross-project worker capability
      const crossProjectWorker = createWorkerCapabilities({
        projectId: "other-project-id",
        projectRoot: fixture.root,
        allowedOperations: ["ethics:inspect", "ethics:prepare"]
      });
      assert.throws(
        () => inspectRiskRegister(fixture.handle, crossProjectWorker),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s01 commitment, specialist, grant, candidate, and owner-decision independence is preserved (SC-e10s01-P0-02)", () => {
    const fixture = createEthicsFixture();
    try {
      // 1. Record risk register item
      const item = recordRiskRegisterItem(fixture.handle, fixture.ownerCap, {
        activity: "participant-contact",
        requirementText: "Phone contact script requires approved phrasing",
        institutionOrCommunity: "University Ethics Secretariat"
      });
      assert.ok(item.id);

      // 2. Ingest specialist candidate
      const candidate = ingestEthicsCandidate(fixture.handle, fixture.workerCap, {
        kind: "risk-register",
        payload: {
          activity: "data-collection",
          requirementText: "Survey questions on workplace stress",
          institutionOrCommunity: "Workplace Health Review"
        }
      });
      assert.ok(candidate.id.startsWith("cand_"));
      assert.equal(candidate.attribution, "agent-inferred");
      assert.equal(candidate.origin, "specialist-proposed");
      assert.equal(candidate.status, "proposed");

      // 3. Verify no E04 commitment was created
      const commitments = listCommitments(fixture.handle);
      assert.equal(commitments.length, 0, "no commitment created by ethics operations");

      // 4. Verify no external authorization grant row was inserted
      const grantCount = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM external_authorizations")
        .get() as { count: number };
      assert.equal(grantCount.count, 0, "no external authorization grant minted");
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s01 regression, unavailable, and read-only schema fails closed without mutation (SC-e10s01-P0-03)", () => {
    // Construct a legacy project database lacking E10 tables
    const root = mkdtempSync(join(tmpdir(), "ganesh-legacy-e10-"));
    try {
      const ganeshDir = join(root, ".ganesh");
      mkdirSync(ganeshDir, { recursive: true });
      const dbPath = join(ganeshDir, "project.sqlite");
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        INSERT INTO metadata (key, value) VALUES ('schema_version', '1');
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          owner_id TEXT NOT NULL,
          root_path TEXT NOT NULL UNIQUE,
          schema_version INTEGER NOT NULL,
          created_at TEXT NOT NULL
        );
        INSERT INTO projects VALUES ('proj-legacy', 'owner-legacy', '${root}', 1, '2026-09-14T00:00:00Z');
        CREATE TABLE artifact_versions (
          id TEXT PRIMARY KEY,
          logical_id TEXT NOT NULL,
          version_label TEXT NOT NULL,
          content_hash TEXT,
          storage_path TEXT,
          byte_length INTEGER,
          origin TEXT NOT NULL,
          access_level TEXT NOT NULL,
          content_status TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      db.close();

      // Open in read-only mode
      const readOnlyHandle = openProject(root, { readOnly: true });
      const ownerCap = createOwnerCapability("owner-legacy");
      try {
        assert.equal(readOnlyHandle.status, "read-only");
        assert.equal(ethicsSchemaAvailable(readOnlyHandle), false);

        // Ethics inspect should fail closed with ethics-schema-unavailable
        assert.throws(
          () => inspectRiskRegister(readOnlyHandle, ownerCap),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "ethics-schema-unavailable"
        );

        // Verify that read-only handle did NOT create ethics tables
        const checkDb = new DatabaseSync(dbPath, { readOnly: true });
        try {
          const row = checkDb
            .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'risk_register_items'")
            .get() as { count: number };
          assert.equal(row.count, 0, "no ethics tables created in read-only mode");
        } finally {
          checkDb.close();
        }
      } finally {
        readOnlyHandle.close();
      }

      // Writable ready open on the same project should ensure additive E10 tables
      const writableHandle = openProject(root);
      try {
        assert.equal(ethicsSchemaAvailable(writableHandle), true);
        assert.equal(writableHandle.project.schemaVersion, PROJECT_SCHEMA_VERSION);

        const list = inspectRiskRegister(writableHandle, ownerCap);
        assert.equal(list.length, 0);

        // Can record into it
        const item = recordRiskRegisterItem(writableHandle, ownerCap, {
          activity: "literature-only",
          requirementText: "Copyright and secondary use review",
          institutionOrCommunity: "Library Advisory"
        });
        assert.ok(item.id);
      } finally {
        writableHandle.close();
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
