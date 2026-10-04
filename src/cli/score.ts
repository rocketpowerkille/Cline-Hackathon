import { existsSync } from "node:fs";
import { wardenStatePath } from "../core/paths.js";
import { WardenStore } from "../store/database.js";
import { ASK_BUDGET, BLOCK_BUDGET } from "../policy/risk.js";

/** Risk budgets by session; never print raw action content or model state. */
export function score(root: string, sessionId?: string): string {
  const file = wardenStatePath(root, "warden.db");
  if (!existsSync(file)) return "No sessions scored.\n";
  const store = new WardenStore(file);
  try {
    const rows = sessionId ? store.database.prepare("SELECT session_id, risk_budget FROM sessions WHERE session_id = ?").all(sessionId)
      : store.database.prepare("SELECT session_id, risk_budget FROM sessions ORDER BY updated_at DESC LIMIT 20").all();
    return rows.length ? rows.map((row) => `${row.session_id}: ${Number(row.risk_budget).toFixed(3)} (ask ${ASK_BUDGET}, block ${BLOCK_BUDGET})\n`).join("") : "No sessions scored.\n";
  } finally { store.close(); }
}