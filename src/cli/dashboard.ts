import { startDashboard, type DashboardServer } from "../dashboard/server.js";
import { incidentSession } from "../dashboard/data.js";
import { DatabaseSync } from "node:sqlite";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { mockProviders } from "../responder/providers.js";
import { respondDeterministically } from "../responder/runbook.js";

/** Standalone command for the CLI dispatcher to call after parallel branches merge. */
export async function dashboard(root: string, output: Pick<NodeJS.WritableStream, "write"> = process.stdout): Promise<DashboardServer> {
  const server = await startDashboard(root, { port: 8765, onRespond: async (name) => {
    let session = incidentSession(name);
    if (!session) {
      const folder = path.join(root, ".warden", "incidents");
      if (!/^incident_[a-z\d._-]+\.md$/i.test(name)) throw new Error("Invalid incident");
      for (const entry of (await import("node:fs")).readdirSync(folder)) {
        if (!/^response_[a-z\d_.-]+\.json$/i.test(entry)) continue;
        try {
          const state = JSON.parse(readFileSync(path.join(folder, entry), "utf8")) as { sessionId: string; reportPath: string };
          if (path.basename(state.reportPath) === name) { session = state.sessionId; break; }
        } catch { /* Ignore invalid responder state. */ }
      }
    }
    if (!session || !existsSync(path.join(root, ".warden", "warden.db"))) throw new Error("Incident session not found");
    const db = new DatabaseSync(path.join(root, ".warden", "warden.db"));
    try {
      await respondDeterministically({ workspaceRoot: root, database: db, sessionId: session,
        trigger: "dashboard response to blocked session", providers: mockProviders() });
    } finally { db.close(); }
  } });
  output.write(`Warden dashboard: ${server.url}\n`);
  return server;
}