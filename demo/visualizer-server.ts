import { createServer } from "node:http";
import { visualizerPage, visualizerScript, visualizerStyle } from "./visualizer-page.js";
import type { VisualizerReplay } from "./visualizer-model.js";
import { capabilityCatalog } from "./capabilities-model.js";
import { capabilitiesPage, capabilitiesScript, capabilitiesStyle, capabilitiesRecordingStyle } from "./capabilities-page.js";

/** Read-only presentation server. No repository, vault, approval, or execution endpoints. */
export async function startVisualizer(replay: VisualizerReplay, port = 0): Promise<{ url: string; close(): Promise<void> }> {
  let boundPort = 0;
  const routes: Record<string, [string, string]> = {
    "/": ["text/html; charset=utf-8", visualizerPage],
    "/style.css": ["text/css; charset=utf-8", visualizerStyle],
    "/app.js": ["text/javascript; charset=utf-8", visualizerScript],
    "/api/replay": ["application/json; charset=utf-8", JSON.stringify(replay)],
    "/capabilities": ["text/html; charset=utf-8", capabilitiesPage],
    "/capabilities.css": ["text/css; charset=utf-8", capabilitiesStyle + capabilitiesRecordingStyle],
    "/capabilities.js": ["text/javascript; charset=utf-8", capabilitiesScript],
    "/api/capabilities": ["application/json; charset=utf-8", JSON.stringify(capabilityCatalog)],
  };
  const server = createServer((request, response) => {
    const origin = `http://127.0.0.1:${boundPort}`;
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("X-Content-Type-Options", "nosniff");
    response.setHeader("Referrer-Policy", "no-referrer");
    response.setHeader("X-Frame-Options", "DENY");
    response.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
    if (request.headers.host !== `127.0.0.1:${boundPort}` || request.socket.remoteAddress !== "127.0.0.1" ||
        (request.headers.origin && request.headers.origin !== origin) || request.headers["sec-fetch-site"] === "cross-site") {
      response.writeHead(403).end("Forbidden host or origin");
      return;
    }
    if (request.method !== "GET") {
      response.setHeader("Allow", "GET");
      response.writeHead(405).end("Read-only demo viewer");
      return;
    }
    const route = routes[new URL(request.url ?? "/", origin).pathname];
    if (!route) { response.writeHead(404).end("Not found"); return; }
    response.setHeader("Content-Type", route[0]);
    response.writeHead(200).end(route[1]);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => { server.off("error", reject); resolve(); });
  });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("No visualizer port"); }
  boundPort = address.port;
  return {
    url: `http://127.0.0.1:${boundPort}/`,
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}