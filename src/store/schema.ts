import type { DatabaseSync } from "node:sqlite";

/**
 * Ordered schema migrations. Index i upgrades `user_version` i -> i + 1.
 * Never edit a shipped migration; append a new one instead.
 * IF NOT EXISTS lets databases created by older self-initializing modules upgrade cleanly.
 */
export const migrations: readonly string[] = [
  // 1: ledger
  `
  CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    agent TEXT NOT NULL,
    user_intent TEXT NOT NULL DEFAULT '',
    untrusted INTEGER NOT NULL DEFAULT 0,
    tainted_by_session TEXT,
    risk_budget REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS actions (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    source TEXT NOT NULL,
    agent TEXT NOT NULL,
    kind TEXT NOT NULL,
    tool TEXT NOT NULL,
    target TEXT NOT NULL,
    content_preview TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    untrusted_input INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id),
    verdict TEXT NOT NULL,
    reason TEXT NOT NULL,
    labels_json TEXT NOT NULL,
    action_probability REAL NOT NULL,
    session_budget REAL NOT NULL,
    risk_backend TEXT NOT NULL,
    risk_questions_json TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS approvals (
    id TEXT PRIMARY KEY,
    decision_id INTEGER NOT NULL REFERENCES decisions(id),
    status TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    resolved_at TEXT,
    resolved_by TEXT
  );
  `,
  // 2: secret vault metadata (names and canaries only, never secret values)
  `
  CREATE TABLE IF NOT EXISTS vault_entries (
    name TEXT PRIMARY KEY,
    placeholder TEXT NOT NULL UNIQUE,
    source_path TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS vault_grants (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL,
    name TEXT NOT NULL REFERENCES vault_entries(name),
    granted_at TEXT NOT NULL
  );
  `,
  // 3: single-use, command-bound tickets for `warden run`
  `
  CREATE TABLE IF NOT EXISTS vault_run_tickets (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    command_json TEXT NOT NULL,
    selection_json TEXT NOT NULL,
    key_names_json TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    consumed_at TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS vault_run_tickets_lookup
  ON vault_run_tickets(command_json, selection_json, consumed_at, expires_at);
  `,
  // 4: durable cross-session provenance and first pre-taint recovery baseline
  `
  CREATE TABLE IF NOT EXISTS trust_origins (
    session_id TEXT PRIMARY KEY REFERENCES sessions(session_id),
    reason TEXT NOT NULL,
    origin_session TEXT,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS tainted_files (
    path_key TEXT PRIMARY KEY,
    writer_session TEXT NOT NULL REFERENCES sessions(session_id),
    reason TEXT NOT NULL,
    snapshot_path TEXT,
    existed_before INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS injection_observations (
    id INTEGER PRIMARY KEY,
    session_id TEXT NOT NULL REFERENCES sessions(session_id),
    tool TEXT NOT NULL,
    target TEXT NOT NULL,
    output_hash TEXT NOT NULL,
    flagged INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  `,
  // 5: redacted sandbox evidence and risk inference latency
  `
  CREATE TABLE IF NOT EXISTS sandbox_runs (
    id INTEGER PRIMARY KEY,
    action_id INTEGER NOT NULL REFERENCES actions(id),
    decision_id INTEGER NOT NULL REFERENCES decisions(id),
    backend TEXT NOT NULL,
    verdict TEXT NOT NULL,
    reason TEXT NOT NULL,
    labels_json TEXT NOT NULL,
    inspected_files_json TEXT NOT NULL,
    changed_files_json TEXT NOT NULL,
    secret_files_json TEXT NOT NULL,
    canaries_count INTEGER NOT NULL,
    network_attempts_json TEXT NOT NULL,
    control_files_json TEXT NOT NULL,
    exit_code INTEGER,
    timed_out INTEGER NOT NULL,
    duration_ms INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sandbox_runs_decision ON sandbox_runs(decision_id);
  ALTER TABLE decisions ADD COLUMN risk_latency_ms INTEGER NOT NULL DEFAULT 0;
  `,
];

export const schemaVersion = migrations.length;

function userVersion(database: DatabaseSync): number {
  const row = database.prepare("PRAGMA user_version").get() as { user_version: number };
  return Number(row.user_version);
}

/**
 * Brings a database up to `schemaVersion`. Idempotent and safe across concurrent hook
 * processes: each step takes the write lock and re-reads the version before applying.
 * A database from a newer Warden (higher version) is left untouched.
 */
export function migrate(database: DatabaseSync): void {
  database.exec("PRAGMA foreign_keys = ON;");
  while (userVersion(database) < schemaVersion) {
    database.exec("BEGIN IMMEDIATE");
    try {
      const version = userVersion(database);
      if (version < schemaVersion) {
        database.exec(migrations[version]!);
        database.exec(`PRAGMA user_version = ${version + 1}`);
      }
      database.exec("COMMIT");
    } catch (error) {
      if (database.isTransaction) database.exec("ROLLBACK");
      throw error;
    }
  }
}
