// story: e04s02

import { getBranch } from "./branch-store.js";
import { assertWritable } from "./project-store.js";
import { ProjectStoreError, type ProjectHandle } from "./project-types.js";
import { transaction } from "./schema.js";
import { assertIdentifier } from "./storage-utils.js";
import { commandHash, id, now, requireOwner, text } from "./e04-utils.js";
import { setCommitmentStatus } from "./commitment-store.js";
import { getDecisionPacket } from "./decision-store.js";
import type { DecisionLifecycleRequest, DecisionLifecycleResult } from "./decision-types.js";

function requirePacket(handle: ProjectHandle, packetId: string) {
  const packet = getDecisionPacket(handle, packetId);
  if (packet === null) {
    throw new ProjectStoreError("packet-not-found", `decision packet ${packetId} was not found`);
  }
  return packet;
}

function lifecycle(
  handle: ProjectHandle,
  request: DecisionLifecycleRequest,
  eventType: "reopened" | "archived" | "superseded",
  status: "open" | "archived" | "superseded",
  replacementPacketId?: string
): DecisionLifecycleResult {
  assertWritable(handle);
  assertIdentifier(request.packetId, "packetId");
  assertIdentifier(request.commandId, "commandId");
  requireOwner(handle, request.capability ?? request.ownerCapability, request.actor);
  const packet = requirePacket(handle, request.packetId);
  const currentBranch = getBranch(handle, packet.branchId);
  if (eventType === "reopened" && currentBranch.revision !== packet.branchRevision) {
    return { status: "rejected", packetId: packet.id, reason: "deferred packet references a stale branch revision" };
  }
  if (eventType === "reopened") {
    const latest = handle.db.prepare("SELECT disposition FROM decision_records WHERE packet_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(packet.id) as { disposition?: unknown } | undefined;
    if (latest?.disposition !== "deferred") {
      return { status: "rejected", packetId: packet.id, reason: "only a deferred decision can be reopened" };
    }
  }
  if (request.expectedPacketVersion !== undefined && request.expectedPacketVersion !== packet.packetVersion) {
    return { status: "rejected", packetId: packet.id, reason: "packet version is stale" };
  }
  if (replacementPacketId !== undefined) {
    const replacement = requirePacket(handle, replacementPacketId);
    if (replacement.parentPacketId !== packet.id) {
      return { status: "rejected", packetId: packet.id, reason: "replacement packet is not a revision of the superseded packet" };
    }
  }
  const hash = commandHash({ packetId: packet.id, eventType, status, replacementPacketId: replacementPacketId ?? null, reason: request.reason ?? "" });
  return transaction(handle.db, () => {
    const existing = handle.db.prepare("SELECT payload_hash FROM decision_events WHERE command_id = ?").get(request.commandId) as { payload_hash?: unknown } | undefined;
    if (existing !== undefined) {
      if (text(existing.payload_hash, "lifecycle payload hash") !== hash) {
        return { status: "rejected", packetId: packet.id, reason: "command ID was reused with a different lifecycle payload" };
      }
      return { status: "duplicate", packetId: packet.id, reason: "lifecycle command was already applied" };
    }
    handle.db.prepare("UPDATE decision_packets SET status = ? WHERE id = ?").run(status, packet.id);
    handle.db.prepare(
      "INSERT INTO decision_events (id, packet_id, event_type, reason, command_id, actor, payload_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id("packet-event"), packet.id, eventType, request.reason ?? `packet ${eventType}`, request.commandId, handle.project.ownerId, hash, now());
    if (eventType === "archived" || eventType === "superseded") {
      const approved = handle.db.prepare("SELECT commitment_id FROM decision_records WHERE packet_id = ? AND commitment_id IS NOT NULL ORDER BY created_at DESC LIMIT 1").get(packet.id) as { commitment_id?: unknown } | undefined;
      if (typeof approved?.commitment_id === "string") {
        setCommitmentStatus(handle, approved.commitment_id, eventType, eventType, request.reason ?? `packet ${eventType}`, `commitment-${request.commandId}`, handle.project.ownerId);
      }
    }
    return {
      status: eventType,
      packetId: packet.id,
      ...(replacementPacketId === undefined ? {} : { replacementPacketId }),
      reason: `packet ${eventType}`
    };
  });
}

export function reopenDecision(handle: ProjectHandle, request: DecisionLifecycleRequest): DecisionLifecycleResult {
  return lifecycle(handle, request, "reopened", "open");
}

export function archiveDecision(handle: ProjectHandle, request: DecisionLifecycleRequest): DecisionLifecycleResult {
  return lifecycle(handle, request, "archived", "archived");
}

export function supersedeDecision(handle: ProjectHandle, request: DecisionLifecycleRequest & { readonly replacementPacketId: string }): DecisionLifecycleResult {
  return lifecycle(handle, request, "superseded", "superseded", request.replacementPacketId);
}
