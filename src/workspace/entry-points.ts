// story: e19s02

import { ProjectStoreError } from "../project/project-types.js";
import { isOwnerCapability } from "../authority/capability-broker.js";
import { recordOrientation, listOrientations } from "../methodology/orientation-store.js";
import { recordLandscapeMap, listLandscapeMaps } from "../literature/literature-store.js";
import { recordScreeningDecision, listScreeningDecisions } from "../literature/screening-store.js";
import { listAppraisals, recordAppraisal } from "../evidence/appraisal.js";
import { listReviewCycles, openReviewCycle } from "../writing/cycle-store.js";
import { inspectWork } from "../work/work-runtime.js";
import { queueRoleRun } from "../work/specialist-coordination.js";
import type { SpecialistRole } from "../work/work-types.js";
import type { WorkspaceSession } from "./workspace-types.js";
import { presentExecutionModeGuidance } from "./execution-mode-guidance.js";

export const RESEARCH_ENTRY_COMMANDS = [
  "ganesh-orient",
  "ganesh-landscape",
  "ganesh-screen",
  "ganesh-appraise",
  "ganesh-review",
  "ganesh-specialist"
] as const;

export type ResearchEntryKind = "orient" | "landscape" | "screen" | "appraise" | "review" | "specialist";

export interface EntryView {
  readonly kind: ResearchEntryKind;
  readonly status: "inspected" | "recorded" | "queued";
  readonly record?: unknown;
  readonly text: string;
}

function argsObject(args: string): Record<string, unknown> {
  const input = args.trim();
  if (input === "") {return {};}
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ProjectStoreError("invalid-argument", "research entry arguments must be a JSON object");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new ProjectStoreError("invalid-argument", "research entry arguments must be a JSON object");
  }
  return parsed as Record<string, unknown>;
}

function has(args: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => typeof args[key] === "string" && String(args[key]).trim() !== "");
}

function ensureOwnerMutation(capability: unknown): void {
  if (!isOwnerCapability(capability)) {
    throw new ProjectStoreError("forbidden", "workspace research entry writes require owner capability");
  }
}

function view(kind: ResearchEntryKind, status: EntryView["status"], record: unknown): EntryView {
  return { kind, status, record, text: `${kind} ${status}\n${JSON.stringify(record)}` };
}

export function presentResearchEntry(
  session: WorkspaceSession,
  kind: ResearchEntryKind,
  args = "",
  capability: unknown = session.ownerCapability
): EntryView {
  const input = argsObject(args);
  switch (kind) {
    case "orient":
      if (has(input, "topic", "discipline", "immediateGoal", "commandId")) {
        ensureOwnerMutation(capability);
        return view(kind, "recorded", recordOrientation(session.handle, capability, input as never));
      }
      if (has(input, "topic", "discipline", "immediateGoal")) {
        throw new ProjectStoreError("invalid-argument", "orientation writes require commandId for idempotent retries");
      }
      return view(kind, "inspected", listOrientations(session.handle, capability));
    case "landscape":
      if (has(input, "protocolVersionId", "description")) {
        ensureOwnerMutation(capability);
        return view(kind, "recorded", recordLandscapeMap(session.handle, capability, input as never));
      }
      return view(kind, "inspected", listLandscapeMaps(session.handle, capability));
    case "screen":
      if (has(input, "corpusRecordId", "protocolVersionId", "criterionId", "decision", "reason")) {
        ensureOwnerMutation(capability);
        return view(kind, "recorded", recordScreeningDecision(session.handle, capability, input as never));
      }
      return view(kind, "inspected", listScreeningDecisions(session.handle, capability));
    case "appraise":
      if (has(input, "sourceVersionId", "commandId")) {
        ensureOwnerMutation(capability);
        return view(kind, "recorded", recordAppraisal(session.handle, capability, input as never));
      }
      return view(kind, "inspected", listAppraisals(session.handle, capability));
    case "review":
      if (has(input, "draftId", "commandId")) {
        ensureOwnerMutation(capability);
        return view(kind, "recorded", openReviewCycle(session.handle, capability, input as never));
      }
      return view(kind, "inspected", listReviewCycles(session.handle, capability));
    case "specialist": {
      const result = has(input, "contractId", "commandId", "role")
        ? (() => {
            ensureOwnerMutation(capability);
            return view(kind, "queued", queueRoleRun(session.handle, capability, input as never));
          })()
        : view(kind, "inspected", inspectWork(session.handle, typeof input.id === "string" ? input.id : ""));
      const mode = presentExecutionModeGuidance();
      return { ...result, text: `${mode.text}\n${result.text}` };
    }
  }
}
