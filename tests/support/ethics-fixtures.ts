// story: e10s01
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  createProject,
  createOwnerCapability,
  createWorkerCapabilities,
  type ProjectHandle,
  type OwnerCapability,
  type WorkerCapability
} from "../../src/index.js";

export interface EthicsFixture {
  readonly root: string;
  readonly handle: ProjectHandle;
  readonly ownerCap: OwnerCapability;
  readonly workerCap: WorkerCapability;
  readonly ownerId: string;
}

export function createEthicsFixture(ownerId = "owner-ethics"): EthicsFixture {
  const root = mkdtempSync(join(tmpdir(), "ganesh-ethics-"));
  const handle = createProject({ rootPath: root, ownerId });
  const ownerCap = createOwnerCapability(ownerId);
  const workerCap = createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: root,
    allowedOperations: [
      "ethics:inspect",
      "ethics:prepare"
    ]
  });
  return { root, handle, ownerCap, workerCap, ownerId };
}

export function disposeEthicsFixture(fixture: EthicsFixture): void {
  try {
    fixture.handle.close();
  } catch {
    // ignore
  }
  rmSync(fixture.root, { recursive: true, force: true });
}
