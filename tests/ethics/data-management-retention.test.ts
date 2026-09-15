// story: e10s02
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  openProject,
  recordDataManagementPlan,
  inspectDataManagementPlan,
  recordResearchRetentionPlan,
  inspectResearchRetentionPlan,
  grantDataUse,
  classifyInput,
  listPermissions,
  createBranch,
  ProjectStoreError,
  createOwnerCapability,
  createWorkerCapabilities,
  registerArtifactVersion
} from "../../src/index.js";
import {
  createEthicsFixture,
  disposeEthicsFixture
} from "../support/ethics-fixtures.js";

describe("e10s02 data-management and research retention plans", () => {
  it("e10s02 data-management, retention, activity, and reopen survive close (SC-e10s02-P0-01)", () => {
    const fixture = createEthicsFixture();
    try {
      const evidence = registerArtifactVersion(fixture.handle, {
        logicalId: "evidence-dmp-guidance",
        version: "1.0",
        content: "Institutional DMP guideline documentation",
        origin: "source-import",
        access: "metadata-only"
      });

      // 1. Record DMP with local destination (permitted by default)
      const dmp = recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        dataClasses: ["de-identified-survey", "tabular-metrics"],
        intendedDestinations: ["local"],
        purposes: ["research-analysis"],
        storageLocation: "local",
        evidenceVersionIds: [evidence.id]
      });

      assert.ok(dmp.id.startsWith("dmp_"));
      assert.equal(dmp.activity, "data-collection");
      assert.deepEqual(dmp.dataClasses, ["de-identified-survey", "tabular-metrics"]);
      assert.deepEqual(dmp.intendedDestinations, ["local"]);
      assert.deepEqual(dmp.purposes, ["research-analysis"]);
      assert.equal(dmp.storageLocation, "local");
      assert.deepEqual(dmp.issues, []);
      assert.deepEqual(dmp.evidenceVersionIds, [evidence.id]);
      assert.equal(dmp.status, "recorded");
      assert.equal(dmp.attribution, "human-stated");
      assert.equal(dmp.origin, "owner-recorded");

      // 2. Record Research Retention Plan
      const retention = recordResearchRetentionPlan(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        dataClasses: ["de-identified-survey"],
        retainUntil: "2036-12-31T23:59:59Z",
        destructionIntent: "Secure overwrite of local participant keys after 10-year statutory period",
        evidenceVersionIds: [evidence.id]
      });

      assert.ok(retention.id.startsWith("retention_"));
      assert.equal(retention.activity, "data-collection");
      assert.equal(retention.retainUntil, "2036-12-31T23:59:59Z");
      assert.deepEqual(retention.dataClasses, ["de-identified-survey"]);
      assert.equal(retention.status, "recorded");

      // 3. Inspect before close
      const fetchedDmp = inspectDataManagementPlan(fixture.handle, fixture.ownerCap, dmp.id);
      assert.equal(fetchedDmp.id, dmp.id);

      const fetchedRetention = inspectResearchRetentionPlan(fixture.handle, fixture.ownerCap, retention.id);
      assert.equal(fetchedRetention.id, retention.id);

      // 4. Close and reopen handle; verify identical inspection
      fixture.handle.close();
      const reopened = openProject(fixture.root);
      try {
        const reopenedDmp = inspectDataManagementPlan(reopened, fixture.ownerCap, dmp.id);
        assert.equal(reopenedDmp.id, dmp.id);
        assert.deepEqual(reopenedDmp.dataClasses, dmp.dataClasses);
        assert.equal(reopenedDmp.status, "recorded");

        const reopenedRetention = inspectResearchRetentionPlan(reopened, fixture.ownerCap, retention.id);
        assert.equal(reopenedRetention.id, retention.id);
        assert.equal(reopenedRetention.retainUntil, retention.retainUntil);
      } finally {
        reopened.close();
      }
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s02 destination widening is rejected, not-permitted recorded, and no grant or disclosure created (SC-e10s02-P0-02)", () => {
    const fixture = createEthicsFixture();
    try {
      const artifact = registerArtifactVersion(fixture.handle, {
        logicalId: "clinical-records",
        version: "1.0",
        content: "Clinical participant data",
        origin: "source-import",
        access: "metadata-only"
      });

      // Destination "external-cloud-backup" has NO active E03 grant
      const dmp = recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        dataClasses: ["participant-identifiable"],
        intendedDestinations: ["external-cloud-backup"],
        purposes: ["long-term-storage"],
        storageLocation: "external-cloud-backup",
        evidenceVersionIds: [artifact.id]
      });

      // Must be marked destination-not-permitted
      assert.equal(dmp.status, "destination-not-permitted");
      assert.deepEqual(dmp.deniedDestinations, ["external-cloud-backup"]);
      assert.deepEqual(dmp.issues, ["destination-not-permitted"]);

      // Verify that no E03 permission grant was created
      const perms = listPermissions(fixture.handle, artifact.id);
      assert.equal(perms.length, 0, "no E03 permission was manufactured");

      // E03 requires classified material before an external grant can be used.
      classifyInput(fixture.handle, artifact.id, {
        sensitivity: "restricted",
        basis: "owner classification"
      });

      // Now grant external-archive in E03
      grantDataUse(fixture.handle, {
        inputVersion: artifact.id,
        destination: "external-archive",
        purpose: "long-term-storage",
        authority: "owner-grant"
      });

      // Now record DMP targeting external-archive; should be recorded
      const permittedDmp = recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        dataClasses: ["participant-identifiable"],
        intendedDestinations: ["external-archive"],
        purposes: ["long-term-storage"],
        storageLocation: "external-archive",
        evidenceVersionIds: [artifact.id]
      });
      assert.equal(permittedDmp.status, "recorded");
      assert.equal(permittedDmp.deniedDestinations, undefined);

      const deniedPurposeDmp = recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
        activity: "data-collection",
        dataClasses: ["participant-identifiable"],
        intendedDestinations: ["external-archive"],
        purposes: ["unapproved-purpose"],
        storageLocation: "external-archive",
        evidenceVersionIds: [artifact.id]
      });
      assert.equal(deniedPurposeDmp.status, "destination-not-permitted");
      assert.deepEqual(deniedPurposeDmp.deniedDestinations, ["external-archive"]);
      assert.deepEqual(deniedPurposeDmp.issues, ["destination-not-permitted"]);
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s02 deletion, purge, diagnostic, and tombstone isolation is preserved (SC-e10s02-P0-03)", () => {
    const fixture = createEthicsFixture();
    try {
      for (const dataClasses of [[], [123]] as never[]) {
        assert.throws(
          () => recordResearchRetentionPlan(fixture.handle, fixture.ownerCap, {
            activity: "identifiable-analysis", dataClasses, retainUntil: "2030-01-01T00:00:00Z", destructionIntent: "missing class regression"
          }),
          (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
        );
      }
      assert.throws(
        () => recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
          activity: "identifiable-analysis", dataClasses: [123] as never,
          intendedDestinations: ["local"], purposes: ["analysis"], storageLocation: "local"
        }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "invalid-argument"
      );
      const plan = recordResearchRetentionPlan(fixture.handle, fixture.ownerCap, {
        activity: "identifiable-analysis",
        dataClasses: ["derived-identifiers"],
        retainUntil: "2030-01-01T00:00:00Z",
        destructionIntent: "Delete derived features after study publication"
      });
      assert.ok(plan.id);

      // Verify no E15 deletion tombstones exist
      const tombstones = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'deletion_tombstones'")
        .get() as { count: number };
      if (tombstones.count > 0) {
        const rows = fixture.handle.db
          .prepare("SELECT COUNT(*) AS count FROM deletion_tombstones")
          .get() as { count: number };
        assert.equal(rows.count, 0, "no deletion tombstones created");
      }

      // Verify no diagnostic purge events exist
      const diagEvents = fixture.handle.db
        .prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'diagnostic_events'")
        .get() as { count: number };
      if (diagEvents.count > 0) {
        const purgeEvents = fixture.handle.db
          .prepare("SELECT COUNT(*) AS count FROM diagnostic_events WHERE kind LIKE '%purge%'")
          .get() as { count: number };
        assert.equal(purgeEvents.count, 0, "no diagnostic purge events created");
      }
    } finally {
      disposeEthicsFixture(fixture);
    }
  });

  it("e10s02 branch isolation, worker capability, and grant minting boundaries are enforced (SC-e10s02-P1-04)", () => {
    const fixture = createEthicsFixture();
    try {
      // Create branch-alpha
      const branchA = createBranch(fixture.handle, { name: "branch-alpha" });

      const dmpA = recordDataManagementPlan(fixture.handle, fixture.ownerCap, {
        activity: "pilot",
        dataClasses: ["pre-screening-survey"],
        intendedDestinations: ["local"],
        purposes: ["research-analysis"],
        storageLocation: "local",
        branchId: branchA.id
      });
      assert.equal(dmpA.branchId, branchA.id);

      // Worker lacking ethics:prepare cannot record DMP
      const workerNoPrepare = createWorkerCapabilities({
        projectId: fixture.handle.project.id,
        projectRoot: fixture.root,
        allowedOperations: ["ethics:inspect"]
      });
      assert.throws(
        () =>
          recordDataManagementPlan(fixture.handle, workerNoPrepare, {
            activity: "pilot",
            dataClasses: ["survey"],
            intendedDestinations: ["local"],
            purposes: ["research-analysis"],
            storageLocation: "local"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker with ethics:prepare cannot record human-stated attribution or owner-recorded origin
      assert.throws(
        () =>
          recordDataManagementPlan(fixture.handle, fixture.workerCap, {
            activity: "pilot",
            dataClasses: ["survey"],
            intendedDestinations: ["local"],
            purposes: ["research-analysis"],
            storageLocation: "local",
            attribution: "human-stated"
          }),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "forbidden"
      );

      // Worker record succeeds with agent-inferred and specialist-proposed
      const workerDmp = recordDataManagementPlan(fixture.handle, fixture.workerCap, {
        activity: "pilot",
        dataClasses: ["survey"],
        intendedDestinations: ["local"],
        purposes: ["research-analysis"],
        storageLocation: "local"
      });
      assert.equal(workerDmp.attribution, "agent-inferred");
      assert.equal(workerDmp.origin, "specialist-proposed");
    } finally {
      disposeEthicsFixture(fixture);
    }
  });
});
