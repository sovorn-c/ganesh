// story: e06s02
import { parentPort, workerData } from "node:worker_threads";
import { ProjectStoreError } from "../project/project-types.js";
import { parseDocumentForWorker } from "./document-parser.js";
import type { DocumentParserTask } from "./parser-worker.js";

if (parentPort === null) {
  throw new Error("parser worker requires a parent port");
}

try {
  const task = workerData as DocumentParserTask;
  if (task.kind !== "document") {
    throw new ProjectStoreError("parser-task-unsupported", "unsupported parser worker task");
  }
  const value = await parseDocumentForWorker(task.format, task.bytes, task.limits);
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error instanceof ProjectStoreError ? error.code : "parser-failed",
      message: error instanceof Error ? error.message : "document parser failed"
    }
  });
}
