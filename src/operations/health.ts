// story: e16s01, e16s04
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { ProjectStoreError, type ProjectHandle, PROJECT_SCHEMA_VERSION } from "../project/project-types.js";
import { isOwnerCapability, isWorkerCapability } from "../authority/capability-broker.js";
import { runPreflight, redactDiagnostic } from "../runtime/preflight.js";
import { aggregateStatus } from "../runtime/preflight-checks.js";
import type { PreflightCheck } from "../runtime/preflight-types.js";
import { readSchemaVersion } from "../persistence/schema.js";
import { operationsSchemaAvailable, getDiagnosticEventCount } from "./diagnostic-store.js";
import type { OperationalHealthReport } from "./diagnostic-types.js";

function isProjectHandle(target: unknown): target is ProjectHandle {
  return typeof target === "object" && target !== null && "project" in target && "db" in target;
}

function getDirectorySize(dirPath: string): number {
  let size = 0;
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const full = join(dirPath, entry.name);
      if (entry.isFile()) {
        try {
          size += statSync(full).size;
        } catch {
          // ignore unreadable file
        }
      } else if (entry.isDirectory()) {
        size += getDirectorySize(full);
      }
    }
  } catch {
    // ignore unreadable directory
  }
  return size;
}

function checkPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err: unknown) {
    return (err as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function inspectOperationalHealth(
  target: ProjectHandle | string,
  capability?: unknown
): OperationalHealthReport {
  const isHandle = isProjectHandle(target);
  const projectRoot = resolve(isHandle ? target.project.rootPath : target);

  if (isHandle) {
    if (!capability) {
      throw new ProjectStoreError("forbidden", "forbidden: inspecting operational health with ProjectHandle requires owner capability");
    }
    if (isWorkerCapability(capability)) {
      throw new ProjectStoreError("forbidden", "forbidden: workers cannot inspect operational health");
    }
    if (!isOwnerCapability(capability)) {
      throw new ProjectStoreError("forbidden", "forbidden: operational health requires owner capability");
    }
    if (capability.ownerId !== target.project.ownerId) {
      throw new ProjectStoreError("forbidden", "forbidden: capability owner does not match project owner");
    }
  } else if (capability !== undefined) {
    if (isWorkerCapability(capability)) {
      throw new ProjectStoreError("forbidden", "forbidden: workers cannot inspect operational health");
    }
    if (!isOwnerCapability(capability)) {
      throw new ProjectStoreError("forbidden", "forbidden: operational health requires owner capability");
    }
  }

  const preflight = runPreflight({ projectRoot });

  const lockPath = join(projectRoot, ".ganesh", "write.lock");
  let lockCheck: PreflightCheck;
  if (!existsSync(lockPath)) {
    lockCheck = {
      id: "project-lock",
      status: "ready",
      required: true,
      evidence: redactDiagnostic("write lock is free")
    };
  } else {
    try {
      const content = readFileSync(lockPath, "utf8").trim();
      const pid = Number(content);
      if (Number.isSafeInteger(pid) && pid > 0) {
        if (pid === process.pid) {
          lockCheck = {
            id: "project-lock",
            status: "ready",
            required: true,
            evidence: redactDiagnostic(`write lock held by current process (${pid})`)
          };
        } else if (checkPidAlive(pid)) {
          lockCheck = {
            id: "project-lock",
            status: "warning",
            required: true,
            evidence: redactDiagnostic(`write lock held by active process (${pid})`),
            remediation: redactDiagnostic("wait for other process or verify lock ownership")
          };
        } else {
          lockCheck = {
            id: "project-lock",
            status: "ready",
            required: true,
            evidence: redactDiagnostic(`stale write lock from deceased process (${pid})`),
            remediation: redactDiagnostic("lock will be cleaned on next writable open")
          };
        }
      } else {
        lockCheck = {
          id: "project-lock",
          status: "warning",
          required: true,
          evidence: redactDiagnostic("write lock file has unexpected content"),
          remediation: redactDiagnostic("verify project lock status")
        };
      }
    } catch {
      lockCheck = {
        id: "project-lock",
        status: "warning",
        required: true,
        evidence: redactDiagnostic("could not inspect write lock file")
      };
    }
  }

  const dbPath = join(projectRoot, ".ganesh", "project.sqlite");
  let schemaCheck: PreflightCheck;
  let diagnosticStoreCheck: PreflightCheck;

  let db: DatabaseSync | null = null;
  let closeDbAfter = false;

  if (isHandle) {
    db = target.db;
  } else if (existsSync(dbPath)) {
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
      closeDbAfter = true;
    } catch {
      db = null;
    }
  }

  try {
    if (!db) {
      schemaCheck = {
        id: "project-schema",
        status: "warning",
        required: true,
        evidence: redactDiagnostic("project database is not initialized"),
        remediation: redactDiagnostic("create or open project to initialize database")
      };
      diagnosticStoreCheck = {
        id: "diagnostic-store",
        status: "blocking",
        required: true,
        evidence: redactDiagnostic("operations-schema-unavailable"),
        remediation: redactDiagnostic("project database is missing")
      };
    } else {
      const version = readSchemaVersion(db);
      if (version === PROJECT_SCHEMA_VERSION) {
        schemaCheck = {
          id: "project-schema",
          status: "ready",
          required: true,
          evidence: redactDiagnostic(`schema version ${version} supported`)
        };
      } else {
        schemaCheck = {
          id: "project-schema",
          status: "blocking",
          required: true,
          evidence: redactDiagnostic(`schema version ${version} unsupported or requires migration`),
          remediation: redactDiagnostic(`run migrateSchema to upgrade to version ${PROJECT_SCHEMA_VERSION}`)
        };
      }

      if (!operationsSchemaAvailable(db)) {
        diagnosticStoreCheck = {
          id: "diagnostic-store",
          status: "blocking",
          required: true,
          evidence: redactDiagnostic("operations-schema-unavailable"),
          remediation: redactDiagnostic("operations schema tables are missing; run migration to initialize")
        };
      } else {
        const count = getDiagnosticEventCount(db);
        if (count >= 10000) {
          diagnosticStoreCheck = {
            id: "diagnostic-store",
            status: "blocking",
            required: true,
            evidence: redactDiagnostic(`${count} / 10000 events (cap reached)`),
            remediation: redactDiagnostic("purge diagnostic events to restore recording capacity")
          };
        } else if (count >= 8000) {
          diagnosticStoreCheck = {
            id: "diagnostic-store",
            status: "warning",
            required: true,
            evidence: redactDiagnostic(`${count} / 10000 events (approaching cap)`),
            remediation: redactDiagnostic("consider purging older diagnostic events")
          };
        } else {
          diagnosticStoreCheck = {
            id: "diagnostic-store",
            status: "ready",
            required: true,
            evidence: redactDiagnostic(`${count} / 10000 events`)
          };
        }
      }
    }
  } finally {
    if (closeDbAfter && db) {
      try {
        db.close();
      } catch {
        // ignore close error
      }
    }
  }

  const storeDir = join(projectRoot, ".ganesh");
  const storeBytes = existsSync(storeDir) ? getDirectorySize(storeDir) : 0;
  const storeSizeCheck: PreflightCheck = {
    id: "store-size",
    status: "ready",
    required: false,
    evidence: redactDiagnostic(`${storeBytes} bytes in project store`)
  };

  const checks: PreflightCheck[] = [
    ...preflight.checks,
    lockCheck,
    schemaCheck,
    storeSizeCheck,
    diagnosticStoreCheck
  ];

  const redactedChecks: PreflightCheck[] = checks.map((c) => ({
    ...c,
    evidence: redactDiagnostic(c.evidence),
    ...(c.remediation !== undefined ? { remediation: redactDiagnostic(c.remediation) } : {})
  }));

  const redactedExecutionMode = {
    ...preflight.executionMode,
    notice: redactDiagnostic(preflight.executionMode.notice),
    value: preflight.executionMode.value !== null ? redactDiagnostic(preflight.executionMode.value) : null
  };

  const status = aggregateStatus(redactedChecks);

  return {
    schemaVersion: 1,
    status,
    exitCode: status === "blocked" ? 1 : 0,
    checks: redactedChecks,
    executionMode: redactedExecutionMode
  };
}
