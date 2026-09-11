import {
  authorizeContract,
  classifyInput,
  createOwnerCapability,
  grantDataUse,
  proposeContract
} from "../../src/index.js";
import { artifact } from "./project-fixtures.js";

export function classifiedInput(handle: Parameters<typeof classifyInput>[0]) {
  const input = artifact(handle, "assigned", "1", "assigned bytes");
  classifyInput(handle, input.id, { sensitivity: "public", basis: "test" });
  grantDataUse(handle, { inputVersion: input.id, destination: "local", purpose: "research-work", authority: "owner-test" });
  return input;
}

export function contract(
  handle: Parameters<typeof proposeContract>[0],
  owner: ReturnType<typeof createOwnerCapability>,
  inputIds: readonly string[],
  overrides: Record<string, unknown> = {}
) {
  const proposed = proposeContract(handle, owner, {
    id: `contract-${Math.random().toString(36).slice(2)}`,
    objective: "bounded research work",
    inputVersionIds: inputIds,
    permittedRoles: ["supervisor", "discovery", "evidence", "methodology", "reviewer"],
    limits: { tokens: 100, calls: 10, timeMs: 10_000, ...(overrides.limits as object ?? {}) },
    ...(overrides.scope === undefined ? {} : { scope: overrides.scope as Record<string, unknown> }),
    ...(overrides.destination === undefined ? {} : { destination: String(overrides.destination) }),
    ...(overrides.purpose === undefined ? {} : { purpose: String(overrides.purpose) })
  });
  return authorizeContract(handle, owner, { contractId: proposed.id });
}
