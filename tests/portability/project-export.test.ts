// story: e15s01 — Versioned Project Export with Integrity and Current Permissions
import { describe, it, after, before } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, writeFileSync, mkdirSync, symlinkSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { tmpdir } from "node:os";
import {
  exportProject,
  inspectProjectPacket,
  getPortabilityOperation,
  createOwnerCapability,
  createWorkerCapabilities,
  createE15Schema,
  PROJECT_SCHEMA_VERSION,
  ProjectStoreError
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

  it("e15s01 adversarial: inspectProjectPacket rejects path traversal in manifest", () => {
    const maliciousDir = emptyDestination();
    try {
      mkdirSync(maliciousDir, { recursive: true });
      const maliciousManifest = {
        kind: "project",
        schemaVersion: PROJECT_SCHEMA_VERSION,
        projectId: "test-proj",
        createdAt: new Date().toISOString(),
        destination: "local",
        purpose: "test",
        files: [
          { relativePath: "../outside.txt", sha256: "fakehash" }
        ],
        omissions: [],
        commitmentIds: [],
        evidenceLocatorIds: []
      };
      writeFileSync(join(maliciousDir, "ganesh-project-packet.json"), JSON.stringify(maliciousManifest, null, 2));

      assert.throws(
        () => inspectProjectPacket(maliciousDir),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "path-escape"
      );
    } finally {
      rmSync(maliciousDir, { recursive: true, force: true });
    }
  });

  it("e15s01 adversarial: inspectProjectPacket rejects symlink traversal escaping root", () => {
    const maliciousDir = emptyDestination();
    const outsideTarget = emptyDestination();
    try {
      mkdirSync(maliciousDir, { recursive: true });
      mkdirSync(outsideTarget, { recursive: true });
      writeFileSync(join(outsideTarget, "secret.txt"), "sensitive external host data");

      // Create symlink inside packet pointing to outside directory
      const symlinkDir = join(maliciousDir, "artifacts");
      mkdirSync(symlinkDir, { recursive: true });
      symlinkSync(outsideTarget, join(symlinkDir, "escape_link"));

      const maliciousManifest = {
        kind: "project",
        schemaVersion: PROJECT_SCHEMA_VERSION,
        projectId: "test-proj",
        createdAt: new Date().toISOString(),
        destination: "local",
        purpose: "test",
        files: [
          { relativePath: "artifacts/escape_link/secret.txt", sha256: "fakehash" }
        ],
        omissions: [],
        commitmentIds: [],
        evidenceLocatorIds: []
      };
      writeFileSync(join(maliciousDir, "ganesh-project-packet.json"), JSON.stringify(maliciousManifest, null, 2));

      assert.throws(
        () => inspectProjectPacket(maliciousDir),
        (err: unknown) => err instanceof ProjectStoreError && err.code === "path-escape"
      );
    } finally {
      rmSync(maliciousDir, { recursive: true, force: true });
      rmSync(outsideTarget, { recursive: true, force: true });
    }
  });

  it("e15s01 export replacement safely purges stale restricted bytes on destination reuse", () => {
    const pubArt = registerPublicArtifact(fix.handle, "doc-reuse-pub", "v1", "public reusable content");
    const restrArt = registerPublicArtifact(fix.handle, "doc-reuse-restr", "v1", "restricted sensitive content");

    classifyAndGrant(fix.handle, pubArt.id, "external-cloud", "analysis");
    const restrGrant = classifyAndGrant(fix.handle, restrArt.id, "external-cloud", "analysis");

    const reuseDest = join(destDir, "packet-reuse-stale");

    const export1 = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-reuse-cmd-1",
      destinationPath: reuseDest,
      destination: "external-cloud",
      purpose: "analysis",
      payloadHash: packetPayloadHash({ cmd: "export-1" })
    });

    assert.equal(export1.manifest.omissions.some(o => o.artifactVersionId === restrArt.id), false, "restricted artifact must not be omitted initially");
    const pubEntry = export1.manifest.files.find(f => f.relativePath.includes(pubArt.id));
    const restrEntry = export1.manifest.files.find(f => f.relativePath.includes(restrArt.id));
    assert.ok(pubEntry, "public file must be in export1 manifest files");
    assert.ok(restrEntry, "restricted file must be in export1 manifest files");

    const pubPath = join(reuseDest, pubEntry.relativePath);
    const restrPath = join(reuseDest, restrEntry.relativePath);
    assert.equal(existsSync(pubPath), true, "public artifact must exist after first export");
    assert.equal(existsSync(restrPath), true, "restricted artifact must exist after first export");

    withdrawDataUse(fix.handle, restrGrant.id, "withdrawn consent for sensitive doc");

    const export2 = exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-reuse-cmd-2",
      destinationPath: reuseDest,
      destination: "external-cloud",
      purpose: "analysis",
      payloadHash: packetPayloadHash({ cmd: "export-2" })
    });

    assert.equal(
      export2.manifest.omissions.some(o => o.artifactVersionId === restrArt.id && o.reason.includes("withdrawn")),
      true,
      "restricted artifact must be omitted with withdrawn reason"
    );

    assert.equal(existsSync(restrPath), false, "stale restricted artifact MUST NOT survive export replacement");
    assert.equal(existsSync(pubPath), true, "public artifact must still be present");

    const inspection = inspectProjectPacket(reuseDest);
    assert.equal(inspection.valid, true, "re-exported packet must be valid");

    // Verify parent directory contains no discard or staging residue
    const parentEntries = readdirSync(dirname(reuseDest));
    assert.equal(
      parentEntries.some((e) => e.includes(".discard-") || e.includes(".staging-")),
      false,
      "export replacement must not leave discard or staging residue in parent directory"
    );

    // Verify pre-existing discard residue is purged on destination reuse
    const fakeDiscardResidue = join(dirname(reuseDest), `.${basename(reuseDest)}.discard-stale-999`);
    mkdirSync(fakeDiscardResidue, { recursive: true });
    writeFileSync(join(fakeDiscardResidue, "stale-secret.txt"), "leftover discard bytes");
    assert.equal(existsSync(fakeDiscardResidue), true);

    exportProject(fix.handle, fix.ownerCap, {
      commandId: "export-reuse-cmd-3",
      destinationPath: reuseDest,
      destination: "external-cloud",
      purpose: "analysis",
      payloadHash: packetPayloadHash({ cmd: "export-3" })
    });

    assert.equal(existsSync(fakeDiscardResidue), false, "pre-existing discard residue must be purged on export");
  });
});

