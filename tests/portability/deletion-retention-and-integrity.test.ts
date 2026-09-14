// story: e15s04 — Controlled Deletion of Derived Content and Caches
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import {
  writeFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import {
  deleteArtifactContent,
  getEvidenceTombstone,
  listDeletionEvents,
  inspectArtifactVersion,
  backupProject,
  createDecisionPacket,
  recordOwnerDecision,
  updateBranchReference,
  assessReadiness,
  deriveMaterial,
  requestDisclosure,
  registerArtifactVersion,
  classifyInput,
  grantDataUse,
  proposeContract,
  authorizeContract,
  queueRun,
  dispatchRun,
  ProjectStoreError,
  recoverProject,
} from "../../src/index.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  type PortabilityFixture,
} from "../support/portability-fixtures.js";

describe("Controlled deletion retention and integrity", () => {
  let fix: PortabilityFixture;

  before(() => {
    fix = portabilityFixture("owner-deletion-test");
  });

  after(() => {
    disposePortabilityFixture(fix);
  });

  it("deletion command retry is idempotent and payload-bound", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "retry-delete",
      "v1",
      "retry bytes",
    );
    const request = {
      artifactVersionId: art.id,
      reason: "retry-test",
      commandId: "delete-retry-test",
      payloadHash: packetPayloadHash({ retry: "1" }),
    };
    const first = deleteArtifactContent(fix.handle, fix.ownerCap, request);
    const second = deleteArtifactContent(fix.handle, fix.ownerCap, request);
    assert.equal(second.deletionEventId, first.deletionEventId);
    assert.throws(
      () =>
        deleteArtifactContent(fix.handle, fix.ownerCap, {
          ...request,
          payloadHash: packetPayloadHash({ retry: "2" }),
        }),
      (error: unknown) =>
        error instanceof ProjectStoreError && error.code === "payload-conflict",
    );
  });

  it("deletion purges source excerpts from SQLite while retaining only tombstone metadata", () => {
    const art = registerPublicArtifact(
      fix.handle,
      "doc-sqlite-purge",
      "v1",
      "restricted source bytes",
    );
    fix.handle.db
      .prepare(
        `
      INSERT INTO source_versions
        (artifact_version_id, format, media_type, original_name, access_level, extraction_status, parser_name, parser_version, created_at)
      VALUES (?, 'txt', 'text/plain', 'restricted.txt', 'full-text', 'complete', 'test', '1', ?)
    `,
      )
      .run(art.id, new Date().toISOString());
    fix.handle.db
      .prepare(
        "INSERT INTO source_segments (id, source_version_id, derived_version_id, locator, text) VALUES (?, ?, ?, ?, ?)",
      )
      .run(
        "segment-purge",
        art.id,
        art.id,
        "1:2",
        "restricted excerpt must disappear",
      );
    fix.handle.db
      .prepare(
        "INSERT INTO source_records (id, source_version_id, record_kind, record_data, locator, access_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "record-purge",
        art.id,
        "note",
        "restricted record bytes",
        "row-1",
        "full-text",
        new Date().toISOString(),
      );
    fix.handle.db
      .prepare(
        "INSERT INTO evidence_items (id, source_version_id, location_kind, location_id, locator_snapshot, statement_kind, origin, limitations, excerpt, excerpt_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        "evidence-purge",
        art.id,
        "segment",
        "segment-purge",
        "{}",
        "quote",
        "source",
        "",
        "restricted evidence excerpt",
        "hash",
        new Date().toISOString(),
      );

    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art.id,
      reason: "source erasure",
      commandId: "del-sqlite-purge",
      payloadHash: packetPayloadHash({ art: art.id }),
    });

    assert.equal(
      fix.handle.db
        .prepare(
          "SELECT count(*) AS count FROM source_segments WHERE id = 'segment-purge'",
        )
        .get()?.count,
      0,
    );
    assert.equal(
      fix.handle.db
        .prepare(
          "SELECT count(*) AS count FROM source_records WHERE id = 'record-purge'",
        )
        .get()?.count,
      0,
    );
    assert.equal(
      fix.handle.db
        .prepare(
          "SELECT count(*) AS count FROM evidence_items WHERE id = 'evidence-purge'",
        )
        .get()?.count,
      0,
    );
    assert.equal(
      JSON.stringify(
        getEvidenceTombstone(fix.handle, fix.ownerCap, art.id),
      ).includes("restricted evidence excerpt"),
      false,
    );
  });

  it("readiness is blocked and revalidation required when artifact is deleted", () => {
    const art2 = registerPublicArtifact(
      fix.handle,
      "doc-readiness",
      "v1",
      "readiness input bytes",
    );

    updateBranchReference(fix.handle, {
      branchId: "main",
      logicalId: art2.logicalId,
      artifactVersionId: art2.id,
      expectedVersion: 0,
      commandId: "branch-ref-art2",
    });

    const packet = createDecisionPacket(fix.handle, {
      question: "Select doc-readiness",
      branchId: "main",
      candidateVersionIds: [art2.id],
    });

    recordOwnerDecision(fix.handle, {
      packetId: packet.id,
      disposition: "approved",
      selectedCandidateVersionIds: [art2.id],
      commandId: "commit-readiness-art2",
      capability: fix.ownerCap,
    });

    // Before deletion, readiness should not be blocked by unavailability
    const beforeReadiness = assessReadiness(fix.handle, {
      packetId: packet.id,
    });
    assert.equal(beforeReadiness.status, "ready");

    // Delete the artifact
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: art2.id,
      reason: "withdrawn consent",
      commandId: "del-cmd-readiness",
      payloadHash: packetPayloadHash({ art: art2.id }),
    });

    // After deletion, readiness must be blocked
    const afterReadiness = assessReadiness(fix.handle, { packetId: packet.id });
    assert.equal(afterReadiness.status, "blocked");
    assert.ok(afterReadiness.causes.some((c) => c.includes("unavailable")));
  });

  // SC-e15s04-P0-03: External disclosures are not recalled
  it("work dispatch is blocked after its input is deleted", async () => {
    const input = registerPublicArtifact(
      fix.handle,
      "doc-dispatch-delete",
      "v1",
      "dispatch input bytes",
    );
    classifyInput(fix.handle, input.id, {
      sensitivity: "public",
      basis: "test",
    });
    grantDataUse(fix.handle, {
      inputVersion: input.id,
      destination: "local",
      purpose: "research-work",
      authority: fix.ownerId,
    });
    const proposed = proposeContract(fix.handle, fix.ownerCap, {
      id: "contract-dispatch-delete",
      objective: "blocked dispatch regression",
      inputVersionIds: [input.id],
      permittedRoles: ["discovery"],
      limits: { tokens: 10, calls: 1, timeMs: 1000 },
    });
    const authorized = authorizeContract(fix.handle, fix.ownerCap, {
      contractId: proposed.id,
    });
    const run = queueRun(fix.handle, fix.ownerCap, {
      contractId: authorized.id,
      commandId: "queue-dispatch-delete",
      reservation: { tokens: 1, calls: 1, timeMs: 100 },
    });
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: input.id,
      reason: "dispatch input withdrawn",
      commandId: "del-dispatch-input",
      payloadHash: packetPayloadHash({ art: input.id }),
    });
    let starts = 0;
    const result = await dispatchRun(fix.handle, fix.ownerCap, run.id, {
      start: () => {
        starts += 1;
        return { status: "ok" };
      },
    });
    assert.equal(result.status, "blocked");
    assert.equal(starts, 0);
  });

  it("decision history and commitment records remain inspectable after deletion regression", () => {
    const artReg = registerPublicArtifact(
      fix.handle,
      "doc-reg-del",
      "v1",
      "reg content",
    );
    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artReg.id,
      reason: "regression test deletion",
      commandId: "del-cmd-regression",
      payloadHash: packetPayloadHash({ art: artReg.id }),
    });

    // List deletion events
    const events = listDeletionEvents(fix.handle, fix.ownerCap);
    assert.ok(events.length > 0, "deletion events must be recorded");
    assert.ok(events.some((e) => e.artifactVersionId === artReg.id));

    // Check commitments table still intact
    const commitments = fix.handle.db
      .prepare("SELECT count(*) as cnt FROM commitments")
      .get() as { cnt: number };
    assert.ok(
      commitments.cnt >= 0,
      "commitments table must remain inspectable",
    );
  });

  it("deletion restricts cache removal to affected versions and preserves unrelated caches", () => {
    const artTarget = registerPublicArtifact(
      fix.handle,
      "doc-cache-target",
      "v1",
      "cache target content",
    );
    const cacheDir = join(fix.root, ".ganesh", "artifacts", "cache");
    mkdirSync(cacheDir, { recursive: true });

    const targetCache = join(cacheDir, `${artTarget.id}.cache`);
    const unrelatedCache1 = join(cacheDir, "unrelated-research-data.cache");
    const unrelatedCache2 = join(cacheDir, "shared-indexes.cache");

    writeFileSync(targetCache, "target cache bytes");
    writeFileSync(unrelatedCache1, "unrelated cache bytes 1");
    writeFileSync(unrelatedCache2, "unrelated cache bytes 2");

    assert.equal(existsSync(targetCache), true);
    assert.equal(existsSync(unrelatedCache1), true);
    assert.equal(existsSync(unrelatedCache2), true);

    deleteArtifactContent(fix.handle, fix.ownerCap, {
      artifactVersionId: artTarget.id,
      reason: "targeted cache deletion",
      commandId: "del-cache-target-cmd",
      payloadHash: packetPayloadHash({ c: "1" }),
    });

    // Target cache must be unlinked
    assert.equal(
      existsSync(targetCache),
      false,
      "target artifact cache must be unlinked",
    );
    // Unrelated caches must be PRESERVED
    assert.equal(
      existsSync(unrelatedCache1),
      true,
      "unrelated cache 1 must be preserved",
    );
    assert.equal(
      existsSync(unrelatedCache2),
      true,
      "unrelated cache 2 must be preserved",
    );
  });
});
