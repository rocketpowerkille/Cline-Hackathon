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
