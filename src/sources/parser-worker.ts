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

export function parserLimits(provided: ParserLimits = {}): Required<ParserLimits> {
  return { ...DEFAULT_PARSER_LIMITS, ...provided };
}

export async function runBoundedParser<T>(
  inputBytes: number,
  limits: ParserLimits,
  work: () => Promise<T>
): Promise<T> {
  const effective = parserLimits(limits);
  if (inputBytes > effective.maxInputBytes) {
    throw new ProjectStoreError("parser-input-limit", "parser input exceeds the configured byte limit");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProjectStoreError("parser-timeout", "parser exceeded the configured time limit")), effective.maxElapsedMs);
    });
    return await Promise.race([work(), timeout]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
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
