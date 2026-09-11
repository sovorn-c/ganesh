// story: e02s01
import { accessSync, constants, existsSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  PROJECT_SCHEMA_VERSION,
  type ProjectHandle as ProjectHandleContract,
  type ProjectInput,
  type ProjectRecord,
  type ProjectStatus,
  ProjectStoreError
} from "./project-types.js";
import { createE04Schema, createE05Schema, createE06Schema, createSchema, configureDatabase, readSchemaVersion, transaction } from "../persistence/schema.js";
import { assertIdentifier, ensureDirectory, isoNow, newId, resolveProjectRoot } from "../persistence/storage-utils.js";

const STORE_DIRECTORY = ".ganesh";
const DATABASE_FILE = "project.sqlite";
const ARTIFACT_DIRECTORY = "artifacts";

export class ProjectHandle implements ProjectHandleContract {
  readonly db: DatabaseSync;
  readonly project: ProjectRecord;
  readonly status: ProjectStatus;
  readonly writable: boolean;
  readonly readonlyReason?: string;

  constructor(
    db: DatabaseSync,
    project: ProjectRecord,
    status: ProjectStatus,
    writable: boolean,
    readonlyReason?: string
  ) {
    this.db = db;
    this.project = project;
    this.status = status;
    this.writable = writable;
    this.readonlyReason = readonlyReason;
  }

  close(): void {
    try {
      this.db.close();
    } catch {
      // Ignore if already closed
    }
  }
}

export interface OpenProjectOptions {
  readonly readOnly?: boolean;
  readonly reason?: string;
}

function pathsFor(rootPath: string): { root: string; store: string; database: string; artifacts: string } {
  const root = resolveProjectRoot(rootPath);
  const store = join(root, STORE_DIRECTORY);
  return { root, store, database: join(store, DATABASE_FILE), artifacts: join(store, ARTIFACT_DIRECTORY) };
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

function projectFromRow(row: Record<string, unknown>, paths: ReturnType<typeof pathsFor>): ProjectRecord {
  const id = String(row.id ?? "");
  const ownerId = String(row.owner_id ?? "");
  const createdAt = String(row.created_at ?? "");
  const schemaVersion = Number(row.schema_version);
  if (id === "" || ownerId === "" || createdAt === "" || !Number.isInteger(schemaVersion)) {
    throw new ProjectStoreError("invalid-project", "project metadata is incomplete");
  }
  return {
    id,
    ownerId,
    rootPath: paths.root,
    databasePath: paths.database,
    artifactRoot: paths.artifacts,
    schemaVersion,
    createdAt
  };
}

function readProject(db: DatabaseSync, paths: ReturnType<typeof pathsFor>): ProjectRecord {
  const row = db.prepare("SELECT id, owner_id, schema_version, created_at FROM projects LIMIT 1").get() as
    | Record<string, unknown>
    | undefined;
  if (row === undefined) {
    throw new ProjectStoreError("invalid-project", "project database has no project record");
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
  assertIdentifier(input.ownerId, "ownerId");
  const projectId = input.projectId === undefined ? newId("project") : assertIdentifier(input.projectId, "projectId");
  const createdStore = !existsSync(paths.store);
  ensureDirectory(paths.artifacts);
  if (existsSync(paths.database)) {
    throw new ProjectStoreError("project-exists", "a project already exists at this root");
  }

  let db: DatabaseSync | undefined;
  try {
    db = openDatabase(paths.database, false);
    createSchema(db);
    const createdAt = isoNow();
    const snapshotId = newId("snapshot");
    transaction(db, () => {
      db?.prepare(
        "INSERT INTO projects (id, owner_id, root_path, schema_version, created_at) VALUES (?, ?, ?, ?, ?)"
      ).run(projectId, input.ownerId, paths.root, PROJECT_SCHEMA_VERSION, createdAt);
      db?.prepare(
        "INSERT INTO branches (id, name, parent_snapshot_id, current_snapshot_id, revision) VALUES (?, ?, ?, ?, ?)"
      ).run("main", "main", null, snapshotId, 0);
      db?.prepare(
        "INSERT INTO snapshots (id, branch_id, parent_snapshot_id, revision, reason, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(snapshotId, "main", null, 0, "project-created", createdAt);
    });
    const project = readProject(db, paths);
    return new ProjectHandle(db, project, "ready", true);
  } catch (error) {
    db?.close();
    if (createdStore) {
      rmSync(paths.store, { recursive: true, force: true });
    }
    throw error;
  }
}

export function openProject(rootPath: string, options: OpenProjectOptions = {}): ProjectHandle {
  const paths = pathsFor(rootPath);
  if (!existsSync(paths.database)) {
    throw new ProjectStoreError("project-not-found", "no project database exists at this root");
  }

  let openedReadOnlyFallback = false;
  let db: DatabaseSync;
  try {
    db = openDatabase(paths.database, options.readOnly === true);
  } catch (error) {
    if (options.readOnly === true) {
      throw error;
    }
    db = openDatabase(paths.database, true);
    openedReadOnlyFallback = true;
  }
  let project: ProjectRecord;
  try {
    project = readProject(db, paths);
  } catch (error) {
    db.close();
    throw error;
  }

  const schemaVersion = readSchemaVersion(db);
  const schemaStatus = statusForSchema(schemaVersion);
  const schemaMismatch = project.schemaVersion !== schemaVersion;
  if (schemaStatus === "ready" && !schemaMismatch && options.readOnly !== true && !openedReadOnlyFallback && writableDirectory(paths.store)) {
    createE04Schema(db);
    createE06Schema(db);
    createE05Schema(db);
  }
  const mustReadOnly = options.readOnly === true || !writableDirectory(paths.store) || schemaStatus !== "ready" || schemaMismatch;
  if (mustReadOnly && options.readOnly !== true && !openedReadOnlyFallback) {
    db.close();
    db = openDatabase(paths.database, true);
    openedReadOnlyFallback = true;
  }

  const status: ProjectStatus = schemaStatus === "unknown-future"
    ? "unknown-future"
    : schemaMismatch || schemaStatus === "migration-required"
      ? "migration-required"
      : options.readOnly === true || openedReadOnlyFallback
        ? "read-only"
        : "ready";
  const writable = status === "ready" && writableDirectory(paths.store);

  const reason = writable ? undefined : options.reason ?? (schemaMismatch ? "project metadata and schema markers differ" : `project opened ${status}`);
  return new ProjectHandle(db, { ...project, schemaVersion }, status, writable, reason);
}

export function assertWritable(handle: ProjectHandleContract): void {
  if (!handle.writable || handle.status !== "ready") {
    throw new ProjectStoreError("read-only", handle.readonlyReason ?? "project is not writable");
  }
}

export function closeProject(handle: ProjectHandleContract): void {
  handle.close();
}

export function projectPaths(handle: ProjectHandleContract): { readonly root: string; readonly store: string; readonly artifacts: string } {
  return {
    root: handle.project.rootPath,
    store: join(handle.project.rootPath, STORE_DIRECTORY),
    artifacts: handle.project.artifactRoot
  };
}
