// story: e02s03
import type { DatabaseSync } from "node:sqlite";
import { PROJECT_SCHEMA_VERSION } from "./project-types.js";

export const SCHEMA_METADATA_KEY = "schema_version";

export function configureDatabase(db: DatabaseSync): void {
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
}

export function createSchema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      root_path TEXT NOT NULL UNIQUE,
      schema_version INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS artifact_versions (
      id TEXT PRIMARY KEY,
      logical_id TEXT NOT NULL,
      version_label TEXT NOT NULL,
      content_hash TEXT,
      storage_path TEXT,
      byte_length INTEGER,
      origin TEXT NOT NULL,
      access_level TEXT NOT NULL,
      content_status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(logical_id, version_label)
    );
    CREATE TABLE IF NOT EXISTS dependencies (
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      dependency_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      relation TEXT NOT NULL,
      PRIMARY KEY (artifact_version_id, dependency_version_id, relation)
    );
    CREATE TABLE IF NOT EXISTS branches (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      parent_snapshot_id TEXT,
      current_snapshot_id TEXT,
      revision INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      parent_snapshot_id TEXT,
      revision INTEGER NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS branch_references (
      snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
      logical_id TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      PRIMARY KEY (snapshot_id, logical_id)
    );
    CREATE TABLE IF NOT EXISTS history (
      id TEXT PRIMARY KEY,
      branch_id TEXT,
      command_id TEXT NOT NULL UNIQUE,
      operation TEXT NOT NULL,
      expected_revision INTEGER NOT NULL,
      resulting_revision INTEGER NOT NULL,
      source_snapshot_id TEXT,
      destination_snapshot_id TEXT,
      payload_hash TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS impact_records (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      source_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      dependent_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      kind TEXT NOT NULL,
      notice TEXT NOT NULL,
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(command_id, branch_id, dependent_version_id, kind)
    );
    CREATE TABLE IF NOT EXISTS recovery_checkpoints (
      id TEXT PRIMARY KEY,
      operation TEXT NOT NULL,
      stage TEXT NOT NULL,
      status TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  db.prepare("INSERT OR IGNORE INTO metadata (key, value) VALUES (?, ?)").run(
    SCHEMA_METADATA_KEY,
    String(PROJECT_SCHEMA_VERSION)
  );
}

export function readSchemaVersion(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(SCHEMA_METADATA_KEY) as
    | { value?: unknown }
    | undefined;
  if (row?.value === undefined) {
    return 0;
  }
  const version = Number(row.value);
  return Number.isInteger(version) ? version : 0;
}

export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = action();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try {
      db.exec("ROLLBACK");
    } catch {
      // Preserve the original database error when rollback itself fails.
    }
    throw error;
  }
}
