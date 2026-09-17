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
  createE05Schema(db);
  createE07Schema(db);
  createE08Schema(db);
  createE15Schema(db);
  createE16Schema(db);
  createE09Schema(db);
  createE10Schema(db);
  createE12Schema(db);
  createE11Schema(db);
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

export function createE05Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS work_contracts (
      id TEXT NOT NULL,
      version INTEGER NOT NULL,
      parent_contract_id TEXT,
      budget_group_id TEXT NOT NULL,
      objective TEXT NOT NULL,
      scope TEXT NOT NULL,
      input_version_ids TEXT NOT NULL,
      permitted_roles TEXT NOT NULL,
      limits TEXT NOT NULL,
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      execution_mode TEXT,
      authorization_basis TEXT NOT NULL,
      branch_id TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (id, version),
      UNIQUE(id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_work_contracts_budget ON work_contracts(budget_group_id);

    CREATE TABLE IF NOT EXISTS standing_permissions (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      objective_pattern TEXT NOT NULL,
      scope TEXT NOT NULL,
      role TEXT NOT NULL,
      input_version_ids TEXT NOT NULL,
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      limits TEXT NOT NULL,
      expires_at TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_runs (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      contract_version INTEGER NOT NULL,
      role TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      operation_id TEXT NOT NULL UNIQUE REFERENCES lifecycle_operations(id),
      input_version_ids TEXT NOT NULL,
      reserved TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      failure_reason TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(contract_id, contract_version) REFERENCES work_contracts(id, version)
    );
    CREATE INDEX IF NOT EXISTS idx_work_runs_contract ON work_runs(contract_id, contract_version, status);

    CREATE TABLE IF NOT EXISTS work_candidates (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES work_runs(id),
      artifact_version_id TEXT,
      diagnostics TEXT NOT NULL,
      source_version_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS work_budget_ledger (
      id TEXT PRIMARY KEY,
      budget_group_id TEXT NOT NULL,
      contract_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      dimension TEXT NOT NULL,
      reserved REAL NOT NULL DEFAULT 0,
      spent REAL NOT NULL DEFAULT 0,
      uncertain INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_work_budget_group ON work_budget_ledger(budget_group_id, dimension);

    CREATE TABLE IF NOT EXISTS work_disagreements (
      id TEXT PRIMARY KEY,
      contract_id TEXT NOT NULL,
      question TEXT NOT NULL,
      left_role TEXT NOT NULL,
      right_role TEXT NOT NULL,
      left_candidate_version_id TEXT NOT NULL,
      right_candidate_version_id TEXT NOT NULL,
      left_source_basis TEXT NOT NULL,
      right_source_basis TEXT NOT NULL,
      revision_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS provider_attempts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES work_runs(id),
      destination TEXT NOT NULL,
      purpose TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      outcome TEXT NOT NULL,
      pricing TEXT NOT NULL,
      session_id TEXT,
      created_at TEXT NOT NULL
    );
  `);
}

export function createE07Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS evidence_operations (
      command_id TEXT PRIMARY KEY,
      payload_hash TEXT NOT NULL,
      evidence_item_id TEXT,
      status TEXT NOT NULL,
      error_code TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_items (
      id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      location_kind TEXT NOT NULL,
      location_id TEXT NOT NULL,
      locator_snapshot TEXT NOT NULL,
      statement_kind TEXT NOT NULL,
      origin TEXT NOT NULL,
      limitations TEXT NOT NULL,
      excerpt TEXT,
      excerpt_hash TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_evidence_items_source ON evidence_items(source_version_id);

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      scope TEXT NOT NULL,
      origin TEXT NOT NULL,
      current_support TEXT NOT NULL,
      qualification TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS claim_evidence_links (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      evidence_item_id TEXT NOT NULL REFERENCES evidence_items(id),
      role TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      qualification TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      UNIQUE(claim_id, evidence_item_id, role)
    );
    CREATE INDEX IF NOT EXISTS idx_claim_links_claim ON claim_evidence_links(claim_id);
    CREATE TABLE IF NOT EXISTS citation_verifications (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      identity_status TEXT NOT NULL,
      access_status TEXT NOT NULL,
      support_status TEXT NOT NULL,
      bibliographic_fields TEXT NOT NULL,
      limitations TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_citation_verifications_claim ON citation_verifications(claim_id);
    CREATE TABLE IF NOT EXISTS claim_reassessments (
      id TEXT PRIMARY KEY,
      claim_id TEXT NOT NULL REFERENCES claims(id),
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      notice_command_id TEXT NOT NULL,
      previous_support TEXT NOT NULL,
      current_support TEXT NOT NULL,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(claim_id, notice_command_id)
    );
    CREATE TABLE IF NOT EXISTS appraisals (
      id TEXT PRIMARY KEY,
      source_version_id TEXT NOT NULL REFERENCES source_versions(artifact_version_id),
      method_kind TEXT NOT NULL,
      result TEXT NOT NULL,
      findings TEXT NOT NULL,
      origin TEXT NOT NULL,
      scholarly_finding_id TEXT,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS syntheses (
      id TEXT PRIMARY KEY,
      claim_ids TEXT NOT NULL,
      summary TEXT NOT NULL,
      disagreements TEXT NOT NULL,
      limitations TEXT NOT NULL,
      reassessment_flags TEXT NOT NULL,
      qualifications TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
  `);
}

export function createE15Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS portability_operations (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      packet_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_tombstones (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      content_hash TEXT,
      reason TEXT NOT NULL,
      actor TEXT NOT NULL,
      deleted_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tombstones_artifact ON evidence_tombstones(artifact_version_id);
    CREATE TABLE IF NOT EXISTS deletion_events (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL,
      unlinked_paths TEXT NOT NULL,
      tombstone_id TEXT NOT NULL REFERENCES evidence_tombstones(id),
      not_recalled_disclosures TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS backup_records (
      id TEXT PRIMARY KEY,
      backup_path TEXT NOT NULL,
      manifest_hash TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      payload_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

export function createE16Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS diagnostic_events (
      id TEXT PRIMARY KEY,
      correlation_id TEXT NOT NULL,
      command_id TEXT,
      run_id TEXT,
      kind TEXT NOT NULL,
      code TEXT NOT NULL,
      severity TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_diagnostics_correlation ON diagnostic_events(correlation_id);
    CREATE INDEX IF NOT EXISTS idx_diagnostics_run ON diagnostic_events(run_id);
    CREATE INDEX IF NOT EXISTS idx_diagnostics_created_at ON diagnostic_events(created_at);

    CREATE TABLE IF NOT EXISTS operations_commands (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      result_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_operations_commands_kind ON operations_commands(kind);

    CREATE TABLE IF NOT EXISTS provider_attempt_reservations (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES work_runs(id),
      attempt INTEGER NOT NULL,
      reserved_at TEXT NOT NULL,
      UNIQUE(run_id, attempt)
    );
    CREATE INDEX IF NOT EXISTS idx_provider_attempt_reservations_time ON provider_attempt_reservations(reserved_at);
    CREATE INDEX IF NOT EXISTS idx_provider_attempt_reservations_run ON provider_attempt_reservations(run_id);
  `);
}

export function createE09Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS methodology_operations (
      command_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      entity_id TEXT,
      result_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_methodology_operations_kind ON methodology_operations(kind);

    CREATE TABLE IF NOT EXISTS orientations (
      id TEXT PRIMARY KEY,
      topic TEXT NOT NULL,
      discipline TEXT NOT NULL,
      immediate_goal TEXT NOT NULL,
      unknowns TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_orientations_created ON orientations(created_at);

    CREATE TABLE IF NOT EXISTS problem_framings (
      id TEXT PRIMARY KEY,
      orientation_id TEXT NOT NULL REFERENCES orientations(id),
      statement TEXT NOT NULL,
      boundaries TEXT NOT NULL,
      gap_assessment_id TEXT,
      contribution_proposal_id TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_problem_framings_orientation ON problem_framings(orientation_id);

    CREATE TABLE IF NOT EXISTS research_questions (
      id TEXT PRIMARY KEY,
      orientation_id TEXT NOT NULL REFERENCES orientations(id),
      framing_id TEXT REFERENCES problem_framings(id),
      question_text TEXT NOT NULL,
      status TEXT NOT NULL,
      version INTEGER NOT NULL,
      superseded_by TEXT,
      gap_assessment_id TEXT,
      contribution_proposal_id TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_research_questions_orientation ON research_questions(orientation_id);

    CREATE TABLE IF NOT EXISTS methodology_candidates (
      id TEXT PRIMARY KEY,
      orientation_id TEXT NOT NULL,
      specialist_role TEXT NOT NULL,
      candidate_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      origin TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS constructs (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      definition TEXT NOT NULL,
      rq_version_ids TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS theoretical_frameworks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      construct_relations TEXT NOT NULL,
      rq_version_ids TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS positionality_records (
      id TEXT PRIMARY KEY,
      orientation_id TEXT NOT NULL REFERENCES orientations(id),
      philosophical_stance TEXT NOT NULL,
      situated_stance TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      command_id TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_positionality_orientation ON positionality_records(orientation_id);

    CREATE TABLE IF NOT EXISTS design_comparisons (
      id TEXT PRIMARY KEY,
      branch_id TEXT NOT NULL,
      rq_ids TEXT NOT NULL,
      designs TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_design_comparisons_branch ON design_comparisons(branch_id);

    CREATE TABLE IF NOT EXISTS sampling_plans (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      design_id TEXT NOT NULL,
      population TEXT NOT NULL,
      access_path TEXT NOT NULL,
      recruitment_approach TEXT NOT NULL,
      non_execution_flag INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_sampling_plans_comparison ON sampling_plans(comparison_id);

    CREATE TABLE IF NOT EXISTS instruments (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      design_id TEXT NOT NULL,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL,
      construct_ids TEXT,
      rights_basis TEXT NOT NULL,
      rights_issue INTEGER NOT NULL,
      validated_by_generation INTEGER NOT NULL DEFAULT 0,
      fit_notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_instruments_comparison ON instruments(comparison_id);

    CREATE TABLE IF NOT EXISTS pilot_plans (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      design_id TEXT NOT NULL,
      feasibility_questions TEXT NOT NULL,
      stop_conditions TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pilot_plans_comparison ON pilot_plans(comparison_id);

    CREATE TABLE IF NOT EXISTS method_profile_bindings (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      profile_id TEXT NOT NULL,
      context_id TEXT NOT NULL,
      details TEXT NOT NULL,
      competence TEXT NOT NULL,
      profile_fit TEXT NOT NULL,
      fit_reasons TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_method_profile_bindings_comparison ON method_profile_bindings(comparison_id);

    CREATE TABLE IF NOT EXISTS alignment_audits (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      rq_version_ids TEXT NOT NULL,
      chain_links TEXT NOT NULL,
      status TEXT NOT NULL,
      issues TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_alignment_audits_comparison ON alignment_audits(comparison_id);

    CREATE TABLE IF NOT EXISTS analysis_plans (
      id TEXT PRIMARY KEY,
      comparison_id TEXT NOT NULL REFERENCES design_comparisons(id),
      profile_id TEXT NOT NULL,
      rq_version_ids TEXT NOT NULL,
      confirmatory_or_exploratory TEXT NOT NULL,
      assumptions TEXT NOT NULL,
      uncertainty TEXT NOT NULL,
      escalation TEXT NOT NULL,
      escalation_reason TEXT,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_plans_comparison ON analysis_plans(comparison_id);
  `);
}

export function createE08Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS literature_operations (
      command_id TEXT PRIMARY KEY, payload_hash TEXT NOT NULL, result_id TEXT, result_kind TEXT,
      status TEXT NOT NULL, error_code TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS review_protocols (
      id TEXT PRIMARY KEY, version_label TEXT NOT NULL, artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      eligibility TEXT NOT NULL, scope TEXT NOT NULL, origin TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS query_versions (
      id TEXT PRIMARY KEY, protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id), version_label TEXT NOT NULL,
      expression TEXT NOT NULL, destination TEXT NOT NULL, purpose TEXT NOT NULL, parent_query_version_id TEXT,
      supersedes_query_version_id TEXT, artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id), origin TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS landscape_maps (
      id TEXT PRIMARY KEY, protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id), query_version_ids TEXT NOT NULL,
      description TEXT NOT NULL, searched_at TEXT NOT NULL, origin TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corpus_records (
      id TEXT PRIMARY KEY, protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id), source_version_id TEXT,
      bibliographic_identity TEXT NOT NULL, origin TEXT NOT NULL, created_at TEXT NOT NULL, command_id TEXT UNIQUE
    );
    CREATE TABLE IF NOT EXISTS search_events (
      id TEXT PRIMARY KEY, protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id), query_version_id TEXT NOT NULL REFERENCES query_versions(id),
      searched_at TEXT NOT NULL, destination TEXT NOT NULL, purpose TEXT NOT NULL, status TEXT NOT NULL, live_rerun_of TEXT,
      coverage_limits TEXT NOT NULL, adapter_code TEXT, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS corpus_snapshots (
      id TEXT PRIMARY KEY, search_event_id TEXT NOT NULL REFERENCES search_events(id), corpus_record_ids TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS citation_edges (
      id TEXT PRIMARY KEY, from_record_id TEXT NOT NULL REFERENCES corpus_records(id), to_record_id TEXT NOT NULL REFERENCES corpus_records(id),
      relation TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(from_record_id, to_record_id, relation)
    );
    CREATE TABLE IF NOT EXISTS screening_decisions (
      id TEXT PRIMARY KEY, corpus_record_id TEXT NOT NULL REFERENCES corpus_records(id), protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id),
      criterion_id TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT NOT NULL, superseded_by_decision_id TEXT,
      command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS eligibility_amendments (
      id TEXT PRIMARY KEY, from_protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id), to_protocol_version_id TEXT NOT NULL REFERENCES review_protocols(id),
      rationale TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS uncertainty_queue (
      id TEXT PRIMARY KEY, decision_id TEXT NOT NULL REFERENCES screening_decisions(id), corpus_record_id TEXT NOT NULL REFERENCES corpus_records(id),
      status TEXT NOT NULL, resolved_by_decision_id TEXT, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gap_assessments (
      id TEXT PRIMARY KEY, snapshot_id TEXT NOT NULL REFERENCES corpus_snapshots(id), query_version_ids TEXT NOT NULL, searched_at TEXT NOT NULL,
      proposition TEXT NOT NULL, status TEXT NOT NULL, qualifications TEXT NOT NULL, origin TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS contribution_proposals (
      id TEXT PRIMARY KEY, gap_id TEXT NOT NULL REFERENCES gap_assessments(id), proposition TEXT NOT NULL, qualifications TEXT NOT NULL,
      origin TEXT NOT NULL, command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS counter_searches (
      id TEXT PRIMARY KEY, gap_id TEXT NOT NULL REFERENCES gap_assessments(id), search_event_id TEXT NOT NULL REFERENCES search_events(id),
      contrary_record_ids TEXT NOT NULL, challenging_evidence_item_ids TEXT NOT NULL, status TEXT NOT NULL, qualification TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_literature_query_protocol ON query_versions(protocol_version_id);
    CREATE INDEX IF NOT EXISTS idx_literature_corpus_protocol ON corpus_records(protocol_version_id);
    CREATE INDEX IF NOT EXISTS idx_literature_screening_record ON screening_decisions(corpus_record_id);
    CREATE INDEX IF NOT EXISTS idx_literature_gaps_snapshot ON gap_assessments(snapshot_id);
  `);
}

export function createE11Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS analysis_operations (
      command_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      entity_id TEXT,
      result_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_operations_kind ON analysis_operations(kind);

    CREATE TABLE IF NOT EXISTS analysis_execution_policies (
      project_id TEXT PRIMARY KEY REFERENCES projects(id),
      mode TEXT NOT NULL,
      bash_guard TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_command_confirmations (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL,
      argv_digest TEXT NOT NULL,
      argv TEXT NOT NULL,
      mode TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(command_id, argv_digest)
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_confirmations_digest ON analysis_command_confirmations(argv_digest);

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      command_id TEXT NOT NULL UNIQUE,
      input_version_ids TEXT NOT NULL DEFAULT '[]',
      argv TEXT NOT NULL,
      argv_digest TEXT NOT NULL,
      cwd TEXT NOT NULL,
      script_version_id TEXT,
      command_or_script_version TEXT,
      parameters TEXT NOT NULL DEFAULT '{}',
      stdout_artifact_id TEXT REFERENCES artifact_versions(id),
      stderr_artifact_id TEXT REFERENCES artifact_versions(id),
      diagnostics TEXT NOT NULL DEFAULT '{}',
      environment TEXT NOT NULL DEFAULT '{}',
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      exit_code INTEGER,
      signal TEXT,
      repeatability TEXT NOT NULL DEFAULT 'reported',
      reproduced INTEGER NOT NULL DEFAULT 0 CHECK (reproduced IN (0, 1)),
      analysis_plan_id TEXT REFERENCES analysis_plans(id),
      protocol_version_id TEXT REFERENCES protocol_versions(id),
      activity TEXT,
      population TEXT,
      data_classes TEXT NOT NULL DEFAULT '[]',
      data_use TEXT,
      profile_id TEXT,
      confirmatory_or_exploratory TEXT,
      external_output_id TEXT,
      attribution TEXT NOT NULL DEFAULT 'human-stated',
      origin TEXT NOT NULL DEFAULT 'owner-recorded',
      started_at TEXT NOT NULL,
      ended_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_created ON analysis_runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_external ON analysis_runs(external_output_id);

    CREATE TABLE IF NOT EXISTS analysis_candidates (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      status TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_tool_probes (
      id TEXT PRIMARY KEY,
      tools TEXT NOT NULL,
      packages TEXT NOT NULL,
      results TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS analysis_diagnostics (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      profile_id TEXT,
      status TEXT NOT NULL,
      diagnostics TEXT NOT NULL,
      limitations TEXT NOT NULL,
      design_label TEXT,
      evidence_type TEXT,
      claim_type TEXT,
      identification_strategy TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_diagnostics_run ON analysis_diagnostics(run_id, created_at);

    CREATE TABLE IF NOT EXISTS external_analysis_outputs (
      id TEXT PRIMARY KEY,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      input_version_ids TEXT NOT NULL DEFAULT '[]',
      argv_digest TEXT,
      command_or_script_version TEXT,
      parameters TEXT NOT NULL DEFAULT '{}',
      authenticity TEXT NOT NULL DEFAULT 'reported' CHECK (authenticity = 'reported'),
      reproduced INTEGER NOT NULL DEFAULT 0 CHECK (reproduced = 0),
      source TEXT,
      notes TEXT,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_external_analysis_outputs_created ON external_analysis_outputs(created_at);

    CREATE TABLE IF NOT EXISTS analysis_quarantined_outputs (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES analysis_runs(id),
      stdout TEXT,
      stderr TEXT,
      reason TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

function ensureE10Column(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export function createE10Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ethics_operations (
      command_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      entity_id TEXT,
      result_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ethics_operations_kind ON ethics_operations(kind);

    CREATE TABLE IF NOT EXISTS risk_register_items (
      id TEXT PRIMARY KEY,
      activity TEXT NOT NULL,
      requirement_text TEXT NOT NULL,
      institution_or_community TEXT NOT NULL,
      evidence_version_ids TEXT NOT NULL,
      methodology_ref TEXT,
      residual_risk TEXT,
      mitigations TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'recorded',
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_risk_register_activity ON risk_register_items(activity);
    CREATE INDEX IF NOT EXISTS idx_risk_register_branch ON risk_register_items(branch_id);

    CREATE TABLE IF NOT EXISTS ethics_candidates (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      status TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ethics_candidates_kind ON ethics_candidates(kind);

    CREATE TABLE IF NOT EXISTS data_management_plans (
      id TEXT PRIMARY KEY,
      activity TEXT NOT NULL,
      data_classes TEXT NOT NULL,
      intended_destinations TEXT NOT NULL,
      purposes TEXT NOT NULL DEFAULT '[]',
      storage_location TEXT NOT NULL DEFAULT 'local',
      issues TEXT NOT NULL DEFAULT '[]',
      evidence_version_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      denied_destinations TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_dmp_activity ON data_management_plans(activity);
    CREATE INDEX IF NOT EXISTS idx_dmp_branch ON data_management_plans(branch_id);

    CREATE TABLE IF NOT EXISTS research_retention_plans (
      id TEXT PRIMARY KEY,
      activity TEXT NOT NULL,
      data_classes TEXT NOT NULL DEFAULT '[]',
      retain_until TEXT NOT NULL,
      destruction_intent TEXT NOT NULL,
      evidence_version_ids TEXT NOT NULL,
      status TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_retention_activity ON research_retention_plans(activity);
    CREATE INDEX IF NOT EXISTS idx_retention_branch ON research_retention_plans(branch_id);

    CREATE TABLE IF NOT EXISTS guidance_citations (
      id TEXT PRIMARY KEY,
      title TEXT,
      publisher TEXT NOT NULL,
      uri TEXT NOT NULL,
      retrieved_at TEXT NOT NULL,
      currency TEXT NOT NULL,
      summary TEXT NOT NULL,
      scope_note TEXT,
      jurisdiction TEXT,
      topic TEXT,
      evidence_version_ids TEXT NOT NULL DEFAULT '[]',
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_guidance_citations_uri ON guidance_citations(uri);

    CREATE TABLE IF NOT EXISTS consultation_limits (
      id TEXT PRIMARY KEY,
      activity TEXT NOT NULL,
      consulted_parties TEXT NOT NULL,
      questions_asked TEXT NOT NULL,
      claims_not_made TEXT NOT NULL,
      status TEXT NOT NULL,
      notes TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_consultation_limits_activity ON consultation_limits(activity);

    CREATE TABLE IF NOT EXISTS external_authorizations (
      id TEXT PRIMARY KEY,
      activities TEXT NOT NULL,
      population_or_data_use TEXT NOT NULL,
      applicability_basis TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_version_ids TEXT NOT NULL,
      expires_at TEXT,
      withdrawn_at TEXT,
      withdrawal_reason TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_authorizations_status ON external_authorizations(status);
  `);

  // E10 is additive while the project marker remains version 1. Existing ready
  // projects may have created the original tables before these contract fields.
  ensureE10Column(db, "data_management_plans", "purposes", "TEXT NOT NULL DEFAULT '[]'");
  ensureE10Column(db, "data_management_plans", "storage_location", "TEXT NOT NULL DEFAULT 'local'");
  ensureE10Column(db, "data_management_plans", "issues", "TEXT NOT NULL DEFAULT '[]'");
  ensureE10Column(db, "research_retention_plans", "data_classes", "TEXT NOT NULL DEFAULT '[]'");
  ensureE10Column(db, "guidance_citations", "title", "TEXT");
  ensureE10Column(db, "guidance_citations", "jurisdiction", "TEXT");
  ensureE10Column(db, "guidance_citations", "topic", "TEXT");
  ensureE10Column(db, "guidance_citations", "evidence_version_ids", "TEXT NOT NULL DEFAULT '[]'");
}

export function createE12Schema(db: DatabaseSync): void {
  configureDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS progress_operations (
      command_id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload_hash TEXT NOT NULL,
      status TEXT NOT NULL,
      entity_id TEXT,
      result_data TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_progress_operations_kind ON progress_operations(kind);

    CREATE TABLE IF NOT EXISTS protocol_versions (
      id TEXT PRIMARY KEY,
      version_label TEXT NOT NULL,
      procedure_text TEXT NOT NULL,
      rq_version_ids TEXT NOT NULL DEFAULT '[]',
      design_comparison_id TEXT,
      sampling_plan_id TEXT,
      analysis_plan_id TEXT,
      risk_register_item_ids TEXT NOT NULL DEFAULT '[]',
      authorization_id TEXT,
      activity TEXT,
      population TEXT,
      data_use TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_protocol_versions_branch ON protocol_versions(branch_id, status);

    CREATE TABLE IF NOT EXISTS progress_records (
      id TEXT PRIMARY KEY,
      protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
      summary TEXT NOT NULL,
      occurred_on TEXT,
      activity TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      retrospective INTEGER NOT NULL DEFAULT 0,
      corrects_progress_id TEXT REFERENCES progress_records(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_progress_records_protocol ON progress_records(protocol_version_id, created_at);

    CREATE TABLE IF NOT EXISTS reported_execution_evidence (
      id TEXT PRIMARY KEY,
      protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
      summary TEXT NOT NULL,
      evidence_version_ids TEXT NOT NULL DEFAULT '[]',
      reproduced INTEGER NOT NULL DEFAULT 0 CHECK (reproduced = 0),
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reported_execution_protocol ON reported_execution_evidence(protocol_version_id, created_at);

    CREATE TABLE IF NOT EXISTS progress_candidates (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL,
      specialist_role TEXT NOT NULL,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      status TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_progress_candidates_kind ON progress_candidates(kind);

    CREATE TABLE IF NOT EXISTS amendments (
      id TEXT PRIMARY KEY,
      from_protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
      successor_protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
      change_summary TEXT NOT NULL,
      population_changed INTEGER NOT NULL DEFAULT 0,
      data_use_changed INTEGER NOT NULL DEFAULT 0,
      activity TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_amendments_source ON amendments(from_protocol_version_id, branch_id);

    CREATE TABLE IF NOT EXISTS deviations (
      id TEXT PRIMARY KEY,
      protocol_version_id TEXT NOT NULL REFERENCES protocol_versions(id),
      summary TEXT NOT NULL,
      occurred_on TEXT,
      population_changed INTEGER NOT NULL DEFAULT 0,
      data_use_changed INTEGER NOT NULL DEFAULT 0,
      new_population TEXT,
      new_data_use TEXT,
      activity TEXT,
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_deviations_protocol ON deviations(protocol_version_id, branch_id);

    CREATE TABLE IF NOT EXISTS reported_prior_commitments (
      id TEXT PRIMARY KEY,
      statement TEXT NOT NULL,
      attributed_actor TEXT NOT NULL,
      source_artifact_version_id TEXT REFERENCES artifact_versions(id),
      source_kind TEXT NOT NULL,
      occurred_on TEXT,
      protocol_version_id TEXT REFERENCES protocol_versions(id),
      authenticity TEXT NOT NULL CHECK (authenticity = 'reported'),
      attribution TEXT NOT NULL,
      origin TEXT NOT NULL,
      artifact_version_id TEXT NOT NULL REFERENCES artifact_versions(id),
      command_id TEXT NOT NULL UNIQUE,
      branch_id TEXT NOT NULL REFERENCES branches(id),
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_reported_prior_commitments_branch ON reported_prior_commitments(branch_id, created_at);

    CREATE TRIGGER IF NOT EXISTS progress_records_insert_only_update
      BEFORE UPDATE ON progress_records
      BEGIN SELECT RAISE(ABORT, 'progress records are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS progress_records_insert_only_delete
      BEFORE DELETE ON progress_records
      BEGIN SELECT RAISE(ABORT, 'progress records are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS reported_execution_insert_only_update
      BEFORE UPDATE ON reported_execution_evidence
      BEGIN SELECT RAISE(ABORT, 'reported execution evidence is insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS reported_execution_insert_only_delete
      BEFORE DELETE ON reported_execution_evidence
      BEGIN SELECT RAISE(ABORT, 'reported execution evidence is insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS amendments_insert_only_delete
      BEFORE DELETE ON amendments
      BEGIN SELECT RAISE(ABORT, 'amendments are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS amendments_immutable_update
      BEFORE UPDATE ON amendments
      WHEN NEW.id IS NOT OLD.id
        OR NEW.from_protocol_version_id IS NOT OLD.from_protocol_version_id
        OR NEW.successor_protocol_version_id IS NOT OLD.successor_protocol_version_id
        OR NEW.change_summary IS NOT OLD.change_summary
        OR NEW.population_changed IS NOT OLD.population_changed
        OR NEW.data_use_changed IS NOT OLD.data_use_changed
        OR NEW.activity IS NOT OLD.activity
        OR NEW.attribution IS NOT OLD.attribution
        OR NEW.origin IS NOT OLD.origin
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.branch_id IS NOT OLD.branch_id
        OR NEW.created_at IS NOT OLD.created_at
        OR NOT (OLD.status = 'proposed' AND NEW.status IN ('adopted', 'superseded'))
      BEGIN SELECT RAISE(ABORT, 'amendments are immutable except for adoption status'); END;
    CREATE TRIGGER IF NOT EXISTS protocol_versions_immutable_update
      BEFORE UPDATE ON protocol_versions
      WHEN NEW.id IS NOT OLD.id
        OR NEW.version_label IS NOT OLD.version_label
        OR NEW.procedure_text IS NOT OLD.procedure_text
        OR NEW.rq_version_ids IS NOT OLD.rq_version_ids
        OR NEW.design_comparison_id IS NOT OLD.design_comparison_id
        OR NEW.sampling_plan_id IS NOT OLD.sampling_plan_id
        OR NEW.analysis_plan_id IS NOT OLD.analysis_plan_id
        OR NEW.risk_register_item_ids IS NOT OLD.risk_register_item_ids
        OR NEW.authorization_id IS NOT OLD.authorization_id
        OR NEW.activity IS NOT OLD.activity
        OR NEW.population IS NOT OLD.population
        OR NEW.data_use IS NOT OLD.data_use
        OR NEW.attribution IS NOT OLD.attribution
        OR NEW.origin IS NOT OLD.origin
        OR NEW.artifact_version_id IS NOT OLD.artifact_version_id
        OR NEW.command_id IS NOT OLD.command_id
        OR NEW.branch_id IS NOT OLD.branch_id
        OR NEW.created_at IS NOT OLD.created_at
        OR NOT (NEW.status = OLD.status OR (OLD.status = 'candidate' AND NEW.status = 'in-force') OR (OLD.status = 'in-force' AND NEW.status = 'superseded'))
      BEGIN SELECT RAISE(ABORT, 'protocol versions are immutable except for lifecycle status'); END;
    CREATE TRIGGER IF NOT EXISTS protocol_versions_insert_only_delete
      BEFORE DELETE ON protocol_versions
      BEGIN SELECT RAISE(ABORT, 'protocol versions are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS deviations_insert_only_update
      BEFORE UPDATE ON deviations
      BEGIN SELECT RAISE(ABORT, 'deviations are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS deviations_insert_only_delete
      BEFORE DELETE ON deviations
      BEGIN SELECT RAISE(ABORT, 'deviations are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS reported_prior_insert_only_update
      BEFORE UPDATE ON reported_prior_commitments
      BEGIN SELECT RAISE(ABORT, 'reported prior commitments are insert-only'); END;
    CREATE TRIGGER IF NOT EXISTS reported_prior_insert_only_delete
      BEFORE DELETE ON reported_prior_commitments
      BEGIN SELECT RAISE(ABORT, 'reported prior commitments are insert-only'); END;
  `);
  ensureE12Column(db, "deviations", "new_population", "TEXT");
  ensureE12Column(db, "deviations", "new_data_use", "TEXT");
}

function ensureE12Column(db: DatabaseSync, table: string, column: string, definition: string): void {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name?: unknown }>;
  if (!columns.some((entry) => entry.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
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
      createE05Schema(db);
      createE07Schema(db);
      createE08Schema(db);
      createE15Schema(db);
      createE16Schema(db);
      createE09Schema(db);
      createE10Schema(db);
      createE12Schema(db);
      createE11Schema(db);
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
