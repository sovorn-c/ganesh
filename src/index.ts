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
} from "./project/project-types.js";
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
} from "./project/project-types.js";
export * from "./project/project-store.js";
export * from "./artifacts/artifact-store.js";
export * from "./branches/branch-store.js";
export * from "./persistence/history-store.js";
export * from "./branches/dependency-store.js";
export * from "./branches/promotion-store.js";
export * from "./branches/recovery.js";
export * from "./policy/policy-types.js";
export * from "./policy/policy-store.js";
export * from "./policy/disclosure-types.js";
export * from "./policy/disclosure-gateway.js";
export * from "./authority/capability-types.js";
export * from "./authority/capability-broker.js";
export * from "./lifecycle/lifecycle-types.js";
export * from "./lifecycle/lifecycle-gate.js";
export * from "./policy/declassification-types.js";
export * from "./policy/declassification-store.js";
export * from "./sources/source-types.js";
export * from "./sources/source-store.js";
export * from "./sources/source-intake.js";
export * from "./sources/archive-preflight.js";
export * from "./sources/parser-worker.js";
export * from "./sources/document-parser.js";
export { FULL_ACCESS_NOTICE } from "./runtime/preflight-constants.js";
export { migrateSchema, createE03Schema, createE04Schema, createE06Schema } from "./persistence/schema.js";
export * from "./decisions/decision-types.js";
export * from "./decisions/decision-store.js";
export * from "./decisions/decision-lifecycle-store.js";
export * from "./decisions/decision-history-store.js";
export * from "./decisions/commitment-types.js";
export {
  getCommitment,
  listCommitments,
  listCommitmentHistory
} from "./decisions/commitment-store.js";
export { assessReadiness, listReadiness } from "./decisions/readiness-store.js";
export type { CommitmentHistoryItem } from "./decisions/commitment-store.js";
export * from "./decisions/alternative-types.js";
export * from "./decisions/alternative-store.js";
export * from "./decisions/override-types.js";
export * from "./decisions/override-store.js";
