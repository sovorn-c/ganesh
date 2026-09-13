// story: e16s01
import type { PreflightReport } from "../runtime/preflight-types.js";

export type DiagnosticSeverity = "info" | "warning" | "error";

export interface DiagnosticEvent {
  readonly id: string;
  readonly correlationId: string;
  readonly commandId?: string;
  readonly runId?: string;
  readonly kind: string;
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly createdAt: string;
}

export interface DiagnosticInput {
  readonly correlationId: string;
  readonly commandId?: string;
  readonly runId?: string;
  readonly kind: string;
  readonly code: string;
  readonly severity?: DiagnosticSeverity;
  readonly message: string;
}

export interface DiagnosticQuery {
  readonly correlationId?: string;
  readonly runId?: string;
  readonly commandId?: string;
  readonly limit?: number;
}

export interface OperationalHealthReport extends PreflightReport {
  readonly projectLock?: {
    readonly locked: boolean;
    readonly pid?: number;
  };
}

export interface DiagnosticBundleFileEntry {
  readonly relativePath: string;
  readonly sha256: string;
  readonly bytes: number;
}

export interface DiagnosticBundleManifest {
  readonly schemaVersion: number;
  readonly kind: "diagnostic";
  readonly exportId: string;
  readonly commandId: string;
  readonly destination: string;
  readonly purpose: string;
  readonly correlationId?: string;
  readonly limit?: number;
  readonly createdAt: string;
  readonly files: readonly DiagnosticBundleFileEntry[];
  readonly omissions?: readonly string[];
}

export interface DiagnosticBundle {
  readonly manifest: DiagnosticBundleManifest;
  readonly bundlePath: string;
  readonly operationId: string;
}

export interface DiagnosticBundleHashResult {
  readonly relativePath: string;
  readonly expected: string;
  readonly actual: string | null;
  readonly match: boolean;
}

export interface DiagnosticBundleInspection {
  readonly manifest: DiagnosticBundleManifest;
  readonly hashResults: readonly DiagnosticBundleHashResult[];
  readonly valid: boolean;
  readonly eventCount: number;
}

export interface DiagnosticExportRequest {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly destinationPath: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly correlationId?: string;
  readonly limit?: number;
  readonly optIn?: boolean;
  readonly payload?: unknown;
}

export interface DiagnosticPurgeRequest {
  readonly commandId: string;
  readonly olderThan?: string;
  readonly correlationId?: string;
  readonly runId?: string;
  readonly payloadHash?: string;
}

export interface DiagnosticPurgeResult {
  readonly commandId: string;
  readonly deletedCount: number;
  readonly remainingCount: number;
  readonly recalled: false;
}

export interface RunbookSummary {
  readonly id: string;
  readonly title: string;
  readonly path: string;
  readonly content: string;
}
