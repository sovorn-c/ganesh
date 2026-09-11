// story: e06s03
import { parentPort, workerData } from "node:worker_threads";
import { ProjectStoreError } from "../project/project-types.js";
import { parseStructuredPayload } from "./structured-parser.js";
import type { StructuredParserTask } from "./structured-worker.js";

if (parentPort === null) {throw new Error("structured parser worker requires a parent port");}

try {
  const task = workerData as StructuredParserTask;
  if (task.kind !== "structured") {throw new ProjectStoreError("structured-task-unsupported", "unsupported structured parser task");}
  const value = await parseStructuredPayload(task.sourceVersionId, task.format, task.bytes, task.limits);
  parentPort.postMessage({ ok: true, value });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      code: error instanceof ProjectStoreError ? error.code : "structured-parser-failed",
      message: error instanceof Error ? error.message : "structured parser failed"
    }
  });
}
