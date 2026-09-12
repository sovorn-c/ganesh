import type { LiteratureRetrievalAdapter, RetrievalReport } from "./literature-types.js";

/** Socket-free default: callers must inject any provider integration explicitly. */
export class LocalRecordingAdapter implements LiteratureRetrievalAdapter {
  readonly report?: RetrievalReport;
  constructor(report?: RetrievalReport) { this.report = report; }
  retrieve(): RetrievalReport {
    return this.report ?? { status: "failed", errorCode: "adapter-network-disabled", coverageLimits: [{ kind: "adapter-network-disabled", reason: "no live retrieval adapter is configured" }] };
  }
}
