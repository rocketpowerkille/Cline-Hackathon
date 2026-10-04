import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { incidentName, readDashboard } from "../src/dashboard/data.js";
import { startDashboard } from "../src/dashboard/server.js";
import { dashboard } from "../src/cli/dashboard.js";
import { runCli } from "../src/cli/warden.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";
import { PassThrough } from "node:stream";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const action = (sessionId: string, kind: AgentAction["kind"], target: string, content = ""): AgentAction => ({
  source: "cline", sessionId, agent: "cline", kind, tool: kind === "exec" ? "execute_command" : "write_to_file",
  target, content, untrustedInput: false, userIntent: "test",
});

async function click(root: string, url: string, id: string, choice: "approved" | "denied") {
  const token = (JSON.parse(readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string }).token;
  const result = await fetch(new URL(`/api/approvals/${id}`, url), { method: "POST", headers: {
    origin: url.slice(0, -1), "content-type": "application/json", "x-warden-token": token,
  }, body: JSON.stringify({ choice }) });
  assert.equal(result.status, 200);
}

async function pending(root: string): Promise<string> {
  for (let n = 0; n < 50; n++) {
    const row = readDashboard(root).approvals[0];
    if (row) return String(row.id);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("approval did not appear");
}

test("engine approval loop: allow, deny, timeout, and run ticket only after approval", async () => {
  const root = tempWorkspace();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  const server = await startDashboard(root);
  const tickets: string[] = [];
  const engine = new Engine(store, { workspaceRoot: root, vault: { issueRunTicket: (session) => { tickets.push(session); return "ticket"; } },
    stages: { guardrails: (candidate) => candidate.kind === "exec" ? [{ label: "test-approval", verdict: "ask", reason: "Approve execution." }] : [] } });
  try {
    const allowed = engine.decide(action("approved", "exec", "warden run -- echo safe"));
    const allowedId = await pending(root);
    assert.deepEqual(tickets, []);
    assert.equal(store.database.prepare("SELECT verdict FROM decisions ORDER BY id DESC LIMIT 1").get()?.verdict, "ask");
    await click(root, server.url, allowedId, "approved");
    assert.equal((await allowed).verdict, "allow");
    assert.deepEqual(tickets, ["approved"]);
    assert.equal(store.database.prepare("SELECT verdict FROM decisions ORDER BY id DESC LIMIT 1").get()?.verdict, "allow");

    const denied = engine.decide(action("denied", "exec", "warden run -- echo safe"));
    const deniedId = await pending(root);
    await click(root, server.url, deniedId, "denied");
    assert.equal((await denied).verdict, "block");
    assert.deepEqual(tickets, ["approved"]);
    assert.equal(store.database.prepare("SELECT verdict FROM decisions ORDER BY id DESC LIMIT 1").get()?.verdict, "block");

    const timeoutEngine = new Engine(store, { workspaceRoot: root, approval: async (workspace, id) => {
      const { waitForApproval } = await import("../src/dashboard/approval.js");
      return waitForApproval(workspace, id, { timeoutMs: 85, pollMs: 10 });
    }, stages: { guardrails: () => [{ verdict: "ask", label: "control-file", reason: "Approval required." }] } });
    const expired = await timeoutEngine.decide(action("timed-out", "write", "AGENTS.md", "text"));
    assert.equal(expired.verdict, "block");
    assert.ok(expired.labels.includes("approval:expired"));
    assert.equal(store.database.prepare("SELECT verdict FROM decisions ORDER BY id DESC LIMIT 1").get()?.verdict, "block");
    assert.equal(readDashboard(root).approvals.length, 0);
  } finally { await server.close(); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("blocked sandbox session appears without a report; dashboard respond closes and exposes the report", async () => {
  const root = tempWorkspace();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  const engine = new Engine(store, { workspaceRoot: root, stages: { guardrails: () => [{ verdict: "sandbox", label: "untrusted-exec", reason: "Inspect." }],
    sandbox: () => ({ verdict: "block", reason: "Blocked outbound attempt.", evidence: { backend: "static", inspectedFiles: ["setup.sh"],
      changedFiles: [], secretFiles: [], tokenReferences: [], canaries: [], networkAttempts: ["https://example.invalid"],
      controlFiles: [], obfuscation: [], outsideWorkspace: [], exitCode: null, timedOut: false, executionError: null, labels: ["sandbox:network"] } }) } });
  try {
    assert.equal((await engine.decide(action("incident-session", "exec", "sh setup.sh"))).verdict, "block");
    const before = readDashboard(root).incidents.find((item) => item.sessionId === "incident-session");
    assert.equal(before?.status, "Open / respond needed");
    assert.equal(before?.report, null);
    assert.equal(before?.name, incidentName("incident-session"));
    const server = await dashboard(root, { write: () => true });
    try {
      const token = (JSON.parse(readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string }).token;
      const response = await fetch(new URL(`/api/incidents/${before!.name}/respond`, server.url), { method: "POST", headers: {
        origin: server.url.slice(0, -1), "content-type": "application/json", "x-warden-token": token,
      }, body: "{}" });
      assert.equal(response.status, 200);
      const after = readDashboard(root).incidents.find((item) => item.sessionId === "incident-session");
      assert.equal(after?.status, "Closed");
      assert.ok(after?.report);
      assert.ok(existsSync(path.join(root, ".warden", "incidents", after!.report!)));
      const report = await fetch(new URL(`/api/reports/${after!.report}`, server.url), { headers: { "x-warden-token": token } });
      assert.equal(report.status, 200);
      assert.match(await report.text(), /Sandbox evidence[\s\S]*setup\.sh/);
      assert.equal((await fetch(new URL(`/api/reports/${after!.report}`, server.url))).status, 403);
    } finally { await server.close(); }
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("canary-only blocks are open incidents and root respond closes them without SDK credentials", async () => {
  const root = tempWorkspace();
  const original = process.cwd();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  const engine = new Engine(store, { workspaceRoot: root });
  const output = new PassThrough();
  const io = { stdin: new PassThrough(), stdout: output, stderr: output, promptSecret: async () => "" };
  try {
    const blocked = await engine.decide(action("canary-only", "write", "output.txt", "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__"));
    assert.equal(blocked.verdict, "block");
    const open = readDashboard(root).incidents.find((entry) => entry.sessionId === "canary-only");
    assert.equal(open?.status, "Open / respond needed");
    process.chdir(root);
    assert.equal(await runCli(["respond", "--session", "canary-only", "--deterministic"], io,
      () => { throw new Error("respond must not open the vault or keychain"); }), 0);
    assert.match(String(output.read()), /^CLOSED /);
    const closed = readDashboard(root).incidents.find((entry) => entry.sessionId === "canary-only");
    assert.equal(closed?.status, "Closed");
    assert.ok(closed?.report);
    const report = readFileSync(path.join(root, ".warden", "incidents", closed!.report!), "utf8");
    assert.match(report, /No real credential grants were recorded; no key rotation was required/);
    assert.doesNotMatch(report, /All recorded exposed keys were rotated/);
  } finally { process.chdir(original); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("production responder refuses to claim an exposed credential was rotated by a mock", async () => {
  const root = tempWorkspace();
  const previous = process.cwd();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  const output = new PassThrough();
  const io = { stdin: new PassThrough(), stdout: output, stderr: output, promptSecret: async () => "" };
  try {
    await new Engine(store, { workspaceRoot: root }).decide(action("real-key", "read", "README.md"));
    store.database.prepare("INSERT INTO vault_entries (name,placeholder,source_path,created_at,updated_at) VALUES ('NPM_TOKEN','canary',NULL,'now','now')").run();
    store.database.prepare("INSERT INTO vault_grants (session_id,name,granted_at) VALUES ('real-key','NPM_TOKEN','now')").run();
    process.chdir(root);
    assert.equal(await runCli(["respond", "--session", "real-key", "--deterministic"], io), 2);
    assert.match(String(output.read()), /OPEN [^\n]+\nCRITICAL NO PROVIDER: NPM_TOKEN/);
    const state = JSON.parse(readFileSync(path.join(root, ".warden", "incidents", "response_real-key.json"), "utf8")) as { closed: boolean };
    assert.equal(state.closed, false);
  } finally { process.chdir(previous); store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("root warden dashboard starts a local server and removes its marker on shutdown", async () => {
  const root = tempWorkspace();
  const entry = fileURLToPath(new URL("../src/cli/warden.ts", import.meta.url));
  const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), entry, "dashboard"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, WARDEN_RISK_OFFLINE: "1" },
  });
  let output = "";
  let errors = "";
  child.stdout?.on("data", (chunk: Buffer) => { output += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { errors += chunk.toString(); });
  try {
    for (let i = 0; i < 100 && !output.includes("Warden dashboard:") && child.exitCode === null; i++) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.match(output, /Warden dashboard: http:\/\/127\.0\.0\.1:8765\//, errors);
    const marker = JSON.parse(readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { port: number; token: string };
    const health = await fetch(`http://127.0.0.1:${marker.port}/internal/health`, { headers: { "x-warden-token": marker.token } });
    assert.equal(health.status, 200);
  } finally {
    child.kill();
    if (child.exitCode === null) await Promise.race([
      new Promise<void>((resolve) => child.once("exit", () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1200)),
    ]);
    rmSync(root, { recursive: true, force: true });
  }
});
