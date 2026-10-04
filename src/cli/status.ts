import { existsSync } from "node:fs";
import { wardenStatePath } from "../core/paths.js";
import { WardenStore } from "../store/database.js";

/** Read-only summary; do not create a ledger merely by asking for status. */
export function status(root: string): string {
  const file = wardenStatePath(root, "warden.db");
  if (!existsSync(file)) return "Warden ledger not initialized.\n";
  const store = new WardenStore(file);
  try {
    const count = (table: string): number => Number(store.database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n ?? 0);
    return `Sessions: ${count("sessions")}\nDecisions: ${count("decisions")}\nSandbox runs: ${count("sandbox_runs")}\n`;
  } finally { store.close(); }
}