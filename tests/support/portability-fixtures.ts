import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProject,
  registerArtifactVersion,
  createOwnerCapability,
  createWorkerCapabilities,
  type ProjectHandle,
  type ArtifactVersionRecord,
  type OwnerCapability,
  type WorkerCapability
} from "../../src/index.js";
import { classifyInput, grantDataUse, withdrawDataUse } from "../../src/policy/policy-store.js";
import { requestDisclosure } from "../../src/policy/disclosure-gateway.js";
import { sha256 as computeSha256, bytesFor } from "../../src/persistence/storage-utils.js";

export interface PortabilityFixture {
  readonly root: string;
  readonly handle: ProjectHandle;
  readonly ownerCap: OwnerCapability;
  readonly workerCap: WorkerCapability;
  readonly ownerId: string;
}

export function portabilityFixture(ownerId = "owner-portability"): PortabilityFixture {
  const root = mkdtempSync(join(tmpdir(), "ganesh-portability-"));
  const handle = createProject({ rootPath: root, ownerId });
  const ownerCap = createOwnerCapability(ownerId);
  const workerCap = createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: root,
    allowedOperations: ["*"]
  });
  return { root, handle, ownerCap, workerCap, ownerId };
}

export function disposePortabilityFixture(fixture: PortabilityFixture): void {
  fixture.handle.close();
  rmSync(fixture.root, { recursive: true, force: true });
}

export function registerPublicArtifact(
  handle: ProjectHandle,
  logicalId: string,
  version: string,
  content: string
): ArtifactVersionRecord {
  return registerArtifactVersion(handle, {
    logicalId,
    version,
    versionId: `${logicalId}-${version}`,
    content
  });
}

export function classifyAndGrant(
  handle: ProjectHandle,
  versionId: string,
  destination: string,
  purpose: string,
  sensitivity: "public" | "confidential" | "participant-identifiable" | "restricted" = "public"
) {
  classifyInput(handle, versionId, {
    sensitivity,
    basis: "test-classification",
    actor: "test"
  });
  return grantDataUse(handle, {
    inputVersion: versionId,
    destination,
    purpose,
    authority: "test",
    allowedTransformations: ["none"]
  });
}

export function packetPayloadHash(request: Record<string, string>): string {
  return computeSha256(bytesFor(JSON.stringify(request)));
}

export function emptyDestination(): string {
  return mkdtempSync(join(tmpdir(), "ganesh-dest-"));
}
