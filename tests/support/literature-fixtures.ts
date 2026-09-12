import {
  createOwnerCapability,
  createWorkerCapabilities,
  recordQueryVersion,
  recordReviewProtocol,
  type ProjectHandle,
  type WorkerCapability
} from "../../src/index.js";

export function literatureWorker(handle: ProjectHandle, extra: readonly string[] = []): WorkerCapability {
  return createWorkerCapabilities({
    projectId: handle.project.id,
    projectRoot: handle.project.rootPath,
    allowedOperations: [
      "literature:protocol", "literature:inspect", "literature:retrieve", "literature:screen", "literature:assess-gap",
      "claim:record", "claim:inspect", "evidence:inspect", ...extra
    ],
    allowedPaths: [handle.project.rootPath]
  });
}

export function protocolFixture(handle: ProjectHandle) {
  const owner = createOwnerCapability(handle.project.ownerId);
  const protocol = recordReviewProtocol(handle, owner, {
    commandId: "literature-protocol",
    versionLabel: "v1",
    eligibility: { population: "researchers", design: "controlled" },
    scope: { domain: "local fixture" }
  });
  const query = recordQueryVersion(handle, owner, {
    commandId: "literature-query",
    protocolVersionId: protocol.id,
    versionLabel: "q1",
    expression: "researchers AND controlled",
    destination: "local",
    purpose: "landscape"
  });
  return { owner, protocol, query };
}
