// story: e09s04
import { ProjectStoreError, type ProjectHandle } from "../project/project-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess,
  allowedMethodology,
  newId,
  isoNow
} from "./methodology-utils.js";
import {
  METHOD_PROFILES,
  SUPPORTED_CONTEXTS,
  type MethodProfileId,
  type ProfileFitStatus,
  type ContextCompetence,
  type MethodProfileBinding,
  type MethodProfileBindingRequest,
  type ProfileFitInspection,
  type MethodProfileDescriptor
} from "./profile-types.js";

export { METHOD_PROFILES, SUPPORTED_CONTEXTS };

const PROFILE_DESCRIPTORS: readonly MethodProfileDescriptor[] = [
  {
    id: "quantitative",
    name: "Quantitative Empirical",
    description: "Quantitative empirical research focused on causal and associative modeling, hypothesis testing, and statistical inference.",
    supportedContexts: SUPPORTED_CONTEXTS
  },
  {
    id: "qualitative",
    name: "Qualitative Inquiry",
    description: "Qualitative research focused on contextual depth, participant meaning-making, and inductive or reflexive analysis.",
    supportedContexts: SUPPORTED_CONTEXTS
  },
  {
    id: "mixed-methods",
    name: "Mixed Methods",
    description: "Integrated quantitative and qualitative design requiring explicit integration rationale.",
    supportedContexts: SUPPORTED_CONTEXTS
  },
  {
    id: "artifact-evaluation-design-science",
    name: "Design Science & Artifact Evaluation",
    description: "Engineering and computing research developing novel artifacts evaluated against rigorous evaluation plans.",
    supportedContexts: SUPPORTED_CONTEXTS
  }
];

export function listMethodProfiles(): readonly MethodProfileDescriptor[] {
  return PROFILE_DESCRIPTORS;
}

export function bindMethodProfile(
  handle: ProjectHandle,
  capability: unknown,
  request: MethodProfileBindingRequest
): MethodProfileBinding {
  assertMethodologySchema(handle.db);
  assertMethodologyAccess(handle, capability, "methodology:design");

  if (!METHOD_PROFILES.includes(request.profileId)) {
    throw new ProjectStoreError("invalid-argument", `Unsupported method profile: ${request.profileId}`);
  }

  const comp = handle.db
    .prepare(`SELECT id FROM design_comparisons WHERE id = ?`)
    .get(request.comparisonId) as { id: string } | undefined;

  if (!comp) {
    throw new ProjectStoreError("not-found", `Design comparison not found: ${request.comparisonId}`);
  }

  const isSupportedContext = (SUPPORTED_CONTEXTS as readonly string[]).includes(request.contextId);
  const competence: ContextCompetence = isSupportedContext ? "supported" : "outside-competence";

  let fitStatus: ProfileFitStatus;
  const details = request.details ?? {};

  if (competence === "outside-competence") {
    fitStatus = "outside-competence";
  } else if (request.profileId === "mixed-methods") {
    if (!details.integrationRationale || !String(details.integrationRationale).trim()) {
      fitStatus = "incomplete";
    } else {
      fitStatus = "applicable";
    }
  } else if (request.profileId === "artifact-evaluation-design-science") {
    if (!details.evaluationPlan || !String(details.evaluationPlan).trim()) {
      fitStatus = "implementation-not-contribution";
    } else {
      fitStatus = "applicable";
    }
  } else if (request.profileId === "qualitative") {
    // AC-11: reflexive-thematic-analysis without ICR or statistical power must NOT fail solely for those
    fitStatus = "applicable";
  } else if (request.profileId === "quantitative") {
    if (details.independentObservations === false) {
      fitStatus = "fail";
    } else {
      fitStatus = "applicable";
    }
  } else {
    fitStatus = "applicable";
  }

  const rationales: string[] = [];
  if (competence === "outside-competence") {
    rationales.push(
      `Context '${request.contextId}' is outside verified system competence; supported contexts are ${SUPPORTED_CONTEXTS.join(", ")}`
    );
  }
  if (fitStatus === "incomplete") {
    rationales.push("Mixed-methods design lacks an explicit integration rationale between quantitative and qualitative components");
  }
  if (fitStatus === "implementation-not-contribution") {
    rationales.push("Artifact construction without a rigorous evaluation plan is an engineering implementation, not an empirical research contribution");
  }
  if (request.profileId === "qualitative" && details.approach === "reflexive-thematic-analysis") {
    rationales.push("Reflexive thematic analysis does not mandate inter-coder reliability or statistical power calculations");
  }

  const id = newId("mpb");
  const now = isoNow();

  handle.db
    .prepare(
      `INSERT INTO method_profile_bindings (id, comparison_id, profile_id, context_id, details, competence, profile_fit, fit_reasons, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      request.comparisonId,
      request.profileId,
      request.contextId,
      JSON.stringify(details),
      competence,
      fitStatus,
      JSON.stringify(rationales),
      now
    );

  return {
    id,
    comparisonId: request.comparisonId,
    profileId: request.profileId,
    contextId: request.contextId,
    details,
    competence,
    profileFit: fitStatus,
    createdAt: now
  };
}

export function inspectProfileFit(
  handle: ProjectHandle,
  capability: unknown,
  comparisonId: string
): ProfileFitInspection {
  assertMethodologySchema(handle.db);
  if (
    !allowedMethodology(handle, capability, "methodology:design") &&
    !allowedMethodology(handle, capability, "methodology:inspect")
  ) {
    assertMethodologyAccess(handle, capability, "methodology:inspect");
  }

  const row = handle.db
    .prepare(
      `SELECT id, comparison_id, profile_id, context_id, details, competence, profile_fit, fit_reasons, created_at
       FROM method_profile_bindings WHERE comparison_id = ? ORDER BY created_at DESC LIMIT 1`
    )
    .get(comparisonId) as
    | {
        id: string;
        comparison_id: string;
        profile_id: string;
        context_id: string;
        details: string;
        competence: string;
        profile_fit: string;
        fit_reasons: string;
        created_at: string;
      }
    | undefined;

  if (!row) {
    throw new ProjectStoreError("not-found", `No method profile binding found for comparison: ${comparisonId}`);
  }

  const details = JSON.parse(row.details);
  const binding: MethodProfileBinding = {
    id: row.id,
    comparisonId: row.comparison_id,
    profileId: row.profile_id as MethodProfileId,
    contextId: row.context_id,
    details,
    competence: row.competence as ContextCompetence,
    profileFit: row.profile_fit as ProfileFitStatus,
    createdAt: row.created_at
  };

  const rationales: string[] = row.fit_reasons ? (JSON.parse(row.fit_reasons) as string[]) : [];

  return {
    comparisonId,
    binding,
    profileId: binding.profileId,
    contextId: binding.contextId,
    competence: binding.competence,
    profileFit: binding.profileFit,
    rationales
  };
}
