// story: e05s01, e05s02, e05s03, e05s04, e05s05
import type { OwnerCapability, WorkerCapability } from "../authority/capability-broker.js";
import type { ProjectHandle } from "../project/project-types.js";
import type { ResearchActivity } from "../ethics/ethics-types.js";

export type WorkStatus = "proposed" | "authorized" | "queued" | "running" | "waiting-for-human" | "blocked" | "succeeded" | "failed" | "cancelled";
export type WorkRunStatus = "queued" | "running" | "waiting-for-human" | "blocked" | "succeeded" | "failed" | "cancelled";
export type SpecialistRole = "supervisor" | "discovery" | "evidence" | "methodology" | "reviewer";
export const SPECIALIST_ROLES: readonly SpecialistRole[] = ["supervisor", "discovery", "evidence", "methodology", "reviewer"];
export type BudgetDimension = "tokens" | "calls" | "timeMs" | "spend";
export type PricingStatus = "known" | "unknown";

export interface WorkLimits {
  readonly tokens: number;
  readonly calls: number;
  readonly timeMs: number;
  readonly spend?: number;
  readonly currency?: string;
}

export interface PriceQuote {
  readonly status: PricingStatus;
  readonly amount?: number;
  readonly currency?: string;
  readonly unit?: string;
  readonly reason?: string;
}

export interface WorkContractInput {
  readonly id?: string;
  readonly contractId?: string;
  readonly version?: number;
  readonly objective: string;
  readonly scope?: Record<string, unknown>;
  readonly inputVersionIds?: readonly string[];
  readonly inputs?: readonly string[];
  readonly role?: SpecialistRole;
  readonly permittedRoles?: readonly SpecialistRole[];
  readonly limits: WorkLimits;
  readonly destination?: string;
  readonly purpose?: string;
  readonly executionMode?: string;
  readonly authorizationBasis?: string;
  readonly branchId?: string;
  readonly protocolVersionId?: string;
  readonly parentContractId?: string;
  readonly providerPrice?: PriceQuote;
}

export interface WorkContractRecord {
  readonly id: string;
  readonly version: number;
  readonly parentContractId?: string;
  readonly budgetGroupId: string;
  readonly objective: string;
  readonly scope: Record<string, unknown>;
  readonly inputVersionIds: readonly string[];
  readonly permittedRoles: readonly SpecialistRole[];
  readonly limits: WorkLimits;
  readonly destination: string;
  readonly purpose: string;
  readonly executionMode?: string;
  readonly authorizationBasis: string;
  readonly branchId?: string;
  readonly protocolVersionId?: string;
  readonly status: "proposed" | "authorized" | "superseded" | "cancelled";
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StandingPermissionInput {
  readonly id?: string;
  readonly objectivePattern?: string;
  readonly scope?: Record<string, unknown>;
  readonly role: SpecialistRole;
  readonly inputVersionIds?: readonly string[];
  readonly destination?: string;
  readonly purpose?: string;
  readonly limits: WorkLimits;
  readonly expiresAt?: string;
}

export interface StandingPermissionRecord extends StandingPermissionInput {
  readonly id: string;
  readonly ownerId: string;
  readonly status: "active" | "expired" | "revoked";
  readonly createdAt: string;
}

export interface WorkRunInput {
  readonly contractId: string;
  readonly contractVersion?: number;
  readonly commandId: string;
  readonly role?: SpecialistRole;
  readonly inputVersionIds?: readonly string[];
  readonly expectedVersionIds?: readonly string[];
  readonly destination?: string;
  readonly purpose?: string;
  readonly providerQuote?: PriceQuote;
  readonly reservation?: Partial<Record<BudgetDimension, number>>;
  readonly branchId?: string;
  readonly protocolVersionId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataClasses?: readonly string[];
  readonly dataUse?: string;
  readonly conditions?: unknown;
}

export interface DispatchOptions {
  readonly wait?: (ms: number) => Promise<void>;
  readonly minIntervalMs?: number;
  readonly correlationId?: string;
  readonly signal?: AbortSignal;
}

export interface WorkRunRecord {
  readonly id: string;
  readonly contractId: string;
  readonly contractVersion: number;
  readonly role: SpecialistRole;
  readonly commandId: string;
  readonly payloadHash: string;
  readonly operationId: string;
  readonly inputVersionIds: readonly string[];
  readonly reserved: Partial<Record<BudgetDimension, number>>;
  readonly status: WorkRunStatus;
  readonly sessionId?: string;
  readonly failureReason?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AssignedInput {
  readonly runId: string;
  readonly versionId: string;
  readonly logicalId: string;
  readonly version: string;
  readonly content?: string;
  readonly contentHash: string | null;
  readonly access: string;
}

export interface CandidateSubmission {
  readonly runId: string;
  readonly candidateId?: string;
  readonly logicalId?: string;
  readonly version?: string;
  readonly content?: string | Uint8Array;
  readonly artifactVersionId?: string;
  readonly diagnostics?: readonly WorkDiagnostic[];
  readonly sourceVersionIds?: readonly string[];
  readonly proposedName?: string;
  readonly origin?: string;
  readonly reservation?: Partial<Record<BudgetDimension, number>>;
  readonly payload?: unknown;
  readonly sessionId?: string;
}

export interface WorkDiagnostic {
  readonly code: string;
  readonly severity?: "info" | "warning" | "error";
  readonly count?: number;
}

export interface CandidateAcceptance {
  readonly status: "accepted" | "quarantined" | "rejected";
  readonly runId: string;
  readonly candidateId: string;
  readonly artifactVersionId?: string;
  readonly reason: string;
  readonly diagnostics: readonly WorkDiagnostic[];
}

export interface WorkInspection {
  readonly contract?: WorkContractRecord;
  readonly run?: WorkRunRecord;
  readonly budget?: BudgetInspection;
  readonly candidates: readonly CandidateAcceptance[];
  readonly disagreements: readonly DisagreementRecord[];
}

export interface BudgetReservation {
  readonly status: "reserved" | "rejected" | "duplicate";
  readonly contractId: string;
  readonly runId: string;
  readonly dimensions: Partial<Record<BudgetDimension, number>>;
  readonly reason?: string;
}

export interface BudgetSettlement {
  readonly status: "settled" | "held" | "rejected";
  readonly runId: string;
  readonly spent: Partial<Record<BudgetDimension, number>>;
  readonly reason?: string;
}

export interface BudgetInspection {
  readonly contractId: string;
  readonly limits: WorkLimits;
  readonly reserved: Partial<Record<BudgetDimension, number>>;
  readonly spent: Partial<Record<BudgetDimension, number>>;
  readonly remaining: Partial<Record<BudgetDimension, number>>;
  readonly uncertain: boolean;
}

export interface RoleSnapshot {
  readonly runId: string;
  readonly role: SpecialistRole;
  readonly objective: string;
  readonly inputVersionIds: readonly string[];
  readonly reviewQuestion?: string;
  readonly standards?: readonly string[];
  readonly assignedAt: string;
}

export interface DisagreementInput {
  readonly contractId: string;
  readonly question: string;
  readonly leftRole: SpecialistRole;
  readonly rightRole: SpecialistRole;
  readonly leftCandidateVersionId: string;
  readonly rightCandidateVersionId: string;
  readonly leftSourceBasis: readonly string[];
  readonly rightSourceBasis: readonly string[];
}

export interface DisagreementRecord extends DisagreementInput {
  readonly id: string;
  readonly revisionCount: number;
  readonly status: "open" | "returned-to-owner" | "resolved";
  readonly createdAt: string;
}

export interface ProviderAttempt {
  readonly id: string;
  readonly runId: string;
  readonly destination: string;
  readonly purpose: string;
  readonly attempt: number;
  readonly outcome: "ok" | "timeout" | "failure" | "denied";
  readonly pricing: PriceQuote;
  readonly sessionId?: string;
  readonly createdAt: string;
}

export interface SpecialistSessionResult {
  readonly status: "ok" | "timeout" | "failure";
  readonly sessionId?: string;
  readonly candidate?: CandidateSubmission;
  readonly usage?: Partial<Record<BudgetDimension, number>>;
  readonly errorCode?: string;
}

export interface SpecialistSessionPort {
  start?(request: { readonly run: WorkRunRecord; readonly contract: WorkContractRecord; readonly snapshot: RoleSnapshot; readonly signal?: AbortSignal; readonly deadlineAt?: number }): SpecialistSessionResult | Promise<SpecialistSessionResult>;
  prompt?(request: { readonly run: WorkRunRecord; readonly snapshot: RoleSnapshot; readonly signal?: AbortSignal; readonly deadlineAt?: number }): SpecialistSessionResult | Promise<SpecialistSessionResult>;
  cancel?(sessionId: string): void | Promise<void>;
  rebind?(): void | Promise<void>;
  submit?(submission: CandidateSubmission): CandidateSubmission;
}

export type WorkCapability = OwnerCapability | WorkerCapability;
export type WorkProject = ProjectHandle;