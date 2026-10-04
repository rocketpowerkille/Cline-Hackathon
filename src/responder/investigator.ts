import { createHash } from "node:crypto";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type {
  ActionSummary,
  GrantSummary,
  Investigation,
  RunTicketSummary,
  SessionSummary,
  TaintedFileSummary,
} from "./types.js";

export function investigateIncident(
  database: DatabaseSync,
  workspaceRoot: string,
  sessionId: string,
  trigger: string,
): Investigation {
  if (!sessionId.trim()) throw new Error("Responder session ID is required");
  const sessionIds = traceOrigins(database, sessionId);
  const sessions = sessionIds.map((id) => readSession(database, id));
  const actions = readActions(database, sessionIds);
  const taintedFiles = readTaintedFiles(database, workspaceRoot, sessionIds, actions);
  const grants = readGrants(database, sessionIds);
  return {
    sessionId,
    trigger,
    sessions,
    actions,
    taintedFiles,
    grants,
    runTickets: readRunTickets(database, sessionIds),
    // Grants, not placeholders or tickets, prove that a real key reached this process session.
    exposedKeys: [...new Set(grants.filter((grant) => grant.sessionId === sessionId).map((grant) => grant.keyName))].sort(),
    generatedAt: new Date().toISOString(),
  };
}

function traceOrigins(database: DatabaseSync, sessionId: string): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  let current: string | null = sessionId;
  while (current && !seen.has(current)) {
    seen.add(current);
    ids.push(current);
    const row: Record<string, unknown> | undefined = database
      .prepare("SELECT origin_session FROM trust_origins WHERE session_id = ?")
      .get(current);
    current = row?.origin_session === undefined || row.origin_session === null ? null : String(row.origin_session);
  }
  return ids.reverse();
}

function readSession(database: DatabaseSync, sessionId: string): SessionSummary {
  const row = database.prepare(`
    SELECT s.session_id, s.source, s.agent, s.user_intent, s.untrusted,
           o.reason AS origin_reason, o.origin_session
    FROM sessions s
    LEFT JOIN trust_origins o ON o.session_id = s.session_id
    WHERE s.session_id = ?
  `).get(sessionId);
  if (!row) throw new Error(`Session not found in Warden ledger: ${sessionId}`);
  return {
    sessionId: String(row.session_id),
    source: String(row.source),
    agent: String(row.agent),
    userIntent: String(row.user_intent),
    untrusted: Boolean(row.untrusted),
    originReason: row.origin_reason === null || row.origin_reason === undefined ? null : String(row.origin_reason),
    originSession: row.origin_session === null || row.origin_session === undefined ? null : String(row.origin_session),
  };
}

function readActions(database: DatabaseSync, sessionIds: readonly string[]): ActionSummary[] {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  return database.prepare(`
    SELECT a.id, a.session_id, a.source, a.agent, a.kind, a.tool, a.target,
           a.content_preview, a.created_at, d.verdict, d.reason, d.labels_json
    FROM actions a
    LEFT JOIN decisions d ON d.action_id = a.id
    WHERE a.session_id IN (${placeholders})
    ORDER BY a.id
  `).all(...sessionIds).map((row) => ({
    id: Number(row.id),
    sessionId: String(row.session_id),
    source: String(row.source),
    agent: String(row.agent),
    kind: String(row.kind),
    tool: String(row.tool),
    target: String(row.target),
    preview: String(row.content_preview),
    verdict: row.verdict === null || row.verdict === undefined ? null : String(row.verdict),
    reason: row.reason === null || row.reason === undefined ? null : String(row.reason),
    labels: parseStringArray(row.labels_json),
    createdAt: String(row.created_at),
  }));
}

function readTaintedFiles(
  database: DatabaseSync,
  workspaceRoot: string,
  sessionIds: readonly string[],
  actions: readonly ActionSummary[],
): TaintedFileSummary[] {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  return database.prepare(`
    SELECT path_key, writer_session, reason, snapshot_path, existed_before, created_at
    FROM tainted_files
    WHERE writer_session IN (${placeholders})
    ORDER BY created_at, path_key
  `).all(...sessionIds).map((row) => {
    const key = String(row.path_key);
    return {
      path: key,
      writerSession: String(row.writer_session),
      reason: String(row.reason),
      snapshotPath: row.snapshot_path === null ? null : String(row.snapshot_path),
      existedBefore: Boolean(row.existed_before),
      createdAt: String(row.created_at),
      expectedCurrentHash: expectedFileHash(database, workspaceRoot, key, sessionIds, actions),
    };
  });
}

function expectedFileHash(
  database: DatabaseSync,
  workspaceRoot: string,
  key: string,
  sessionIds: readonly string[],
  _actions: readonly ActionSummary[],
): string | null {
  const normalized = normalizeKey(key);
  const taint = database.prepare("SELECT writer_session, created_at FROM tainted_files WHERE path_key = ?").get(key);
  if (!taint) return null;
  const allWrites = database.prepare(`
    SELECT id, session_id, tool, target, content_hash, created_at
    FROM actions
    WHERE kind = 'write'
    ORDER BY id
  `).all().filter((row) => normalizeKey(relativeTarget(workspaceRoot, String(row.target))) === normalized);
  const laterWrite = allWrites.some((row) => String(row.created_at) > String(taint.created_at));
  if (laterWrite) return null;
  const initial = allWrites.filter((row) => String(row.session_id) === String(taint.writer_session)
    && String(row.created_at) <= String(taint.created_at)).at(-1);
  if (!initial || !["write_to_file", "new_rule", "Write", "write"].includes(String(initial.tool))) return null;
  return String(initial.content_hash);
}

function readGrants(database: DatabaseSync, sessionIds: readonly string[]): GrantSummary[] {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  return database.prepare(`
    SELECT session_id, name, granted_at
    FROM vault_grants
    WHERE session_id IN (${placeholders})
    ORDER BY granted_at, name
  `).all(...sessionIds).map((row) => ({
    sessionId: String(row.session_id),
    keyName: String(row.name),
    grantedAt: String(row.granted_at),
  }));
}

function readRunTickets(database: DatabaseSync, sessionIds: readonly string[]): RunTicketSummary[] {
  if (!sessionIds.length) return [];
  const placeholders = sessionIds.map(() => "?").join(",");
  return database.prepare(`
    SELECT id, session_id, command_json, key_names_json, consumed_at, created_at
    FROM vault_run_tickets
    WHERE session_id IN (${placeholders})
    ORDER BY created_at
  `).all(...sessionIds).map((row) => ({
    id: String(row.id),
    sessionId: String(row.session_id),
    command: parseStringArray(row.command_json),
    keyNames: parseStringArray(row.key_names_json),
    consumed: row.consumed_at !== null,
    createdAt: String(row.created_at),
  }));
}

function parseStringArray(value: unknown): string[] {
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function relativeTarget(root: string, target: string): string {
  if (!target) return "";
  const resolved = path.isAbsolute(target) ? target : path.resolve(root, target);
  return path.relative(root, resolved);
}

export function normalizeKey(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
}

export function hashFileContent(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}