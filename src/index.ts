// story: e01s01
export interface RuntimeBaseline {
  readonly name: string;
  readonly version: string;
}

export const runtimeBaseline: RuntimeBaseline = {
  name: "ganesh",
  version: "0.1.0"
};

export {
  ProjectStoreError,
  PROJECT_SCHEMA_VERSION
} from "./project-types.js";
export type {
  ArtifactAccess,
  ArtifactInspection,
  ArtifactVersionInput,
  ArtifactVersionRecord,
  BranchInput,
  BranchMutationRequest,
  BranchMutationResult,
  BranchRecord,
  BranchReference,
  ContentStatus,
  DependencyInput,
  DependencyReference,
  HistoryRecord,
  ImpactRecord,
  PromotionRequest,
  PromotionResult,
  ProjectInput,
  ProjectRecord,
  ProjectStatus,
  RecoveryResult,
  SchemaStatus,
  SharedSourceCorrectionInput,
  SnapshotInspection
} from "./project-types.js";
export * from "./project-store.js";
export * from "./artifact-store.js";
export * from "./branch-store.js";
export * from "./history-store.js";
export * from "./dependency-store.js";
export * from "./promotion-store.js";
export * from "./recovery.js";
export * from "./policy-types.js";
export * from "./policy-store.js";
export { migrateSchema, createE03Schema } from "./schema.js";
