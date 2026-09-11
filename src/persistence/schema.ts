// story: e02s03
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { PROJECT_SCHEMA_VERSION } from "../project/project-types.js";

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
  createE04Schema(db);
  createE06Schema(db);
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

export function createE04Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS decision_packets (
      id TEXT PRIMARY KEY,
      packet_version INTEGER NOT NULL,
      question TEXT NOT NULL,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      snapshot_id TEXT NOT NULL REFERENCES snapshots(id),
      branch_revision INTEGER NOT NULL,
      candidate_version_ids TEXT NOT NULL,
      candidate_details TEXT NOT NULL,
      dependency_version_ids TEXT NOT NULL,
      review_references TEXT NOT NULL,
      permitted_actions TEXT NOT NULL,
      status TEXT NOT NULL,
      parent_packet_id TEXT REFERENCES decision_packets(id),
      created_at TEXT NOT NULL,
      UNIQUE(parent_packet_id, packet_version)
    );
    CREATE INDEX IF NOT EXISTS idx_decision_packets_branch ON decision_packets(branch_id, status);

    CREATE TABLE IF NOT EXISTS decision_records (
      id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      packet_version INTEGER NOT NULL,
      disposition TEXT NOT NULL,
      selected_candidate_version_ids TEXT NOT NULL,
      dependency_version_ids TEXT NOT NULL,
      rationale TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      actor TEXT NOT NULL,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      branch_revision INTEGER NOT NULL,
      commitment_id TEXT,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_decision_records_packet ON decision_records(packet_id, created_at);

    CREATE TABLE IF NOT EXISTS decision_events (
      id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      event_type TEXT NOT NULL,
      reason TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      actor TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commitments (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL UNIQUE REFERENCES decision_records(id),
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      packet_version INTEGER NOT NULL,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      branch_revision INTEGER NOT NULL,
      selected_candidate_version_ids TEXT NOT NULL,
      dependency_version_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commitments_packet ON commitments(packet_id, status);

    CREATE TABLE IF NOT EXISTS commitment_events (
      id TEXT PRIMARY KEY,
      commitment_id TEXT NOT NULL REFERENCES commitments(id),
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      event_type TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS readiness_assessments (
      id TEXT PRIMARY KEY,
      commitment_id TEXT NOT NULL REFERENCES commitments(id),
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      branch_id TEXT NOT NULL REFERENCES branches(id),
      action TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      causes TEXT NOT NULL,
      affected_version_ids TEXT NOT NULL,
      next_action TEXT NOT NULL,
      command_id TEXT UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS alternative_adoptions (
      id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      source_branch_id TEXT NOT NULL REFERENCES branches(id),
      destination_branch_id TEXT NOT NULL REFERENCES branches(id),
      source_snapshot_id TEXT NOT NULL,
      destination_snapshot_id TEXT NOT NULL,
      changed_references TEXT NOT NULL,
      impacted_dependents TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      destination_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS scholarly_findings (
      id TEXT PRIMARY KEY,
      affected_version_ids TEXT NOT NULL,
      source_basis TEXT NOT NULL,
      rationale TEXT NOT NULL,
      severity TEXT NOT NULL,
      reviewer_id TEXT NOT NULL,
      methodology_position TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reasoned_overrides (
      id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL REFERENCES scholarly_findings(id),
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      selected_candidate_version_ids TEXT NOT NULL,
      owner_rationale TEXT NOT NULL,
      dissent TEXT NOT NULL,
      uncertainty TEXT NOT NULL,
      actor TEXT NOT NULL,
      status TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS commitment_gate_results (
      id TEXT PRIMARY KEY,
      packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      override_id TEXT REFERENCES reasoned_overrides(id),
      gate TEXT NOT NULL,
      passed INTEGER NOT NULL,
      reason TEXT NOT NULL,
      command_id TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS review_revisions (
      id TEXT PRIMARY KEY,
      finding_id TEXT NOT NULL REFERENCES scholarly_findings(id),
      prior_packet_id TEXT NOT NULL REFERENCES decision_packets(id),
      replacement_packet_id TEXT REFERENCES decision_packets(id),
      reviewer_position TEXT NOT NULL,
      methodology_position TEXT NOT NULL,
      rationale TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_review_revisions_finding ON review_revisions(finding_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_reasoned_overrides_finding_packet ON reasoned_overrides(finding_id, packet_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_review_revisions_one_per_finding ON review_revisions(finding_id);
  `);
  const readinessColumns = db.prepare("PRAGMA table_info(readiness_assessments)").all() as Array<{ name?: unknown }>;
  if (!readinessColumns.some((column) => column.name === "next_action")) {
    db.exec("ALTER TABLE readiness_assessments ADD COLUMN next_action TEXT NOT NULL DEFAULT 'resolve the blocking condition before use'");
  }
}

export function createE06Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS source_import_operations (
      command_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_versions (
      artifact_version_id TEXT PRIMARY KEY REFERENCES artifact_versions(id),
      format TEXT NOT NULL,
      media_type TEXT NOT NULL,
      original_name TEXT NOT NULL,
      access_level TEXT NOT NULL,
      extraction_status TEXT NOT NULL,
      parser_name TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_locators (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      kind TEXT NOT NULL,
      algorithm TEXT NOT NULL,
      start_byte INTEGER NOT NULL,
      end_byte INTEGER NOT NULL,
      coordinates TEXT NOT NULL,
      raw_value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_source_locators_version ON source_locators(artifact_version_id, start_byte, id);
    CREATE TABLE IF NOT EXISTS source_diagnostics (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT REFERENCES source_versions(artifact_version_id),
      operation_id TEXT,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      detail TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_extractions (
      id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      derived_version_id TEXT REFERENCES artifact_versions(id),
      status TEXT NOT NULL,
      extractor TEXT NOT NULL,
      extractor_version TEXT NOT NULL,
      locator_algorithm TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_segments (
      id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      derived_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      locator TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_records (
      id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      record_kind TEXT NOT NULL,
      record_data TEXT NOT NULL,
      locator TEXT NOT NULL,
      access_level TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS source_match_proposals (
      id TEXT PRIMARY KEY,
      left_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      right_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      relation TEXT NOT NULL,
      basis TEXT NOT NULL,
      score REAL NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(left_version_id, right_version_id, basis)
    );
    CREATE TABLE IF NOT EXISTS source_relationships (
      id TEXT PRIMARY KEY,
      left_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      right_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      relation TEXT NOT NULL,
      basis TEXT NOT NULL,
      actor TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(left_version_id, right_version_id, relation)
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
      createE04Schema(db);
      createE06Schema(db);
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
