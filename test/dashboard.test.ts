import assert from "node:assert/strict";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { request as httpRequest } from "node:http";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { waitForApproval } from "../src/dashboard/approval.js";
import { readDashboard } from "../src/dashboard/data.js";
import { startDashboard } from "../src/dashboard/server.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

function seed(root: string): { store: WardenStore; ask: number } {
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  store.database.prepare("INSERT INTO sessions (session_id, source, agent, user_intent, untrusted, risk_budget, created_at, updated_at) VALUES ('cursor-42','cursor','cursor','',1,1.1,'now','now'), ('cline-later','cline','cline','',1,0,'now','now')").run();
  store.database.prepare("INSERT INTO trust_origins VALUES ('cursor-42','reading external result from github/get_issue issue #42',NULL,'now'), ('cline-later','read agents.md which cursor-42 wrote after reading external result from github/get_issue issue #42','cursor-42','now')").run();
  store.database.prepare("INSERT INTO actions (session_id,source,agent,kind,tool,target,content_preview,content_hash,untrusted_input,created_at) VALUES ('cline-later','cline','cline','write','write_to_file','AGENTS.md','', 'hash',1,'now')").run();
  const action = Number(store.database.prepare("SELECT last_insert_rowid() AS id").get()?.id);
  store.database.prepare(`INSERT INTO decisions (action_id,verdict,reason,labels_json,action_probability,session_budget,risk_backend,risk_questions_json,created_at,risk_latency_ms)
    VALUES (?, 'ask', 'Review AGENTS.md', '["control-file"]',0.25,1.1,'heuristic','{"injection":0.25}','now',2)`).run(action);
  return { store, ask: Number(store.database.prepare("SELECT last_insert_rowid() AS id").get()?.id) };
}

async function access(server: Awaited<ReturnType<typeof startDashboard>>, endpoint: string, options: RequestInit = {}): Promise<Response> {
  return fetch(new URL(endpoint, server.url), options);
}

test("live dashboard shows persisted decisions, taint chain, risk, and pending approvals", async () => {
  const root = tempWorkspace();
  const { store, ask } = seed(root);
  const server = await startDashboard(root);
  try {
    assert.equal(new URL(server.url).hostname, "127.0.0.1");
    const page = await (await access(server, "/")).text();
    assert.match(page, /WARDEN/);
    assert.match(page, /Human approval/);
    assert.match(page, /Respond/);
    const marker = JSON.parse((await import("node:fs")).readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string };
    const approval = waitForApproval(root, ask, { timeoutMs: 1500, pollMs: 20 });
    let snapshot: ReturnType<typeof readDashboard>;
    for (let n = 0; n < 30; n++) {
      snapshot = readDashboard(root);
      if (snapshot.approvals.length) break;
      await new Promise((done) => setTimeout(done, 20));
    }
    snapshot = readDashboard(root);
    assert.equal(snapshot.approvals.length, 1);
    assert.match(String(snapshot.sessions.find((session) => session.id === "cline-later")?.originReason), /issue #42/);
    assert.equal(snapshot.decisions[0]?.backend, "heuristic");
    assert.equal(snapshot.decisions[0]?.latencyMs, 2);
    const state = await access(server, "/api/state", { headers: { "x-warden-token": marker.token } });
    assert.equal(state.status, 200);
    const id = String(snapshot.approvals[0]?.id);
    const clicked = await access(server, `/api/approvals/${id}`, {
      method: "POST", headers: { "x-warden-token": marker.token, "content-type": "application/json", origin: server.url.slice(0, -1) },
      body: JSON.stringify({ choice: "approved" }),
    });
    assert.equal(clicked.status, 200);
    assert.equal((await approval).status, "approved");
    assert.equal((await access(server, `/api/approvals/${id}`, { method: "POST", headers: {
      "x-warden-token": marker.token, "content-type": "application/json", origin: server.url.slice(0, -1),
    }, body: '{"choice":"approved"}' })).status, 409);
  } finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("approval endpoint rejects cross-site, unauthenticated, bad-host, late, and invalid choices", async () => {
  const root = tempWorkspace();
  const { store, ask } = seed(root);
  const server = await startDashboard(root);
  try {
    const marker = JSON.parse((await import("node:fs")).readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string };
    const id = randomUUID();
    store.database.prepare("INSERT INTO approvals (id, decision_id, status, expires_at) VALUES (?, ?, 'pending', ?)")
      .run(id, ask, new Date(Date.now() + 1000).toISOString());
    const post = (headers: Record<string, string>, payload = '{"choice":"approved"}') => access(server, `/api/approvals/${id}`, {
      method: "POST", headers, body: payload,
    });
    const local = server.url.slice(0, -1);
    assert.equal((await post({ origin: local, "content-type": "application/json" })).status, 403);
    assert.equal((await post({ origin: "https://attacker.invalid", "content-type": "application/json", "x-warden-token": marker.token })).status, 403);
    assert.equal((await post({ "content-type": "application/json", "x-warden-token": marker.token })).status, 403);
    assert.equal((await post({ origin: local, "content-type": "text/plain", "x-warden-token": marker.token })).status, 403);
    assert.equal((await post({ origin: local, "content-type": "application/json", "x-warden-token": marker.token }, '{"choice":"other"}')).status, 400);
    const badHost = await new Promise<number>((resolve, reject) => {
      const req = httpRequest({ hostname: "127.0.0.1", port: server.port, path: "/api/state", headers: {
        host: `attacker.invalid:${server.port}`, "x-warden-token": marker.token,
      } }, (response) => { response.resume(); resolve(response.statusCode ?? 0); });
      req.once("error", reject);
      req.end();
    });
    assert.equal(badHost, 403);
    assert.equal(store.database.prepare("SELECT status FROM approvals WHERE id=?").get(id)?.status, "pending");
    store.database.prepare("UPDATE approvals SET expires_at=? WHERE id=?").run(new Date(Date.now() - 100).toISOString(), id);
    assert.equal((await post({ origin: local, "content-type": "application/json", "x-warden-token": marker.token })).status, 409);
    assert.equal(store.database.prepare("SELECT status FROM approvals WHERE id=?").get(id)?.status, "pending");
  } finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("waiter denies immediately without dashboard and expires with no answer", async () => {
  const root = tempWorkspace();
  const { store, ask } = seed(root);
  const started = performance.now();
  try {
    const absent = await waitForApproval(root, ask);
    assert.equal(absent.status, "denied");
    assert.match(absent.reason, /start warden dashboard/);
    assert.ok(performance.now() - started < 500);
    assert.equal(store.database.prepare("SELECT COUNT(*) AS count FROM approvals").get()?.count, 0);
    const server = await startDashboard(root);
    try {
      const expired = await waitForApproval(root, ask, { timeoutMs: 110, pollMs: 15 });
      assert.equal(expired.status, "expired");
      assert.equal(store.database.prepare("SELECT status FROM approvals WHERE id=?").get(expired.id)?.status, "expired");
    } finally { await server.close(); }
    assert.equal(existsSync(path.join(root, ".warden", "dashboard.json")), false);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("incident responder seam requires authorization, origin, a real report, and an injected callback", async () => {
  const root = tempWorkspace();
  const { store } = seed(root);
  const { mkdirSync, writeFileSync, readFileSync } = await import("node:fs");
  mkdirSync(path.join(root, ".warden", "incidents"));
  writeFileSync(path.join(root, ".warden", "incidents", "incident_demo.md"), "# Private incident\n");
  const observed: string[] = [];
  const server = await startDashboard(root, { onRespond: (name) => { observed.push(name); } });
  try {
    const token = (JSON.parse(readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string }).token;
    const state = readDashboard(root);
    assert.equal(state.incidents[0]?.name, "incident_demo.md");
    assert.ok(!JSON.stringify(state).includes("Private incident"));
    assert.equal((await access(server, "/api/incidents/incident_demo.md/respond", { method: "POST", body: "{}" })).status, 403);
    assert.equal((await access(server, "/api/incidents/incident_demo.md/respond", {
      method: "POST", headers: { origin: server.url.slice(0, -1), "content-type": "application/json", "x-warden-token": token }, body: "{}",
    })).status, 200);
    assert.deepEqual(observed, ["incident_demo.md"]);
  } finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});