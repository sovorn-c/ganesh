import { join } from "node:path";
import { writeFileSync } from "node:fs";
import {
  createWorkerCapabilities,
  importLocalSource,
  listSourceLocators,
  type ProjectHandle,
  type SourceImportRequest,
  type WorkerCapability
} from "../../src/index.js";

export function evidenceWorker(handle: ProjectHandle, operations: readonly string[] = [
  "source:import", "source:inspect", "evidence:record", "evidence:inspect", "claim:record", "claim:inspect", "evidence:appraise"
]): WorkerCapability {
  return createWorkerCapabilities({ projectId: handle.project.id, projectRoot: handle.project.rootPath, allowedOperations: operations, allowedPaths: [handle.project.rootPath] });
}

export function importText(handle: ProjectHandle, commandId: string, content = "alpha\nbeta\n", access: SourceImportRequest["access"] = "full-text") {
  const path = join(handle.project.rootPath, `${commandId}.txt`);
  writeFileSync(path, content);
  const result = importLocalSource(handle, evidenceWorker(handle), {
    commandId, path, logicalId: commandId, version: "v1", format: "text", mediaType: "text/plain", access
  });
  const locator = listSourceLocators(handle, result.artifactVersionId)[0];
  if (locator === undefined) {throw new Error("fixture source did not produce a locator");}
  return { result, locator };
}
