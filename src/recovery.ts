// story: e02s03
import { rmSync } from "node:fs";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectHandle,
  type RecoveryResult,
  type SchemaStatus,
  ProjectStoreError
} from "./project-types.js";
import { inspectArtifactVersion, listArtifactVersions, listTemporaryArtifactFiles } from "./artifact-store.js";
import { openProject } from "./project-store.js";
import { transaction } from "./schema.js";
import { isoNow, newId } from "./storage-utils.js";

export function schemaStatus(handle: ProjectHandle): SchemaStatus {
  const version = handle.project.schemaVersion;
  if (version > PROJECT_SCHEMA_VERSION) {
    return {
      status: "unknown-future",
      version,
      supportedVersion: PROJECT_SCHEMA_VERSION,
      allowedOperations: ["inspect", "export-metadata"],
      remediation: `Upgrade Ganesh to read schema version ${version} before mutating this project.`
    };
  }
  if (version < PROJECT_SCHEMA_VERSION) {
    return {
      status: "migration-required",
      version,
      supportedVersion: PROJECT_SCHEMA_VERSION,
      allowedOperations: ["inspect", "export-metadata"],
      remediation: `Run the supported migration before mutating schema version ${version}.`
    };
  }
  return {
    status: "supported",
    version,
    supportedVersion: PROJECT_SCHEMA_VERSION,
    allowedOperations: handle.writable ? ["inspect", "mutate", "recover"] : ["inspect", "recover-read-only"],
    remediation: handle.writable ? "No schema action is required." : "Open the project from a writable storage root to enable mutations."
  };
}

export function recordRecoveryCheckpoint(
  handle: ProjectHandle,
  operation: string,
  stage: string,
  status: "started" | "completed" | "blocked" | "failed",
  details: string
): string {
  if (!handle.writable) {
    throw new ProjectStoreError("read-only", "cannot record a recovery checkpoint on a read-only project");
  }
  const id = newId("checkpoint");
  transaction(handle.db, () => {
    handle.db.prepare(
      "INSERT INTO recovery_checkpoints (id, operation, stage, status, details, created_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, operation, stage, status, details, isoNow());
  });
  return id;
}

function artifactInspection(handle: ProjectHandle): ReturnType<typeof inspectArtifactVersion>[] {
  return listArtifactVersions(handle).map((artifact) => inspectArtifactVersion(handle, artifact.id));
}

export function recoverProject(projectRoot: string): RecoveryResult {
  const handle = openProject(projectRoot);
  try {
    const schema = schemaStatus(handle);
    const temporaryFiles = listTemporaryArtifactFiles(handle);
    const canMutate = handle.writable && schema.status === "supported";
    if (!canMutate) {
      return {
        status: handle.status,
        removedTemporaryFiles: [],
        artifactStatuses: artifactInspection(handle),
        checkpointId: null,
        detail: `${schema.status} project opened for inspection; no recovery mutation was attempted`
      };
    }

    for (const path of temporaryFiles) {
      rmSync(path, { force: true });
    }
    const checkpointId = recordRecoveryCheckpoint(
      handle,
      "project-recovery",
      "reconcile-artifacts",
      "completed",
      `removed ${temporaryFiles.length} temporary artifact file(s)`
    );
    return {
      status: "ready",
      removedTemporaryFiles: temporaryFiles,
      artifactStatuses: artifactInspection(handle),
      checkpointId,
      detail: "last complete database state retained; temporary files reconciled"
    };
  } finally {
    handle.close();
  }
}
