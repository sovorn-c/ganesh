// story: e06s02
import { Worker } from "node:worker_threads";
import { ProjectStoreError } from "../project/project-types.js";

export interface ParserLimits {
  readonly maxInputBytes?: number;
  readonly maxOutputBytes?: number;
  readonly maxSegments?: number;
  readonly maxElapsedMs?: number;
}

export const DEFAULT_PARSER_LIMITS: Required<ParserLimits> = {
  maxInputBytes: 32 * 1024 * 1024,
  maxOutputBytes: 32 * 1024 * 1024,
  maxSegments: 100_000,
  maxElapsedMs: 10_000
};

export interface DocumentParserTask {
  readonly kind: "document";
  readonly format: "pdf" | "docx";
  readonly bytes: Uint8Array;
  readonly limits: ParserLimits & {
    readonly maxArchiveEntries?: number;
    readonly maxExpandedBytes?: number;
    readonly maxCompressionRatio?: number;
  };
}

export function parserLimits(provided: ParserLimits = {}): Required<ParserLimits> {
  return { ...DEFAULT_PARSER_LIMITS, ...provided };
}

function workerMemoryLimit(limits: Required<ParserLimits>): number {
  const outputMegabytes = Math.ceil(limits.maxOutputBytes / (1024 * 1024));
  return Math.min(256, Math.max(64, outputMegabytes * 2 + 32));
}

export async function runBoundedParser<T>(
  inputBytes: number,
  limits: ParserLimits,
  task: DocumentParserTask
): Promise<T> {
  const effective = parserLimits(limits);
  if (inputBytes > effective.maxInputBytes) {
    throw new ProjectStoreError("parser-input-limit", "parser input exceeds the configured byte limit");
  }

  return await new Promise<T>((resolve, reject) => {
    const worker = new Worker(new URL("./parser-worker-runtime.js", import.meta.url), {
      workerData: task,
      resourceLimits: {
        maxOldGenerationSizeMb: workerMemoryLimit(effective),
        maxYoungGenerationSizeMb: 16,
        codeRangeSizeMb: 16,
        stackSizeMb: 4
      }
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      void worker.terminate();
      reject(new ProjectStoreError("parser-timeout", "parser exceeded the configured time limit"));
    }, effective.maxElapsedMs);

    const finish = (callback: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      callback();
      void worker.terminate();
    };

    worker.once("message", (message: { readonly ok: boolean; readonly value?: T; readonly error?: { readonly code?: string; readonly message?: string } }) => {
      finish(() => {
        if (message.ok) {
          resolve(message.value as T);
          return;
        }
        reject(new ProjectStoreError(message.error?.code ?? "parser-failed", message.error?.message ?? "document parser failed"));
      });
    });
    worker.once("error", (error: Error) => {
      finish(() => reject(new ProjectStoreError("parser-worker-failed", error.message)));
    });
    worker.once("exit", (code) => {
      if (code !== 0) {
        finish(() => reject(new ProjectStoreError("parser-worker-failed", `parser worker exited with code ${code}`)));
      }
    });
  });
}

export function assertParserOutput(outputBytes: number, segmentCount: number, limits: ParserLimits): void {
  const effective = parserLimits(limits);
  if (outputBytes > effective.maxOutputBytes) {
    throw new ProjectStoreError("parser-output-limit", "parser output exceeds the configured byte limit");
  }
  if (segmentCount > effective.maxSegments) {
    throw new ProjectStoreError("parser-segment-limit", "parser output contains too many segments");
  }
}
