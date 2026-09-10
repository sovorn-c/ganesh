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
export * from "./disclosure-types.js";
export * from "./disclosure-gateway.js";
export * from "./capability-types.js";
export * from "./capability-broker.js";
export * from "./lifecycle-types.js";
export * from "./lifecycle-gate.js";
export * from "./declassification-types.js";
export * from "./declassification-store.js";
export { FULL_ACCESS_NOTICE } from "./preflight-constants.js";
export { migrateSchema, createE03Schema } from "./schema.js";
