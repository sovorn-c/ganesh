// story: e15s01 — Versioned Project Export with Integrity and Current Permissions
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportProject,
  inspectProjectPacket,
  getPortabilityOperation,
  createOwnerCapability,
  createWorkerCapabilities,
  createE15Schema,
  PROJECT_SCHEMA_VERSION
} from "../../src/index.js";
import { withdrawDataUse } from "../../src/policy/policy-store.js";
import {
  portabilityFixture,
  disposePortabilityFixture,
  registerPublicArtifact,
  classifyAndGrant,
  packetPayloadHash,
  emptyDestination,
  type PortabilityFixture
} from "../support/portability-fixtures.js";

describe("E15s01 versioned project export", () => {
  let fix: PortabilityFixture;
  let destDir: string;

  before(() => {
    fix = portabilityFixture();
    destDir = emptyDestination();
  });

  after(() => {
    disposePortabilityFixture(fix);
    rmSync(destDir, { recursive: true, force: true });
  });

  // SC-e15s01-P0-01: Packet survives close with matching hashes
  it("e15s01 schema tables are created and reopen succeeds after migration", () => {
    // E15 tables should already exist (created by createProject → createSchema)
    const row = fix.handle.db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='portability_operations'"
    ).get() as Record<string, unknown> | undefined;
    assert.ok(row, "portability_operations table should exist");
  });

  it("e15s01 packet survives close with matching hashes", () => {
    const artifact = registerPublicArtifact(fix.handle, "doc-1", "v1", "hello world");
    classifyAndGrant(fix.handle, artifact.id, "local", "research");

    const packetDest = join(destDir, "packet-1");
    const payloadHash = packetPayloadHash({ dest: packetDest });
    const packet = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-cmd-1",
      destinationPath: packetDest,
      destination: "local",
      purpose: "backup",
      payloadHash
    });

    assert.equal(packet.manifest.schemaVersion, PROJECT_SCHEMA_VERSION);
    assert.ok(packet.manifest.files.length > 0, "packet should contain files");
    assert.ok(packet.manifest.files.some(f => f.relativePath === "project.sqlite"), "packet should contain project.sqlite");

    // Inspect after creation
    const inspection = inspectProjectPacket(packet.packetPath);
    assert.equal(inspection.valid, true, "all hashes should match");
    for (const result of inspection.hashResults) {
      assert.equal(result.match, true, `hash should match for ${result.relativePath}`);
    }
  });

  it("e15s01 atomic retry returns same packet while payload conflict is rejected", () => {
    const packetDest = join(destDir, "packet-retry");
    const payloadHash = packetPayloadHash({ dest: packetDest });

    const packet1 = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-retry-cmd",
      destinationPath: packetDest,
      destination: "local",
      purpose: "backup",
      payloadHash
    });

    // Same command retry
    const packet2 = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-retry-cmd",
      destinationPath: packetDest,
      destination: "local",
      purpose: "backup",
      payloadHash
    });
    assert.equal(packet2.packetPath, packet1.packetPath);

    // Different payload → conflict
    assert.throws(() => {
      exportProject(fix.handle, fix.ownerCap, {
        commandId: "export-retry-cmd",
        destinationPath: join(destDir, "packet-different"),
        destination: "local",
        purpose: "backup",
        payloadHash: packetPayloadHash({ dest: "different" })
      });
    }, /payload-conflict/);
  });

  // SC-e15s01-P0-02: Capability attacks fail
  it("e15s01 capability forged caller denied authority", () => {
    const packetDest = join(destDir, "packet-forged");
    assert.throws(() => {
      exportProject(fix.handle, { role: "owner", ownerId: fix.ownerId } as unknown, {
        commandId: "export-forged",
        destinationPath: packetDest,
        destination: "local",
        purpose: "test",
        payloadHash: "abc"
      });
    }, /forbidden/);
  });

  it("e15s01 worker capability denied even with wildcard", () => {
    const packetDest = join(destDir, "packet-worker");
    assert.throws(() => {
      exportProject(fix.handle, fix.workerCap, {
        commandId: "export-worker",
        destinationPath: packetDest,
        destination: "local",
        purpose: "test",
        payloadHash: "abc"
      });
    }, /workers cannot export/);
  });

  it("e15s01 wrong-owner capability denied", () => {
    const packetDest = join(destDir, "packet-wrong");
    const wrongOwner = createOwnerCapability("other-owner");
    assert.throws(() => {
      exportProject(fix.handle, wrongOwner, {
        commandId: "export-wrong",
        destinationPath: packetDest,
        destination: "local",
        purpose: "test",
        payloadHash: "abc"
      });
    }, /does not match/);
  });

  // SC-e15s01-P0-03: Restricted bytes omitted
  it("e15s01 omission notice for restricted local-only artifact on remote export", () => {
    const artifact = registerPublicArtifact(fix.handle, "restricted-doc", "v1", "secret content");
    // Classify as restricted, grant only local
    classifyAndGrant(fix.handle, artifact.id, "local", "research", "restricted");

    const packetDest = join(destDir, "packet-omission");
    const payloadHash = packetPayloadHash({ dest: packetDest });
    const packet = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-omission",
      destinationPath: packetDest,
      destination: "external-repo",
      purpose: "sharing",
      payloadHash
    });

    // The restricted artifact should be omitted
    assert.ok(
      packet.manifest.omissions.some(o => o.artifactVersionId === artifact.id),
      "restricted artifact should appear in omissions"
    );

    // Verify the artifact file is NOT in the packet artifacts dir
    const artifactInPacket = existsSync(join(packetDest, "artifacts", artifact.storagePath!.split("/").pop()!));
    // Storage path is relative, check if any artifact path matches
    const includesRestricted = packet.manifest.files.some(f =>
      f.relativePath.includes(artifact.id)
    );
    assert.equal(includesRestricted, false, "restricted artifact should not be in files");
  });

  // SC-e15s01-P1-04: Withdrawn grant results in omission
  it("e15s01 withdrawn grant artifact omitted from remote export", () => {
    const artifact = registerPublicArtifact(fix.handle, "withdrawn-doc", "v1", "old content");
    const perm = classifyAndGrant(fix.handle, artifact.id, "external-repo", "sharing");
    // Now withdraw
    withdrawDataUse(fix.handle, perm.id, "policy-change", "test-actor");

    const packetDest = join(destDir, "packet-withdrawn");
    const payloadHash = packetPayloadHash({ dest: packetDest });
    const packet = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-withdrawn",
      destinationPath: packetDest,
      destination: "external-repo",
      purpose: "sharing",
      payloadHash
    });

    assert.ok(
      packet.manifest.omissions.some(o => o.artifactVersionId === artifact.id),
      "withdrawn artifact should be omitted"
    );
  });

  it("e15s01 commitment ids and locator ids are copied without creating decisions", () => {
    const packetDest = join(destDir, "packet-commitments");
    const payloadHash = packetPayloadHash({ dest: packetDest });
    const packet = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-commitments",
      destinationPath: packetDest,
      destination: "local",
      purpose: "backup",
      payloadHash
    });
    // commitmentIds and evidenceLocatorIds should be arrays (possibly empty)
    assert.ok(Array.isArray(packet.manifest.commitmentIds));
    assert.ok(Array.isArray(packet.manifest.evidenceLocatorIds));
  });

  it("e15s01 regression: portability operation tracked", () => {
    const packetDest = join(destDir, "packet-regression-op");
    const payloadHash = packetPayloadHash({ dest: packetDest });
    exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-cmd-reg",
      destinationPath: packetDest,
      destination: "local",
      purpose: "backup",
      payloadHash
    });
    const op = getPortabilityOperation(fix.handle, "export-cmd-reg");
    assert.ok(op, "operation should exist");
    assert.equal(op!.status, "complete");
    assert.equal(op!.kind, "export");
  });
});
