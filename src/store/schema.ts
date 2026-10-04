export const schema = `
  PRAGMA foreign_keys = ON;

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

  PRAGMA user_version = 1;
`;