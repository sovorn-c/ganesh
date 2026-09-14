// story: e09s04
export const METHOD_PROFILES = [
  "quantitative",
  "qualitative",
  "mixed-methods",
  "artifact-evaluation-design-science"
] as const;

export type MethodProfileId = (typeof METHOD_PROFILES)[number];

export const SUPPORTED_CONTEXTS = [
  "empirical-social-science",
  "information-systems",
  "hci",
  "education",
  "computing"
] as const;

export type SupportedContextId = (typeof SUPPORTED_CONTEXTS)[number];

export type ProfileFitStatus =
  | "applicable"
  | "incomplete"
  | "implementation-not-contribution"
  | "fail"
  | "outside-competence";

export type ContextCompetence = "supported" | "outside-competence";

export interface MethodProfileDetails {
  readonly approach?: string;
  readonly interCoderAgreement?: string;
  readonly statisticalPower?: string;
  readonly estimandNotes?: string;
  readonly independentObservations?: boolean;
  readonly integrationRationale?: string;
  readonly evaluationPlan?: string;
  readonly [key: string]: unknown;
}

export interface MethodProfileBinding {
  readonly id: string;
  readonly comparisonId: string;
  readonly profileId: MethodProfileId;
  readonly contextId: string;
  readonly details: MethodProfileDetails;
  readonly competence: ContextCompetence;
  readonly profileFit: ProfileFitStatus;
  readonly createdAt: string;
}

export interface MethodProfileBindingRequest {
  readonly comparisonId: string;
  readonly profileId: MethodProfileId;
  readonly contextId: string;
  readonly details?: MethodProfileDetails;
}

export interface ProfileFitInspection {
  readonly comparisonId: string;
  readonly binding: MethodProfileBinding;
  readonly profileId: MethodProfileId;
  readonly contextId: string;
  readonly competence: ContextCompetence;
  readonly profileFit: ProfileFitStatus;
  readonly rationales: readonly string[];
}

export interface MethodProfileDescriptor {
  readonly id: MethodProfileId;
  readonly name: string;
  readonly description: string;
  readonly supportedContexts: readonly string[];
}
