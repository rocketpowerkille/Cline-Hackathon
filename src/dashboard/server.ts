import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { wardenStatePath } from "../core/paths.js";
import { resolveApproval } from "./approval.js";
import { readDashboard } from "./data.js";
import { dashboardPage } from "./page.js";

export interface DashboardServer { port: number; url: string; close(): Promise<void> }
const headers = { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-frame-options": "DENY" };
const markerMatches = (marker: string, token: string): boolean => {
  try { return (JSON.parse(readFileSync(marker, "utf8")) as { token?: string }).token === token; }
  catch { return false; }
};

function send(response: ServerResponse, code: number, body: string, type = "application/json", extra: Record<string, string> = {}): void {
  response.writeHead(code, { ...headers, "content-type": type, ...extra });
  response.end(body);
}

function sameHost(request: IncomingMessage, port: number): boolean {
  return request.headers.host === `127.0.0.1:${port}` && request.socket.remoteAddress === "127.0.0.1";
}

async function body(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) {
    text += String(chunk);
    if (text.length > 2048) throw new Error("request too large");
  }
  return JSON.parse(text) as unknown;
}

/** Local-only dashboard server. Never expose this process as a LAN service or public reverse proxy. */
export async function startDashboard(root: string, options: { port?: number; onRespond?: (reportName: string) => Promise<void> | void } = {}): Promise<DashboardServer> {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(16).toString("base64");
  const marker = wardenStatePath(root, "dashboard.json");
  if (existsSync(marker)) {
    try {
      const value = JSON.parse(readFileSync(marker, "utf8")) as { port: number; token: string };
      if (Number.isInteger(value.port) && value.port > 0 && value.port <= 65535 && /^[a-f0-9]{64}$/i.test(value.token)) {
        const live = await fetch(`http://127.0.0.1:${value.port}/internal/health`, {
          headers: { "x-warden-token": value.token }, signal: AbortSignal.timeout(300),
        });
        if (live.ok) throw new Error("Warden dashboard is already running for this workspace.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Warden dashboard is already")) throw error;
    }
  }
  let port = 0;
  const server: Server = createServer(async (request, response) => {
    try {
      if (!sameHost(request, port)) return send(response, 403, '{"error":"forbidden host"}');
      const route = new URL(request.url ?? "/", `http://127.0.0.1:${port}`).pathname;
      const origin = `http://127.0.0.1:${port}`;
      if (request.headers.origin && request.headers.origin !== origin) return send(response, 403, '{"error":"forbidden origin"}');
      if (request.method === "GET" && route === "/") return send(response, 200, dashboardPage(token, nonce, !!options.onRespond), "text/html; charset=utf-8", {
        "content-security-policy": `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      });
      if (request.headers["x-warden-token"] !== token) return send(response, 403, '{"error":"unauthorized"}');
      if (request.method === "GET" && route === "/internal/health") return send(response, 200, '{"ok":true}');
      if (request.method === "GET" && route === "/api/state") return send(response, 200, JSON.stringify(readDashboard(root)));
      const match = /^\/api\/approvals\/([a-f\d-]{36})$/i.exec(route);
      if (request.method === "POST" && match) {
        if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json")
          return send(response, 403, '{"error":"invalid origin or content type"}');
        const input = await body(request);
        if (!input || typeof input !== "object" || !("choice" in input) ||
          (input.choice !== "approved" && input.choice !== "denied")) return send(response, 400, '{"error":"invalid choice"}');
        const db = new DatabaseSync(wardenStatePath(root, "warden.db"));
        db.exec("PRAGMA busy_timeout=1000; PRAGMA foreign_keys=ON;");
        try {
          const changed = resolveApproval(db, match[1]!, input.choice);
          return send(response, changed ? 200 : 409, JSON.stringify({ resolved: changed }));
        } finally { db.close(); }
      }
      const incident = /^\/api\/incidents\/(incident_[a-z\d_-]+\.(?:json|md))\/respond$/i.exec(route);
      if (request.method === "POST" && incident) {
        if (request.headers.origin !== origin || request.headers["content-type"] !== "application/json")
          return send(response, 403, '{"error":"invalid origin or content type"}');
        if (!options.onRespond) return send(response, 501, '{"error":"responder not connected"}');
        const file = wardenStatePath(root, "incidents", incident[1]!);
        if (!existsSync(file) || !lstatSync(file).isFile() || !realpathSync(file).startsWith(realpathSync(wardenStatePath(root, "incidents")) + (process.platform === "win32" ? "\\" : "/")))
          return send(response, 404, '{"error":"incident not found"}');
        const input = await body(request);
        if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length)
          return send(response, 400, '{"error":"invalid request"}');
        await options.onRespond(incident[1]!);
        return send(response, 200, '{"responded":true}');
      }
      return send(response, 404, '{"error":"not found"}');
    } catch { return send(response, 500, '{"error":"dashboard unavailable"}'); }
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port ?? 0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Could not determine dashboard port");
    port = address.port;
    mkdirSync(wardenStatePath(root), { recursive: true });
    // Exclusive creation prevents a second dashboard from silently replacing the live service marker.
    try { writeFileSync(marker, JSON.stringify({ port, token }), { mode: 0o600, flag: "wx" }); }
    catch { throw new Error("Dashboard marker already exists; remove a stale marker after verifying no dashboard is running."); }
    return { port, url: `http://127.0.0.1:${port}/`, close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      try {
        if (markerMatches(marker, token)) rmSync(marker);
      } catch { /* Marker was already removed. */ }
    } };
  } catch (error) { server.close(); throw error; }
}