// story: e11s01, e11s02, e11s03, e11s04, e11s05
import type { BashGuardConfig } from "../authority/capability-types.js";
import type { ExecutionMode } from "../runtime/preflight-types.js";
import type { ResearchActivity } from "../ethics/ethics-types.js";

export interface AnalysisExecutionPolicy {
  readonly projectId: string;
  readonly mode: ExecutionMode;
  readonly bashGuard: BashGuardConfig;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisExecutionPolicyRequest {
  readonly mode: ExecutionMode;
  readonly bashGuard?: BashGuardConfig;
  readonly bashGuardConfig?: BashGuardConfig;
  readonly commandId?: string;
}

export interface LocalCommandRequest {
  readonly argv: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly confirmationId?: string;
  readonly confirmation?: CommandConfirmation | string;
  readonly runner?: AnalysisProcessRunner;
  readonly commandId?: string;
}

export interface CommandConfirmationRequest {
  readonly argv: readonly string[];
  readonly argvDigest?: string;
  readonly commandId?: string;
}

export interface CommandConfirmation {
  readonly id: string;
  readonly commandId: string;
  readonly argvDigest: string;
  readonly argv: readonly string[];
  readonly mode: ExecutionMode;
  readonly createdAt: string;
}

export interface AnalysisProcessOptions {
  readonly cwd: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly shell: false;
  readonly signal?: AbortSignal;
}

export interface AnalysisProcessResult {
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  readonly cancelled?: boolean;
}

export type AnalysisProcessRunner = (
  argv: readonly string[],
  options: AnalysisProcessOptions
) => AnalysisProcessResult;

export interface LocalCommandRunRecord {
  readonly id: string;
  readonly commandId: string;
  readonly argv: readonly string[];
  readonly argvDigest: string;
  readonly cwd: string;
  readonly mode: ExecutionMode;
  readonly status: "succeeded" | "failed" | "cancelled" | "quarantined";
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly stdout: string;
  readonly stderr: string;
  readonly notice?: string;
  readonly startedAt: string;
  readonly endedAt: string;
}

export type AnalysisRunStatus = LocalCommandRunRecord["status"];
export type AnalysisRepeatability = "reported";
export type AnalysisOrigin = "owner-recorded" | "specialist-proposed";
export type AnalysisAttribution = "human-stated" | "agent-inferred" | "unknown";

export interface AnalysisRunRequest extends LocalCommandRequest {
  readonly inputVersionIds?: readonly string[];
  readonly scriptVersionId?: string;
  readonly scriptArtifactVersionId?: string;
  readonly commandOrScriptVersion?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly environment?: Readonly<Record<string, unknown>>;
  readonly diagnostics?: Readonly<Record<string, unknown>>;
  readonly analysisPlanId?: string;
  readonly protocolVersionId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataClasses?: readonly string[];
  readonly dataUse?: string;
  readonly destination?: string;
  readonly purpose?: string;
  readonly conditions?: unknown;
  readonly profileId?: string;
  readonly confirmatoryOrExploratory?: "confirmatory" | "exploratory";
  readonly reproduced?: boolean;
  readonly externalOutputId?: string;
  readonly attribution?: AnalysisAttribution;
  readonly origin?: AnalysisOrigin;
}

export interface AnalysisRunRecord {
  readonly id: string;
  readonly commandId: string;
  readonly inputVersionIds: readonly string[];
  readonly argv: readonly string[];
  readonly argvDigest: string;
  readonly cwd: string;
  readonly scriptVersionId?: string;
  readonly commandOrScriptVersion?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly stdoutArtifactId?: string;
  readonly stderrArtifactId?: string;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly diagnostics: Readonly<Record<string, unknown>>;
  readonly environment: Readonly<Record<string, unknown>>;
  readonly mode: ExecutionMode;
  readonly status: AnalysisRunStatus;
  readonly exitCode: number | null;
  readonly signal?: string;
  readonly repeatability: AnalysisRepeatability;
  readonly reproduced: boolean;
  readonly analysisPlanId?: string;
  readonly protocolVersionId?: string;
  readonly activity?: ResearchActivity;
  readonly population?: string;
  readonly dataClasses: readonly string[];
  readonly dataUse?: string;
  readonly profileId?: string;
  readonly confirmatoryOrExploratory?: "confirmatory" | "exploratory";
  readonly externalOutputId?: string;
  readonly attribution: AnalysisAttribution;
  readonly origin: AnalysisOrigin;
  readonly startedAt: string;
  readonly endedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisRunQuery {
  readonly id?: string;
  readonly commandId?: string;
  readonly externalOutputId?: string;
}

export interface AnalysisCandidateRequest {
  readonly payload: Record<string, unknown>;
  readonly scriptVersionId?: string;
  readonly inputVersionIds?: readonly string[];
  readonly commandId?: string;
}

export interface AnalysisCandidateRecord {
  readonly id: string;
  readonly payload: Record<string, unknown>;
  readonly inputVersionIds: readonly string[];
  readonly scriptVersionId?: string;
  readonly attribution: "agent-inferred";
  readonly origin: "specialist-proposed";
  readonly status: "proposed";
  readonly commandId: string;
  readonly createdAt: string;
}

export interface ToolProbeRequest {
  readonly tools?: readonly (string | { readonly name: string; readonly command?: string })[];
  readonly packages?: readonly string[];
  readonly availableTools?: Readonly<Record<string, boolean>>;
  readonly availablePackages?: Readonly<Record<string, boolean>>;
  readonly commandId?: string;
}

export interface ToolProbeResult {
  readonly name: string;
  readonly kind: "tool" | "package";
  readonly available: boolean;
  readonly code?: "tool-missing" | "package-missing";
  readonly remediation?: string;
}

export interface ToolProbeReport {
  readonly id: string;
  readonly tools: readonly ToolProbeResult[];
  readonly packages: readonly ToolProbeResult[];
  readonly missingTools: readonly string[];
  readonly missingPackages: readonly string[];
  readonly remediation: readonly string[];
  readonly commandId: string;
  readonly createdAt: string;
}

export interface InstallAnalysisPackageRequest extends LocalCommandRequest {
  readonly packageName?: string;
}

export interface AnalysisDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly severity?: "info" | "warning" | "limit";
}

export type AnalysisDiagnosticStatus =
  | "recorded"
  | "incomplete"
  | "implementation-not-contribution"
  | "needs-review";

export interface AnalysisDiagnosticRequest {
  readonly runId: string;
  readonly profileId?: string;
  readonly profileDetails?: Readonly<Record<string, unknown>>;
  readonly integrationRationale?: string;
  readonly evaluationPlan?: string;
  readonly diagnostics?: readonly AnalysisDiagnostic[];
  readonly limitations?: readonly AnalysisDiagnostic[];
  readonly designLabel?: string;
  readonly evidenceType?: "associational" | "cross-sectional" | "experimental" | "quasi-experimental";
  readonly claimType?: "causal" | "associational" | "descriptive" | "exploratory";
  readonly identificationStrategy?: string;
  readonly confirmatoryOrExploratory?: "confirmatory" | "exploratory";
  readonly commandId?: string;
}

export interface AnalysisDiagnosticRecord {
  readonly id: string;
  readonly runId: string;
  readonly profileId?: string;
  readonly status: AnalysisDiagnosticStatus;
  readonly diagnostics: readonly AnalysisDiagnostic[];
  readonly limitations: readonly AnalysisDiagnostic[];
  readonly limitationCodes: readonly string[];
  readonly designLabel?: string;
  readonly evidenceType?: string;
  readonly claimType?: string;
  readonly identificationStrategy?: string;
  readonly attribution: AnalysisAttribution;
  readonly origin: AnalysisOrigin;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AnalysisDiagnosticQuery {
  readonly runId?: string;
}

export interface ExternalAnalysisOutputRequest {
  readonly artifactVersionId?: string;
  readonly outputVersionId?: string;
  readonly content?: string | Uint8Array;
  readonly logicalId?: string;
  readonly version?: string;
  readonly inputVersionIds?: readonly string[];
  readonly argvDigest?: string;
  readonly commandOrScriptVersion?: string;
  readonly parameters?: Readonly<Record<string, unknown>>;
  readonly source?: string;
  readonly notes?: string;
  readonly commandId?: string;
}

export interface ExternalAnalysisOutputRecord {
  readonly id: string;
  readonly artifactVersionId: string;
  readonly inputVersionIds: readonly string[];
  readonly argvDigest?: string;
  readonly commandOrScriptVersion?: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly authenticity: "reported";
  readonly reproduced: false;
  readonly source?: string;
  readonly notes?: string;
  readonly commandId: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface ExternalAnalysisOutputQuery {
  readonly id?: string;
}

export interface ReproduceAnalysisRunRequest {
  readonly externalOutputId: string;
  readonly runId?: string;
  readonly authenticatedRunId?: string;
  readonly reproduced?: boolean;
  readonly commandId?: string;
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly runner?: AnalysisProcessRunner;
  readonly confirmationId?: string;
}
