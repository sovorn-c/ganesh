// story: e06s03
import { Worker } from "node:worker_threads";
import { ProjectStoreError } from "../project/project-types.js";
import type { StructuredImportLimits } from "./structured-types.js";

export interface StructuredParserTask {
  readonly kind: "structured";
  readonly sourceVersionId: string;
  readonly format: "bibtex" | "ris" | "csv" | "xlsx";
  readonly bytes: Uint8Array;
  readonly limits: Required<StructuredImportLimits>;
}

const DEFAULT_LIMITS: Required<StructuredImportLimits> = {
  maxRecords: 10_000,
  maxFields: 100_000,
  maxCells: 100_000,
  maxStringBytes: 2 * 1024 * 1024,
  maxArchiveEntries: 4096,
  maxExpandedBytes: 128 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  maxElapsedMs: 10_000,
  maxMemoryMb: 128
};

export function structuredLimits(provided: StructuredImportLimits = {}): Required<StructuredImportLimits> {
  const value = { ...DEFAULT_LIMITS, ...provided };
  for (const [name, limit] of Object.entries(value)) {
    if (!Number.isInteger(limit) || limit <= 0) {
      throw new ProjectStoreError("invalid-structured-limit", `${name} must be a positive integer`);
    }
  }
  return value;
}

export async function runBoundedStructuredParser<T>(task: StructuredParserTask): Promise<T> {
  const limits = structuredLimits(task.limits);
  return await new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./structured-worker-runtime.js", import.meta.url), {
      workerData: task,
      resourceLimits: {
        maxOldGenerationSizeMb: limits.maxMemoryMb,
        maxYoungGenerationSizeMb: Math.max(8, Math.min(32, Math.floor(limits.maxMemoryMb / 4))),
        codeRangeSizeMb: 16,
        stackSizeMb: 4
      }
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {return;}
      settled = true;
      void worker.terminate();
      reject(new ProjectStoreError("structured-timeout", "structured parser exceeded the configured time limit"));
    }, limits.maxElapsedMs);

    const finish = (callback: () => void): void => {
      if (settled) {return;}
      settled = true;
      clearTimeout(timer);
      callback();
      void worker.terminate();
    };

    worker.once("message", (message: { readonly ok: boolean; readonly value?: T; readonly error?: { readonly code?: string; readonly message?: string } }) => {
      finish(() => {
        if (!message.ok) {
          reject(new ProjectStoreError(message.error?.code ?? "structured-parser-failed", message.error?.message ?? "structured parser failed"));
          return;
        }
        const outputBytes = new TextEncoder().encode(JSON.stringify(message.value)).byteLength;
        if (outputBytes > limits.maxOutputBytes) {
          reject(new ProjectStoreError("structured-output-limit", "structured parser output exceeds the configured byte limit"));
          return;
        }
        resolve(message.value as T);
      });
    });
    worker.once("error", (error: Error) => finish(() => reject(new ProjectStoreError("structured-worker-failed", error.message))));
    worker.once("exit", (code) => {
      if (code !== 0) {finish(() => reject(new ProjectStoreError("structured-worker-failed", `structured parser worker exited with code ${code}`)));}
    });
  });
}
