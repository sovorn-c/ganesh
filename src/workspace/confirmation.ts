import { getDecisionPacket, recordOwnerDecision } from "../decisions/decision-store.js";
import type { DecisionAction, DecisionPacket, OwnerDecisionResult } from "../decisions/decision-types.js";
import { ProjectStoreError } from "../project/project-types.js";
import type { TuiPort, WorkspaceSession } from "./workspace-types.js";

export interface ExactVersionConfirmationRequest {
  readonly packetId: string;
  readonly packetVersion?: number;
  readonly selectedCandidateVersionIds?: readonly string[];
  readonly dependencyVersionIds?: readonly string[];
  readonly action?: DecisionAction;
  readonly commandId: string;
  readonly rationale?: string;
}

export interface DisplayedConfirmation {
  readonly packetId: string;
  readonly packetVersion: number;
  readonly selectedCandidateVersionIds: readonly string[];
  readonly dependencyVersionIds: readonly string[];
  readonly text: string;
}

export interface ConfirmationResult {
  readonly status: "committed" | "rejected" | "stale" | "duplicate" | "cancelled";
  readonly displayed: DisplayedConfirmation;
  readonly decision?: OwnerDecisionResult;
  readonly refreshedPacket?: DecisionPacket;
  readonly reason: string;
}

function display(packet: DecisionPacket, request: ExactVersionConfirmationRequest): DisplayedConfirmation {
  const selectedCandidateVersionIds = [...(request.selectedCandidateVersionIds ?? packet.candidateVersionIds)];
  const dependencyVersionIds = [...(request.dependencyVersionIds ?? packet.dependencyVersionIds)];
  return {
    packetId: packet.id,
    packetVersion: packet.packetVersion,
    selectedCandidateVersionIds,
    dependencyVersionIds,
    text: [
      `Packet ${packet.id} version ${packet.packetVersion}`,
      `Candidates: ${selectedCandidateVersionIds.join(", ") || "none"}`,
      `Dependencies: ${dependencyVersionIds.join(", ") || "none"}`,
      `Action: ${request.action ?? "approved"}`
    ].join("\n")
  };
}

function statusFor(result: OwnerDecisionResult): ConfirmationResult["status"] {
  if (result.status === "approved" || result.status === "rejected" || result.status === "deferred") {
    return result.status === "approved" ? "committed" : "rejected";
  }
  return result.status;
}

export async function confirmExactVersion(
  session: WorkspaceSession,
  request: ExactVersionConfirmationRequest,
  tui: Pick<TuiPort, "confirm">
): Promise<ConfirmationResult> {
  const packet = getDecisionPacket(session.handle, request.packetId);
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${request.packetId} was not found`);
  }
  const displayed = display(packet, request);
  const confirmed = await tui.confirm("Confirm exact decision versions", displayed.text);
  if (!confirmed) {
    return { status: "cancelled", displayed, reason: "owner cancelled the exact-version confirmation" };
  }
  const decision = recordOwnerDecision(session.handle, {
    packetId: displayed.packetId,
    packetVersion: request.packetVersion ?? displayed.packetVersion,
    action: request.action ?? "approved",
    selectedCandidateVersionIds: displayed.selectedCandidateVersionIds,
    dependencyVersionIds: displayed.dependencyVersionIds,
    commandId: request.commandId,
    rationale: request.rationale,
    capability: session.ownerCapability
  });
  const refreshedPacket = decision.status === "stale" ? getDecisionPacket(session.handle, packet.id) ?? undefined : undefined;
  return {
    status: statusFor(decision),
    displayed,
    decision,
    ...(refreshedPacket === undefined ? {} : { refreshedPacket }),
    reason: decision.reason
  };
}
