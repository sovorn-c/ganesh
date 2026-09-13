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

export interface OperationsFixture {
  readonly root: string;
  readonly handle: ProjectHandle;
  readonly ownerCap: OwnerCapability;
  readonly workerCap: WorkerCapability;
  readonly ownerId: string;
}

export function createOperationsFixture(ownerId = "owner-operations"): OperationsFixture {
  const root = mkdtempSync(join(tmpdir(), "ganesh-operations-"));
  const handle = createProject({ rootPath: root, ownerId });
  const ownerCap = createOwnerCapability(ownerId);
  const workerCap = createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: root,
    allowedOperations: ["*"]
  });
  return { root, handle, ownerCap, workerCap, ownerId };
}

export function disposeOperationsFixture(fixture: OperationsFixture): void {
  try {
    fixture.handle.close();
  } catch {
    // ignore
  }
  rmSync(fixture.root, { recursive: true, force: true });
}
