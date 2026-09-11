import type { ArtifactAccess, ProjectHandle } from "../project/project-types.js";

export type SourceFormat = "text" | "markdown" | "pdf" | "docx" | "bibtex" | "ris" | "csv" | "xlsx";
export type SourceExtractionStatus = "complete" | "partial" | "unsupported" | "failed" | "pending";
export type SourceImportStatus = "pending" | "complete" | "failed";
export type SourceDiagnosticSeverity = "info" | "warning" | "error";

export interface SourceImportLimits {
  readonly maxBytes?: number;
  readonly maxDiagnosticCount?: number;
  readonly maxDiagnosticDetailLength?: number;
}

export interface SourceImportRequest {
  readonly commandId: string;
  readonly path: string;
  readonly logicalId: string;
  readonly version: string;
  readonly format: SourceFormat;
  readonly mediaType: string;
  readonly originalName?: string;
  readonly access?: ArtifactAccess;
  readonly limits?: SourceImportLimits;
}

export interface SourceVersionRecord {
  readonly artifactVersionId: string;
  readonly format: SourceFormat;
  readonly mediaType: string;
  readonly originalName: string;
  readonly access: ArtifactAccess;
  readonly extractionStatus: SourceExtractionStatus;
  readonly parserName: string;
  readonly parserVersion: string;
  readonly createdAt: string;
}

export interface SourceImportOperation {
  readonly commandId: string;
  readonly payloadHash: string;
  readonly artifactVersionId: string;
  readonly status: SourceImportStatus;
  readonly errorCode?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceLocator {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly kind: "line" | "heading" | "page" | "paragraph" | "table-cell" | "entry" | "field" | "record" | "cell";
  readonly algorithm: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly lineNumber?: number;
  readonly headingPath?: readonly string[];
  readonly occurrence?: number;
  readonly pageNumber?: number;
  readonly itemOrdinal?: number;
  readonly paragraphNumber?: number;
  readonly tableNumber?: number;
  readonly rowNumber?: number;
  readonly cellNumber?: number;
  readonly recordNumber?: number;
  readonly columnNumber?: number;
  readonly rawHeader?: string;
  readonly sheetName?: string;
  readonly cellAddress?: string;
  readonly entryKey?: string;
  readonly fieldName?: string;
  readonly tag?: string;
  readonly tagOccurrence?: number;
  readonly rawValue?: string;
}

export interface ExtractionDiagnostic {
  readonly id: string;
  readonly artifactVersionId?: string;
  readonly operationId?: string;
  readonly code: string;
  readonly severity: SourceDiagnosticSeverity;
  readonly detail: string;
  readonly count: number;
}

export interface SourceImportResult {
  readonly status: SourceImportStatus;
  readonly operation: SourceImportOperation;
  readonly source: SourceVersionRecord;
  readonly artifactVersionId: string;
  readonly diagnostics: readonly ExtractionDiagnostic[];
}

export interface LocatedSourceSegment {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly derivedVersionId: string;
  readonly locator: SourceLocator;
  readonly text: string;
}

export interface SourceExtractionRecord {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly derivedVersionId?: string;
  readonly status: SourceExtractionStatus;
  readonly extractor: string;
  readonly extractorVersion: string;
  readonly locatorAlgorithm: string;
  readonly createdAt: string;
}

export interface ExternalExtractionRequest {
  readonly sourceVersionId: string;
  readonly content: string | Uint8Array;
  readonly tool: string;
  readonly version: string;
  readonly actor: string;
  readonly commandId: string;
  readonly acquiredAt?: string;
}

export type SourceHandle = ProjectHandle;
