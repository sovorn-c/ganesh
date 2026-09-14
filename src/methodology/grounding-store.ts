// story: e09s02
import type { ProjectHandle } from "../project/project-types.js";
import type {
  ConstructRecord,
  FrameworkRecord,
  PositionalityRecord,
  ConceptualGroundingInspection,
  ViewAttribution,
  MethodologyOrigin
} from "./methodology-types.js";
import {
  assertMethodologySchema,
  assertMethodologyAccess
} from "./methodology-utils.js";
import { inspectOrientation } from "./framing-store.js";

export { recordConstruct, recordTheoreticalFramework } from "./grounding-construct-store.js";
export { recordPositionality } from "./positionality-store.js";

export function inspectConceptualGrounding(
  handle: ProjectHandle,
  capability: unknown,
  orientationId: string
): ConceptualGroundingInspection {
  handle.assertCurrent();
  assertMethodologySchema(handle);
  assertMethodologyAccess(handle, capability, "methodology:inspect");

  inspectOrientation(handle, capability, orientationId);

  // Find all RQ ids belonging to this orientation
  const rqRows = handle.db
    .prepare("SELECT id, artifact_version_id FROM research_questions WHERE orientation_id = ?")
    .all(orientationId) as Array<{ id: string; artifact_version_id: string }>;

  const rqIds = new Set<string>();
  for (const rq of rqRows) {
    rqIds.add(rq.id);
    rqIds.add(rq.artifact_version_id);
  }

  // Read constructs
  const constructRows = handle.db
    .prepare("SELECT * FROM constructs ORDER BY created_at ASC, rowid ASC")
    .all() as Array<Record<string, unknown>>;

  const constructs: ConstructRecord[] = [];
  for (const row of constructRows) {
    const ids = JSON.parse(String(row.rq_version_ids)) as string[];
    if (rqIds.size > 0 && ids.some((id) => rqIds.has(id))) {
      constructs.push({
        id: String(row.id),
        name: String(row.name),
        definition: String(row.definition),
        rqVersionIds: ids,
        attribution: String(row.attribution) as ViewAttribution,
        origin: String(row.origin) as MethodologyOrigin,
        artifactVersionId: String(row.artifact_version_id),
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      });
    }
  }

  // Read frameworks
  const frameworkRows = handle.db
    .prepare("SELECT * FROM theoretical_frameworks ORDER BY created_at ASC, rowid ASC")
    .all() as Array<Record<string, unknown>>;

  const frameworks: FrameworkRecord[] = [];
  for (const row of frameworkRows) {
    const ids = JSON.parse(String(row.rq_version_ids)) as string[];
    if (rqIds.size > 0 && ids.some((id) => rqIds.has(id))) {
      frameworks.push({
        id: String(row.id),
        name: String(row.name),
        description: String(row.description),
        constructRelations: JSON.parse(String(row.construct_relations)),
        rqVersionIds: ids,
        attribution: String(row.attribution) as ViewAttribution,
        origin: String(row.origin) as MethodologyOrigin,
        artifactVersionId: String(row.artifact_version_id),
        commandId: String(row.command_id),
        createdAt: String(row.created_at)
      });
    }
  }

  // Read positionality with deterministic rowid tie-break for same-millisecond records
  const posRow = handle.db
    .prepare("SELECT * FROM positionality_records WHERE orientation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1")
    .get(orientationId) as Record<string, unknown> | undefined;

  let positionality: PositionalityRecord | undefined;
  let philosophicalStance = "";
  let attribution: ViewAttribution = "unknown";

  if (posRow) {
    positionality = {
      id: String(posRow.id),
      orientationId: String(posRow.orientation_id),
      philosophicalStance: String(posRow.philosophical_stance),
      situatedStance: String(posRow.situated_stance),
      attribution: String(posRow.attribution) as ViewAttribution,
      origin: String(posRow.origin) as MethodologyOrigin,
      commandId: String(posRow.command_id),
      createdAt: String(posRow.created_at)
    };
    philosophicalStance = positionality.philosophicalStance;
    attribution = positionality.attribution;
  }

  return {
    orientationId,
    constructs,
    frameworks,
    positionality,
    philosophicalStance,
    attribution
  };
}
