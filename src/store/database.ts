import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { AgentAction, Decision, StoredDecision } from "../core/types.js";
import type { SandboxResult } from "../sandbox/shadow.js";
import { scanWardenCanaries } from "../vault/canary.js";
import { migrate } from "./schema.js";

const PREVIEW_LIMIT = 240;
const redact = (value: string): string => scanWardenCanaries(value).length || /(?:bearer\s+\S+|(?:token|secret|password|key)\s*[=:]\s*\S+|(?:ghp_|github_pat_|sk-|npm_)[\w-]{12,})/i.test(value)
  ? "[REDACTED]" : value.replace(/https?:\/\/[^\s/]+(?:\/[^\s]*)?/gi, (url) => {
    try { return new URL(url).origin; } catch { return "[URL]"; }
  }).slice(0, 200);
const safeList = (values: string[]): string => JSON.stringify(values.slice(0, 30).map(redact));

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

  sessionOrigin(sessionId: string): { reason: string; originSession: string | null } | null {
    const row = this.database.prepare("SELECT reason, origin_session FROM trust_origins WHERE session_id = ?").get(sessionId);
    return row ? { reason: String(row.reason), originSession: row.origin_session === null ? null : String(row.origin_session) } : null;
  }

  fileOrigin(key: string): { reason: string; writerSession: string; snapshotPath: string | null; existedBefore: boolean } | null {
    const row = this.database.prepare("SELECT reason, writer_session, snapshot_path, existed_before FROM tainted_files WHERE path_key = ?").get(key);
    return row ? {
      reason: String(row.reason), writerSession: String(row.writer_session),
      snapshotPath: row.snapshot_path === null ? null : String(row.snapshot_path), existedBefore: Boolean(row.existed_before),
    } : null;
  }

  markUntrusted(sessionId: string, reason: string, originSession: string | null): void {
    this.database.prepare("UPDATE sessions SET untrusted = 1, tainted_by_session = COALESCE(tainted_by_session, ?), updated_at = ? WHERE session_id = ?")
      .run(originSession, new Date().toISOString(), sessionId);
    this.database.prepare("INSERT OR IGNORE INTO trust_origins (session_id, reason, origin_session, created_at) VALUES (?, ?, ?, ?)")
      .run(sessionId, reason, originSession, new Date().toISOString());
  }

  markFile(key: string, writerSession: string, reason: string, snapshotPath: string | null, existedBefore: boolean): void {
    this.database.prepare("INSERT OR IGNORE INTO tainted_files (path_key, writer_session, reason, snapshot_path, existed_before, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(key, writerSession, reason, snapshotPath, existedBefore ? 1 : 0, new Date().toISOString());
  }

  recordObservation(sessionId: string, tool: string, target: string, output: string, flagged: boolean): void {
    this.database.prepare("INSERT INTO injection_observations (session_id, tool, target, output_hash, flagged, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(sessionId, tool, target, createHash("sha256").update(output).digest("hex"), flagged ? 1 : 0, new Date().toISOString());
  }

  sessionBudget(sessionId: string): number {
    return Number((this.database.prepare("SELECT risk_budget FROM sessions WHERE session_id = ?").get(sessionId)?.risk_budget ?? 0));
  }

  sessionIntent(sessionId: string): string {
    return String(this.database.prepare("SELECT user_intent FROM sessions WHERE session_id = ?").get(sessionId)?.user_intent ?? "");
  }

  recordSandboxRun(ids: StoredDecision, result: SandboxResult, durationMs: number): void {
    const evidence = result.evidence;
    this.database.prepare(`INSERT INTO sandbox_runs (action_id, decision_id, backend, verdict, reason, labels_json,
      inspected_files_json, changed_files_json, secret_files_json, canaries_count, network_attempts_json,
      control_files_json, exit_code, timed_out, duration_ms, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(ids.actionId, ids.decisionId, evidence.backend, result.verdict, redact(result.reason), safeList(evidence.labels),
        safeList(evidence.inspectedFiles), safeList(evidence.changedFiles), safeList(evidence.secretFiles), evidence.canaries.length,
        safeList(evidence.networkAttempts), safeList(evidence.controlFiles), evidence.exitCode, evidence.timedOut ? 1 : 0,
        Math.max(0, Math.round(durationMs)), new Date().toISOString());
  }

  /** Resolve the already-recorded ask in place; keep its action, risk budget, and approval FK intact. */
  finalizeApproval(decisionId: number, decision: Decision): void {
    this.database.prepare("UPDATE decisions SET verdict=?, reason=?, labels_json=? WHERE id=? AND verdict='ask'")
      .run(decision.verdict, decision.reason, JSON.stringify(decision.labels), decisionId);
  }

  finalizeDecisionLabels(decisionId: number, labels: string[]): void {
    this.database.prepare("UPDATE decisions SET labels_json=? WHERE id=?").run(JSON.stringify(labels), decisionId);
  }

  markApprovedActionUntrusted(actionId: number): void {
    this.database.prepare("UPDATE actions SET untrusted_input=1 WHERE id=?").run(actionId);
  }

  record(action: AgentAction, decision: Decision, budgetIncrement = 0, onBudget?: (total: number) => void): StoredDecision {
    const now = new Date().toISOString();
    const transaction = this.database.prepare("BEGIN IMMEDIATE");
    const commit = this.database.prepare("COMMIT");
    const rollback = this.database.prepare("ROLLBACK");

    transaction.run();
    try {
      // Reserve the writer lock before looking at the session budget: concurrent hook processes
      // cannot both make their threshold decision from the same pre-increment value.
      const currentBudget = Number(this.database.prepare("SELECT risk_budget FROM sessions WHERE session_id=?")
        .get(action.sessionId)?.risk_budget ?? 0);
      onBudget?.(currentBudget + budgetIncrement);
      this.database.prepare(`
        INSERT INTO sessions (
          session_id, source, agent, user_intent, untrusted, created_at, updated_at, risk_budget
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET
          source = excluded.source,
          agent = excluded.agent,
          user_intent = CASE
            WHEN excluded.user_intent = '' THEN sessions.user_intent
            ELSE excluded.user_intent
          END,
          untrusted = MAX(sessions.untrusted, excluded.untrusted),
          risk_budget = sessions.risk_budget + ?,
          updated_at = excluded.updated_at
      `).run(
        action.sessionId,
        action.source,
        action.agent,
        action.userIntent,
        action.untrustedInput ? 1 : 0,
        now,
        now,
        budgetIncrement,
        budgetIncrement,
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
          session_budget, risk_backend, risk_questions_json, created_at, risk_latency_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
        decision.risk.latencyMs ?? 0,
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