// story: e02s03
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
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
  createE03Schema(db);
}

export function createE03Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS classifications (
      id TEXT PRIMARY KEY,
      input_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      sensitivity TEXT NOT NULL,
      basis TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_classifications_input ON classifications(input_version_id);

    CREATE TABLE IF NOT EXISTS policy_permissions (
      id TEXT PRIMARY KEY,
      input_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      authority TEXT NOT NULL,
      allowed_transformations TEXT NOT NULL,
      validity_conditions TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_policy_permissions_input ON policy_permissions(input_version_id);

    CREATE TABLE IF NOT EXISTS policy_status_history (
      id TEXT PRIMARY KEY,
      permission_id TEXT NOT NULL REFERENCES policy_permissions(id),
      previous_status TEXT NOT NULL,
      new_status TEXT NOT NULL,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_policy_status_history_perm ON policy_status_history(permission_id);

    CREATE TABLE IF NOT EXISTS policy_decisions (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      result TEXT NOT NULL,
      reason TEXT NOT NULL,
      input_version_ids TEXT NOT NULL,
      policy_version_ids TEXT NOT NULL,
      transformation TEXT,
      branch_id TEXT,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_policy_decisions_corr ON policy_decisions(correlation_id);

    CREATE TABLE IF NOT EXISTS disclosure_decisions (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      operation_kind TEXT NOT NULL,
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      source_version_ids TEXT NOT NULL,
      transformation TEXT,
      branch_id TEXT,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      policy_decision_id TEXT REFERENCES policy_decisions(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS derived_materials (
      id TEXT PRIMARY KEY,
      candidate_version_id TEXT,
      source_version_ids TEXT NOT NULL,
      transformation TEXT NOT NULL,
      inherited_restrictions TEXT NOT NULL,
      branch_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS lifecycle_operations (
      id TEXT PRIMARY KEY,
      operation_type TEXT NOT NULL,
      branch_id TEXT,
      input_snapshot TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS policy_checkpoints (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES lifecycle_operations(id),
      phase TEXT NOT NULL,
      policy_decision_id TEXT REFERENCES policy_decisions(id),
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS revocation_fences (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES lifecycle_operations(id),
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS quarantined_outputs (
      id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL REFERENCES lifecycle_operations(id),
      candidate_id TEXT NOT NULL,
      reason TEXT NOT NULL,
      disposition TEXT NOT NULL,
      details TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS declassifications (
      id TEXT PRIMARY KEY,
      input_version_ids TEXT NOT NULL,
      transformation TEXT NOT NULL,
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      output_version_id TEXT,
      authority TEXT NOT NULL,
      residual_risk TEXT NOT NULL,
      validity_conditions TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function migrateSchema(target: string | DatabaseSync): { fromVersion: number; toVersion: number } {
  const isString = typeof target === "string";
  const db = isString
    ? new DatabaseSync(target.endsWith(".sqlite") ? target : join(target, ".ganesh", "project.sqlite"))
    : target;
  try {
    const currentVersion = readSchemaVersion(db);
    if (currentVersion > PROJECT_SCHEMA_VERSION) {
      throw new Error(`cannot migrate unknown future schema version ${currentVersion}`);
    }
    transaction(db, () => {
      createE03Schema(db);
      db.prepare("UPDATE metadata SET value = ? WHERE key = ?").run(
        String(PROJECT_SCHEMA_VERSION),
        SCHEMA_METADATA_KEY
      );
      db.prepare("UPDATE projects SET schema_version = ?").run(PROJECT_SCHEMA_VERSION);
    });
    return { fromVersion: currentVersion, toVersion: PROJECT_SCHEMA_VERSION };
  } finally {
    if (isString) {
      db.close();
    }
  }
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

