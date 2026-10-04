import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentAction, Decision, StoredDecision } from "../core/types.js";
import { migrate } from "./schema.js";

const PREVIEW_LIMIT = 240;

export class WardenStore {
  readonly database: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ":memory:") mkdirSync(path.dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    // Cline and Cursor hooks run as concurrent processes against one ledger.
    this.database.exec("PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;");
    migrate(this.database);
  }

  /** Environment files the vault has seeded, as stored (relative to the protected repository). */
  vaultSourcePaths(): string[] {
    return this.database
      .prepare("SELECT DISTINCT source_path FROM vault_entries WHERE source_path IS NOT NULL")
      .all()
      .map((row) => String(row.source_path));
  }

  close(): void {
    this.database.close();
  }

  record(action: AgentAction, decision: Decision): StoredDecision {
    const now = new Date().toISOString();
    const transaction = this.database.prepare("BEGIN");
    const commit = this.database.prepare("COMMIT");
    const rollback = this.database.prepare("ROLLBACK");

    transaction.run();
    try {
      this.database.prepare(`
        INSERT INTO sessions (
          session_id, source, agent, user_intent, untrusted, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          source = excluded.source,
          agent = excluded.agent,
          user_intent = CASE
            WHEN excluded.user_intent = '' THEN sessions.user_intent
            ELSE excluded.user_intent
          END,
          untrusted = MAX(sessions.untrusted, excluded.untrusted),
          updated_at = excluded.updated_at
      `).run(
        action.sessionId,
        action.source,
        action.agent,
        action.userIntent,
        action.untrustedInput ? 1 : 0,
        now,
        now,
      );

      const actionResult = this.database.prepare(`
        INSERT INTO actions (
          session_id, source, agent, kind, tool, target, content_preview,
          content_hash, untrusted_input, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        action.sessionId,
        action.source,
        action.agent,
        action.kind,
        action.tool,
        action.target,
        redactPreview(action.content),
        createHash("sha256").update(action.content).digest("hex"),
        action.untrustedInput ? 1 : 0,
        now,
      );

      const decisionResult = this.database.prepare(`
        INSERT INTO decisions (
          action_id, verdict, reason, labels_json, action_probability,
          session_budget, risk_backend, risk_questions_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        actionResult.lastInsertRowid,
        decision.verdict,
        decision.reason,
        JSON.stringify(decision.labels),
        decision.risk.actionProbability,
        decision.risk.sessionBudget,
        decision.risk.backend,
        JSON.stringify(decision.risk.questions),
        now,
      );

      commit.run();
      return {
        actionId: Number(actionResult.lastInsertRowid),
        decisionId: Number(decisionResult.lastInsertRowid),
      };
    } catch (error) {
      rollback.run();
      throw error;
    }
  }
}

function redactPreview(content: string): string {
  return content
    .replace(/\b([A-Za-z_][A-Za-z0-9_]*(?:TOKEN|SECRET|KEY|PASSWORD)[A-Za-z0-9_]*)\s*=\s*[^\s]+/gi, "$1=[REDACTED]")
    .slice(0, PREVIEW_LIMIT);
}