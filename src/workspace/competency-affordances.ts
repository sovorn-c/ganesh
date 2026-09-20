// story: e19s03

import { loadCompetencyInventory } from "../qualification/competency-inventory.js";
import type { CompetencyItem, CompetencyProvenanceRequirement } from "../qualification/qualification-types.js";
import type { WorkspaceSession } from "./workspace-types.js";

export const EXECUTABLE_COMPETENCY_IDS = ["comp-01", "comp-02", "comp-05", "comp-08", "comp-22"] as const;
type ExecutableCompetencyId = (typeof EXECUTABLE_COMPETENCY_IDS)[number];

const BACKING_STORES: Readonly<Record<ExecutableCompetencyId, string>> = {
  "comp-01": "methodology/orientation-store",
  "comp-02": "literature/literature-store",
  "comp-05": "literature/screening-store",
  "comp-08": "evidence/appraisal",
  "comp-22": "writing/cycle-store"
};

export interface CompetencyAffordanceContext {
  readonly competence?: "supported" | "outside-competence";
  readonly contextId?: string;
  readonly providedInputs?: readonly string[];
}

export interface CompetencyAffordanceView {
  readonly competencyId: string;
  readonly name: string;
  readonly status: "executable" | "metadata-only";
  readonly implemented: boolean;
  readonly backingStore?: string;
  readonly provenance: CompetencyProvenanceRequirement;
  readonly uncertainty: string;
  readonly unsupportedContexts: readonly string[];
  readonly escalation?: string;
  readonly text: string;
}

function itemFor(_session: WorkspaceSession, competencyId: string): CompetencyItem {
  const item = loadCompetencyInventory(process.cwd()).competencies.find((candidate) => candidate.id === competencyId);
  if (!item) {throw new Error(`competency not found: ${competencyId}`);}
  return item;
}

export function presentCompetencyAffordance(
  session: WorkspaceSession,
  competencyId: string,
  context: CompetencyAffordanceContext = {}
): CompetencyAffordanceView {
  const item = itemFor(session, competencyId);
  const selected = (EXECUTABLE_COMPETENCY_IDS as readonly string[]).includes(competencyId);
  const provenance = item.outputProvenance ?? {};
  const provided = new Set(context.providedInputs ?? []);
  const missing = item.requiredInputs.filter((input) => !provided.has(input));
  const escalation = context.competence === "outside-competence"
    ? `Human escalation required: context '${context.contextId ?? "unspecified"}' is outside competence.`
    : missing.length > 0
      ? `Human escalation required before execution: missing required inputs ${missing.join(", ")}.`
      : undefined;
  const view: CompetencyAffordanceView = {
    competencyId,
    name: item.name,
    status: selected ? "executable" : "metadata-only",
    implemented: selected,
    ...(selected ? { backingStore: BACKING_STORES[competencyId as ExecutableCompetencyId] } : {}),
    provenance,
    uncertainty: selected
      ? "This is a bounded store-backed affordance; it does not establish scholarly validity or certification."
      : "Catalog metadata does not establish a runtime implementation.",
    unsupportedContexts: item.unsupportedContexts,
    ...(escalation === undefined ? {} : { escalation }),
    text: [
      `${item.id}: ${item.name}`,
      `Status: ${selected ? "executable" : "metadata-only"}`,
      ...(selected ? [`Backing store: ${BACKING_STORES[competencyId as ExecutableCompetencyId]}`] : []),
      `Provenance: ${JSON.stringify(provenance)}`,
      `Uncertainty: ${selected ? "bounded store-backed affordance; no certification inferred" : "catalog metadata only"}`,
      `Unsupported contexts: ${item.unsupportedContexts.join("; ")}`,
      ...(escalation === undefined ? [] : [escalation])
    ].join("\n")
  };
  return view;
}
