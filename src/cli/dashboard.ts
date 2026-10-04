import { startDashboard, type DashboardServer } from "../dashboard/server.js";

/** Standalone command for the CLI dispatcher to call after parallel branches merge. */
export async function dashboard(root: string, output: Pick<NodeJS.WritableStream, "write"> = process.stdout): Promise<DashboardServer> {
  const server = await startDashboard(root, { port: 8765 });
  output.write(`Warden dashboard: ${server.url}\n`);
  return server;
}