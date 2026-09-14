// story: e02s01
import {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectHandle as ProjectHandleContract,
  type ProjectInput,
  type ProjectLock,
  type ProjectRecord,
  type ProjectStatus,
  ProjectStoreError,
} from "./project-types.js";
import {
  createE04Schema,
  createE05Schema,
  createE06Schema,
  createE07Schema,
  createE08Schema,
  createE15Schema,
  createE16Schema,
  createE09Schema,
  createSchema,
  configureDatabase,
  readSchemaVersion,
  transaction,
} from "../persistence/schema.js";
import {
  assertIdentifier,
  ensureDirectory,
  isoNow,
  newId,
  resolveProjectRoot,
} from "../persistence/storage-utils.js";
import {
  acquireProjectWriteLock,
  reconcileProjectStoreSwap,
} from "./project-lock.js";

const STORE_DIRECTORY = ".ganesh";
const DATABASE_FILE = "project.sqlite";
const ARTIFACT_DIRECTORY = "artifacts";
const databaseIdentities = new WeakMap<object, { dev: number; ino: number }>();

export class ProjectHandle implements ProjectHandleContract {
  readonly db: DatabaseSync;
  readonly project: ProjectRecord;
  readonly status: ProjectStatus;
  readonly writable: boolean;
  readonly readonlyReason?: string;
  private lock?: ProjectLock;
  constructor(
    db: DatabaseSync,
    project: ProjectRecord,
    status: ProjectStatus,
    writable: boolean,
    readonlyReason?: string,
    lock?: ProjectLock,
  ) {
    this.db = db;
    this.project = project;
    this.status = status;
    this.writable = writable;
    this.readonlyReason = readonlyReason;
    this.lock = lock;
    const stat = statSync(project.databasePath);
    databaseIdentities.set(this, { dev: stat.dev, ino: stat.ino });
  }

  assertCurrent(): void {
    try {
      const stat = statSync(this.project.databasePath);
      const identity = databaseIdentities.get(this);
      if (!identity || stat.dev !== identity.dev || stat.ino !== identity.ino) {
        throw new ProjectStoreError(
          "project-locked",
          "project store changed; reopen the project before writing",
        );
      }
    } catch (error) {
      if (error instanceof ProjectStoreError) {
        throw error;
      }
      throw new ProjectStoreError(
        "project-locked",
        "project database is no longer available; reopen the project",
      );
    }
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    } finally {
      this.lock?.release();
      this.lock = undefined;
    }
  }
}

export interface OpenProjectOptions {
  readonly readOnly?: boolean;
  readonly reason?: string;
}

function pathsFor(rootPath: string): {
  root: string;
  store: string;
  database: string;
  artifacts: string;
} {
  const root = resolveProjectRoot(rootPath);
  const store = join(root, STORE_DIRECTORY);
  return {
    root,
    store,
    database: join(store, DATABASE_FILE),
    artifacts: join(store, ARTIFACT_DIRECTORY),
  };
}

function statusForSchema(version: number): ProjectStatus {
  if (version > PROJECT_SCHEMA_VERSION) {
    return "unknown-future";
  }
  if (version < PROJECT_SCHEMA_VERSION) {
    return "migration-required";
  }
  return "ready";
}

function projectFromRow(
  row: Record<string, unknown>,
  paths: ReturnType<typeof pathsFor>,
): ProjectRecord {
  const id = String(row.id ?? "");
  const ownerId = String(row.owner_id ?? "");
  const createdAt = String(row.created_at ?? "");
  const schemaVersion = Number(row.schema_version);
  if (
    id === "" ||
    ownerId === "" ||
    createdAt === "" ||
    !Number.isInteger(schemaVersion)
  ) {
    throw new ProjectStoreError(
      "invalid-project",
      "project metadata is incomplete",
    );
  }
  return {
    id,
    ownerId,
    rootPath: paths.root,
    databasePath: paths.database,
    artifactRoot: paths.artifacts,
    schemaVersion,
    createdAt,
  };
}

function readProject(
  db: DatabaseSync,
  paths: ReturnType<typeof pathsFor>,
): ProjectRecord {
  const row = db
    .prepare(
      "SELECT id, owner_id, schema_version, created_at FROM projects LIMIT 1",
    )
    .get() as Record<string, unknown> | undefined;
  if (row === undefined) {
    throw new ProjectStoreError(
      "invalid-project",
      "project database has no project record",
    );
  }
  return projectFromRow(row, paths);
}

function writableDirectory(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function openDatabase(path: string, readOnly: boolean): DatabaseSync {
  const db = new DatabaseSync(path, { readOnly, timeout: 5000 });
  configureDatabase(db);
  return db;
}

export function createProject(input: ProjectInput): ProjectHandle {
  const paths = pathsFor(input.rootPath);
  reconcileProjectStoreSwap(paths.root);
  assertIdentifier(input.ownerId, "ownerId");
  const projectId =
    input.projectId === undefined
      ? newId("project")
      : assertIdentifier(input.projectId, "projectId");

  if (existsSync(paths.database)) {
    throw new ProjectStoreError(
      "project-exists",
      "a project already exists at this root",
    );
  }

  let db: DatabaseSync | undefined;
  let lock: ProjectLock | undefined;
  let storeExistedBefore = false;

  try {
    lock = acquireProjectWriteLock(paths.root);

    if (existsSync(paths.database)) {
      throw new ProjectStoreError(
        "project-exists",
        "a project already exists at this root",
      );
    }

    storeExistedBefore = existsSync(paths.store);
    ensureDirectory(paths.artifacts);

    db = openDatabase(paths.database, false);
    createSchema(db);
    const createdAt = isoNow();
    const snapshotId = newId("snapshot");
    transaction(db, () => {
      db?.prepare(
        "INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(
        projectId,
        input.ownerId,
        paths.root,
        PROJECT_SCHEMA_VERSION,
        createdAt,
      );
      db?.prepare(
        "INSERT INTO branches (id, name, parent_snapshot_id, current_snapshot_id, revision) VALUES (?, ?, ?, ?, ?)",
      ).run("main", "main", null, snapshotId, 0);
      db?.prepare(
        "INSERT INTO snapshots (id, branch_id, parent_snapshot_id, revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(snapshotId, "main", null, 0, "project-created", createdAt);
    });
    const project = readProject(db, paths);
    return new ProjectHandle(db, project, "ready", true, undefined, lock);
  } catch (error) {
    try {
      lock?.release();
    } catch {
      /* ignore */
    }
    try {
      db?.close();
    } catch {
      /* ignore */
    }
    // Ownership-aware cleanup: NEVER remove paths.store if the project exists
    // or belongs to another creator, or if the failure was project-exists.
    if (error instanceof ProjectStoreError && error.code === "project-exists") {
      // A winner's store or existing project is present: never delete it!
    } else if (!storeExistedBefore) {
      if (!db) {
        if (!existsSync(paths.database)) {
          try {
            rmSync(paths.store, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      } else if (existsSync(paths.database)) {
        let canDelete = false;
        try {
          const checkDb = new DatabaseSync(paths.database, { readOnly: true });
          try {
            const row = checkDb
              .prepare("SELECT id FROM projects LIMIT 1")
              .get() as { id?: string } | undefined;
            if (!row || row.id === projectId) {
              canDelete = true;
            }
          } finally {
            checkDb.close();
          }
        } catch {
          canDelete = false;
        }
        if (canDelete) {
          try {
            rmSync(paths.store, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      } else {
        try {
          rmSync(paths.store, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    }
    throw error;
  }
}

export function openProject(
  rootPath: string,
  options: OpenProjectOptions = {},
): ProjectHandle {
  const paths = pathsFor(rootPath);
  reconcileProjectStoreSwap(paths.root);
  if (!existsSync(paths.database)) {
    throw new ProjectStoreError(
      "project-not-found",
      "no project database exists at this root",
    );
  }

  let lock: ProjectLock | undefined;
  if (options.readOnly !== true) {
    lock = acquireProjectWriteLock(paths.root);
  }

  let openedReadOnlyFallback = false;
  let db: DatabaseSync;
  try {
    db = openDatabase(paths.database, options.readOnly === true);
  } catch (error) {
    if (options.readOnly === true) {
      lock?.release();
      throw error;
    }
    db = openDatabase(paths.database, true);
    openedReadOnlyFallback = true;
  }
  let project: ProjectRecord;
  try {
    project = readProject(db, paths);
  } catch (error) {
    lock?.release();
    db.close();
    throw error;
  }

  const schemaVersion = readSchemaVersion(db);
  const schemaStatus = statusForSchema(schemaVersion);
  const schemaMismatch = project.schemaVersion !== schemaVersion;
  if (
    schemaStatus === "ready" &&
    !schemaMismatch &&
    options.readOnly !== true &&
    !openedReadOnlyFallback &&
    writableDirectory(paths.store)
  ) {
    try {
      createE04Schema(db);
      createE06Schema(db);
      createE05Schema(db);
      createE07Schema(db);
      createE08Schema(db);
      createE15Schema(db);
      createE16Schema(db);
      createE09Schema(db);
    } catch (error) {
      try {
        db.close();
      } catch {
        /* preserve schema error */
      }
      lock?.release();
      throw error;
    }
  }
  const mustReadOnly =
    options.readOnly === true ||
    !writableDirectory(paths.store) ||
    schemaStatus !== "ready" ||
    schemaMismatch;
  if (mustReadOnly && options.readOnly !== true && !openedReadOnlyFallback) {
    db.close();
    db = openDatabase(paths.database, true);
    openedReadOnlyFallback = true;
  }
  if (mustReadOnly || openedReadOnlyFallback) {
    lock?.release();
    lock = undefined;
  }

  const status: ProjectStatus =
    schemaStatus === "unknown-future"
      ? "unknown-future"
      : schemaMismatch || schemaStatus === "migration-required"
        ? "migration-required"
        : options.readOnly === true || openedReadOnlyFallback
          ? "read-only"
          : "ready";
  const writable = status === "ready" && writableDirectory(paths.store);

  const reason = writable
    ? undefined
    : (options.reason ??
      (schemaMismatch
        ? "project metadata and schema markers differ"
        : `project opened ${status}`));
  return new ProjectHandle(
    db,
    { ...project, schemaVersion },
    status,
    writable,
    reason,
    lock,
  );
}

export function assertWritable(handle: ProjectHandleContract): void {
  if (!handle.writable || handle.status !== "ready") {
    throw new ProjectStoreError(
      "read-only",
      handle.readonlyReason ?? "project is not writable",
    );
  }
  handle.assertCurrent?.();
}

export function closeProject(handle: ProjectHandleContract): void {
  handle.close();
}

export function projectPaths(handle: ProjectHandleContract): {
  readonly root: string;
  readonly store: string;
  readonly artifacts: string;
} {
  return {
    root: handle.project.rootPath,
    store: join(handle.project.rootPath, STORE_DIRECTORY),
    artifacts: handle.project.artifactRoot,
  };
}
