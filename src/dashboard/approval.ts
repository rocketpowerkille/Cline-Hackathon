import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { wardenStatePath } from "../core/paths.js";

export type ApprovalStatus = "approved" | "denied" | "expired";
export interface ApprovalResult { id: string | null; status: ApprovalStatus; reason: string }
const CHECK_MS = 100;
export const APPROVAL_WAIT_MS = 20_000;

/** Atomic one-shot transition. The expiry check is in SQL, so even a stale dashboard cannot approve late. */
export function resolveApproval(db: DatabaseSync, id: string, choice: "approved" | "denied"): boolean {
  if (!/^[a-f0-9-]{36}$/i.test(id)) return false;
  const result = db.prepare(`UPDATE approvals SET status=?, resolved_at=?, resolved_by='dashboard'
    WHERE id=? AND status='pending' AND expires_at > ?`).run(choice, new Date().toISOString(), id, new Date().toISOString());
  return Number(result.changes) === 1;
}

export async function waitForApproval(
  root: string, decisionId: number, options: { timeoutMs?: number; pollMs?: number; now?: () => number } = {},
): Promise<ApprovalResult> {
  const file = wardenStatePath(root, "warden.db");
  const service = wardenStatePath(root, "dashboard.json");
  // Service presence is proven by a short authenticated loopback request, not a stale marker alone.
  let address: { port: number; token: string };
  try {
    if (!existsSync(file) || !existsSync(service)) throw new Error("missing dashboard");
    address = JSON.parse(readFileSync(service, "utf8")) as { port: number; token: string };
    if (!Number.isInteger(address.port) || address.port < 1 || address.port > 65535 || !/^[a-f0-9]{64}$/i.test(address.token)) throw new Error("invalid dashboard marker");
    const response = await fetch(`http://127.0.0.1:${address.port}/internal/health`, {
      headers: { "x-warden-token": address.token }, signal: AbortSignal.timeout(400),
    });
    if (!response.ok) throw new Error("unavailable dashboard");
  } catch {
    return { id: null, status: "denied", reason: "Approval denied: start warden dashboard to review this action." };
  }
  const now = options.now ?? Date.now;
  const timeout = Math.min(20_000, Math.max(1, options.timeoutMs ?? APPROVAL_WAIT_MS));
  const id = randomUUID();
  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout = 1000; PRAGMA foreign_keys = ON;");
    const decision = db.prepare("SELECT id FROM decisions WHERE id=? AND verdict='ask'").get(decisionId);
    if (!decision) return { id: null, status: "denied", reason: "Approval denied: decision is not a pending ask." };
    const expires = now() + timeout;
    db.prepare("INSERT INTO approvals (id, decision_id, status, expires_at) VALUES (?, ?, 'pending', ?)")
      .run(id, decisionId, new Date(expires).toISOString());
    while (now() < expires) {
      const row = db.prepare("SELECT status FROM approvals WHERE id=?").get(id);
      if (row?.status === "approved" || row?.status === "denied") {
        return { id, status: row.status, reason: row.status === "approved" ? "Approved in Warden dashboard." : "Denied in Warden dashboard." };
      }
      await new Promise((done) => setTimeout(done, Math.min(options.pollMs ?? CHECK_MS, Math.max(1, expires - now()))));
    }
    db.prepare(`UPDATE approvals SET status='expired', resolved_at=?, resolved_by='timeout'
      WHERE id=? AND status='pending'`).run(new Date().toISOString(), id);
    // A click racing the timer must not be turned into a denial.
    const final = db.prepare("SELECT status FROM approvals WHERE id=?").get(id)?.status;
    return { id, status: final === "approved" ? "approved" : final === "denied" ? "denied" : "expired",
      reason: final === "approved" ? "Approved in Warden dashboard." : "Approval denied: 20-second dashboard timeout." };
  } catch {
    return { id: null, status: "denied", reason: "Approval denied: dashboard approval ledger unavailable." };
  } finally { db?.close(); }
}