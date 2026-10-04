import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { wardenStatePath } from "../core/paths.js";

const privateValue = /__WARDEN_CANARY__[\w]+__[a-f0-9]{24}__|(?:bearer\s+\S+)|(?:[\w]*(?:token|secret|password|api[_-]?key)[\w]*\s*[=:]\s*)[^\s"']+|(?:ghp_|github_pat_|sk-|npm_)[\w-]{12,}/gi;
export function display(value: unknown): string {
  return String(value ?? "").replace(privateValue, "[REDACTED]")
    .replace(/https?:\/\/[^\s"']+/gi, (url) => { try { return new URL(url).origin; } catch { return "[URL]"; } })
    .slice(0, 450);
}

const strings = (value: unknown): string[] => {
  try { const parsed: unknown = JSON.parse(String(value)); return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string").map(display) : []; }
  catch { return []; }
};

export interface DashboardSnapshot {
  decisions: Record<string, unknown>[];
  sessions: Record<string, unknown>[];
  approvals: Record<string, unknown>[];
  incidents: { name: string; sessionId: string | null; status: string }[];
}

export function readDashboard(root: string, now = Date.now()): DashboardSnapshot {
  const empty: DashboardSnapshot = { decisions: [], sessions: [], approvals: [], incidents: [] };
  const filename = wardenStatePath(root, "warden.db");
  if (existsSync(filename)) {
    const db = new DatabaseSync(filename, { readOnly: true });
    try {
      empty.sessions = db.prepare(`SELECT s.session_id, s.source, s.agent, s.untrusted, s.risk_budget,
        o.reason AS origin_reason, o.origin_session
        FROM sessions s LEFT JOIN trust_origins o ON o.session_id=s.session_id
        ORDER BY s.updated_at DESC`).all().map((row) => ({
        id: display(row.session_id), source: display(row.source), agent: display(row.agent),
        untrusted: Boolean(row.untrusted), budget: Number(row.risk_budget),
        originReason: display(row.origin_reason), originSession: row.origin_session === null ? null : display(row.origin_session),
      }));
      empty.decisions = db.prepare(`SELECT d.id, d.verdict, d.reason, d.labels_json, d.action_probability, d.session_budget,
        d.risk_backend, d.risk_questions_json, d.risk_latency_ms, d.created_at,
        a.session_id, a.source, a.kind, a.tool, a.target,
        b.backend AS sandbox_backend, b.verdict AS sandbox_verdict, b.inspected_files_json,
        b.changed_files_json, b.network_attempts_json, b.control_files_json, b.canaries_count
        FROM decisions d JOIN actions a ON a.id=d.action_id
        LEFT JOIN sandbox_runs b ON b.decision_id=d.id ORDER BY d.id DESC`).all().map((row) => ({
        id: Number(row.id), verdict: display(row.verdict), reason: display(row.reason), labels: strings(row.labels_json),
        probability: Number(row.action_probability), budget: Number(row.session_budget), backend: display(row.risk_backend),
        latencyMs: Number(row.risk_latency_ms), questions: safeQuestions(row.risk_questions_json), at: display(row.created_at),
        sessionId: display(row.session_id), source: display(row.source), kind: display(row.kind), tool: display(row.tool), target: display(row.target),
        sandbox: row.sandbox_backend === null ? null : {
          backend: display(row.sandbox_backend), verdict: display(row.sandbox_verdict), read: strings(row.inspected_files_json),
          changed: strings(row.changed_files_json), network: strings(row.network_attempts_json),
          control: strings(row.control_files_json), canaries: Number(row.canaries_count),
        },
      }));
      empty.approvals = db.prepare(`SELECT p.id, p.status, p.expires_at, d.reason, d.verdict,
        a.session_id, a.kind, a.tool, a.target FROM approvals p
        JOIN decisions d ON d.id=p.decision_id JOIN actions a ON a.id=d.action_id
        WHERE p.status='pending' AND p.expires_at > ? ORDER BY p.expires_at ASC LIMIT 100`).all(new Date(now).toISOString()).map((row) => ({
        id: String(row.id), status: display(row.status), expiresAt: String(row.expires_at),
        remainingMs: Math.max(0, Date.parse(String(row.expires_at)) - now), reason: display(row.reason),
        sessionId: display(row.session_id), kind: display(row.kind), tool: display(row.tool), target: display(row.target),
      }));
    } finally { db.close(); }
  }
  const incidentsDir = wardenStatePath(root, "incidents");
  if (existsSync(incidentsDir)) {
    empty.incidents = readdirSync(incidentsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && /^incident_[a-z\d_-]+\.(?:json|md)$/i.test(entry.name))
      .map((entry) => {
        const stateName = entry.name.replace(/^incident_/, "response_").replace(/\.md$/i, ".json");
        const stateFile = wardenStatePath(root, "incidents", stateName);
        let status = "Report available";
        if (existsSync(stateFile) && lstatSync(stateFile).isFile()) {
          try {
            const state = JSON.parse(readFileSync(stateFile, "utf8")) as { closed?: unknown };
            status = state.closed === true ? "Closed" : "Open / review needed";
          } catch { /* Invalid responder state is never trusted. */ }
        }
        return { name: entry.name, sessionId: null, status };
      });
  }
  return empty;
}

function safeQuestions(value: unknown): Record<string, number> {
  try {
    const input: unknown = JSON.parse(String(value));
    if (!input || typeof input !== "object") return {};
    return Object.fromEntries(Object.entries(input).filter(([key, number]) =>
      ["injection", "secrets", "destructive", "offIntent"].includes(key) && typeof number === "number" && Number.isFinite(number)));
  } catch { return {}; }
}