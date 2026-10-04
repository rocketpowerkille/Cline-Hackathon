import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { AgentAction, Decision } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";
import { migrations, schemaVersion } from "../src/store/schema.js";

const action: AgentAction = {
  source: "replay",
  sessionId: "session-1",
  agent: "test-agent",
  kind: "exec",
  tool: "shell",
  target: "npm test",
  content: "NPM_TOKEN=obviously-fake-token",
  untrustedInput: false,
  userIntent: "Run tests",
};

const decision: Decision = {
  verdict: "allow",
  reason: "Allowed for test.",
  labels: [],
  risk: {
    actionProbability: 0,
    sessionBudget: 0,
    backend: "none",
    questions: { injection: 0, secrets: 0, destructive: 0, offIntent: 0 },
  },
};

test("migrations upgrade a version-1 database with existing rows and vault tables", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "warden-migrate-"));
  const file = path.join(dir, "warden.db");
  try {
    // A Segment 00/01 ledger plus vault tables the vault module used to self-create.
    const old = new DatabaseSync(file);
    old.exec(migrations[0]!);
    old.exec("PRAGMA user_version = 1");
    old.exec("CREATE TABLE vault_entries (name TEXT PRIMARY KEY, placeholder TEXT NOT NULL UNIQUE, source_path TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)");
    old.exec("INSERT INTO vault_entries VALUES ('NPM_TOKEN', 'p', '.env', 'now', 'now')");
    old.exec("INSERT INTO sessions VALUES ('old', 'cline', 'cline', '', 0, NULL, 0, 'now', 'now')");
    old.close();

    const store = new WardenStore(file);
    const version = store.database.prepare("PRAGMA user_version").get() as { user_version: number };
    assert.equal(version.user_version, schemaVersion);
    assert.deepEqual(store.vaultSourcePaths(), [".env"]);
    assert.equal((store.database.prepare("SELECT COUNT(*) AS n FROM sessions").get() as { n: number }).n, 1);
    store.record(action, decision);
    store.close();

    // Reopening is a no-op.
    new WardenStore(file).close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("store records a redacted action and decision in one ledger", () => {
  const store = new WardenStore(":memory:");
  const ids = store.record(action, decision);

  assert.equal(ids.actionId, 1);
  assert.equal(ids.decisionId, 1);
  const savedDecision = store.database.prepare("SELECT verdict FROM decisions").get() as { verdict: string };
  const savedAction = store.database.prepare("SELECT content_preview FROM actions").get() as {
    content_preview: string;
  };
  assert.equal(savedDecision.verdict, "allow");
  assert.equal(savedAction.content_preview, "NPM_TOKEN=[REDACTED]");
  store.close();
});