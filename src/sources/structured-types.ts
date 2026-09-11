// story: e06s03
import type { ArtifactAccess } from "../project/project-types.js";

export interface BibliographicSourceRecord {
  readonly id: string;
  readonly sourceVersionId: string;
  readonly format: "bibtex" | "ris";
  readonly entryKey?: string;
  readonly recordNumber: number;
  readonly rawFields: Readonly<Record<string, string>>;
  readonly normalizedIdentifiers: Readonly<Record<string, string>>;
  readonly access: ArtifactAccess;
  readonly locator: Record<string, unknown>;
}

export interface TabularValue {
  readonly sourceVersionId: string;
  readonly rawValue: string;
  readonly normalizedValue?: string | number | boolean | null;
  readonly locator: Record<string, unknown>;
  readonly formula?: string;
  readonly cachedValue?: string;
  readonly markers: readonly string[];
}

export interface TabularRegion {
  readonly sourceVersionId: string;
  readonly format: "csv" | "xlsx";
  readonly values: readonly TabularValue[];
  readonly diagnostics: readonly string[];
}

export interface StructuredImportLimits {
  readonly maxRecords?: number;
  readonly maxFields?: number;
  readonly maxCells?: number;
  readonly maxStringBytes?: number;
  readonly maxArchiveEntries?: number;
  readonly maxExpandedBytes?: number;
}
