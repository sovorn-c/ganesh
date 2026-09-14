// story: e09s01
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

export interface MethodologyFixture {
  readonly root: string;
  readonly handle: ProjectHandle;
  readonly ownerCap: OwnerCapability;
  readonly workerCap: WorkerCapability;
  readonly ownerId: string;
}

export function createMethodologyFixture(ownerId = "owner-methodology"): MethodologyFixture {
  const root = mkdtempSync(join(tmpdir(), "ganesh-methodology-"));
  const handle = createProject({ rootPath: root, ownerId });
  const ownerCap = createOwnerCapability(ownerId);
  const workerCap = createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: root,
    allowedOperations: [
      "methodology:inspect",
      "methodology:frame",
      "methodology:design",
      "methodology:audit"
    ]
  });
  return { root, handle, ownerCap, workerCap, ownerId };
}

export function disposeMethodologyFixture(fixture: MethodologyFixture): void {
  try {
    fixture.handle.close();
  } catch {
    // ignore
  }
  rmSync(fixture.root, { recursive: true, force: true });
}
