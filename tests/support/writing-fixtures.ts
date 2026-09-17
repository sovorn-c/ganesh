import {
  createWorkerCapabilities,
  type ProjectHandle,
  type WorkerCapability
} from "../../src/index.js";

export function writingWorker(
  handle: ProjectHandle,
  operations: readonly string[] = ["writing:inspect", "writing:record", "writing:review"]
): WorkerCapability {
  return createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: handle.project.rootPath,
    allowedOperations: operations,
    allowedPaths: [handle.project.rootPath]
  });
}
