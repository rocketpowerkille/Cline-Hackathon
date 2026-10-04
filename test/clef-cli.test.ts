import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkClef } from "../src/cli/clef.js";
import { clefTimeout } from "../src/policy/risk.js";
import { RiskScorer } from "../src/policy/risk.js";
import { Engine } from "../src/core/engine.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";
import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const answer = (p: number) => ({ type: "noul", noul: p });

test("CLEF check sends a harmless four-question System One request and requires local Ollama", async () => {
  let calls = 0;
  const transport: typeof fetch = async (url, init) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:11434/v1/systemone");
    const request = JSON.parse(String(init?.body)) as {
      model: string; state: string; questions: Record<string, { type: string; criteria: Record<string, string> }>;
      keep_alive: string;
    };
    assert.equal(request.model, "clef-flash");
    assert.equal(init?.redirect, "error");
    assert.equal(request.keep_alive, "5m");
    assert.ok(!String(init?.body).includes("NPM_TOKEN"));
    assert.deepEqual(Object.keys(request.questions), ["injection", "secrets", "destructive", "offIntent"]);
    for (const q of Object.values(request.questions)) {
      assert.equal(q.type, "noul");
      assert.deepEqual(Object.keys(q.criteria).sort(), ["false", "true"]);
    }
    return { ok: true, json: async () => ({ answers: {
      injection: answer(0.01), secrets: answer(0.02), destructive: answer(0.03), offIntent: answer(0.04),
    } }) } as Response;
  };
  const result = await checkClef({ fetch: transport, env: { WARDEN_RISK_OFFLINE: "0" } }, undefined, "ollama");
  assert.equal(result.ok, true);
  assert.match(result.message, /backend=ollama/);
  assert.equal(calls, 1);
});

test("CLEF check fails honestly when offline, local model is absent, or its answers are malformed", async () => {
  assert.equal((await checkClef({ env: { WARDEN_RISK_OFFLINE: "1" } })).ok, false);
  const absent = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0" }, fetch: async () => { throw new Error("offline"); } }, undefined, "ollama");
  assert.equal(absent.ok, false);
  assert.match(absent.message, /connection error/);
  const invalid = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0", CLOUDFLARE_ACCOUNT_ID: "test", CLOUDFLARE_AUTH_TOKEN: "fake" },
    fetch: async (url) => {
      assert.match(String(url), /^http:\/\/127\.0\.0\.1:/, "diagnostic must not send data to Cloudflare");
      return { ok: true, json: async () => ({ answers: { injection: answer(0.1) } }) } as Response;
    } }, undefined, "ollama");
  assert.equal(invalid.ok, false);
  assert.match(invalid.message, /invalid answers/);
  const missingModel = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0" }, fetch: async () => ({ ok: false, status: 404 }) as Response }, undefined, "ollama");
  assert.equal(missingModel.ok, false);
  assert.match(missingModel.message, /http error/);
});

test("root Warden CLI dispatches the local CLEF diagnostic without opening the vault", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "warden-clef-command-"));
  try {
    const entry = fileURLToPath(new URL("../bin/warden.mjs", import.meta.url));
    const result = spawnSync(process.execPath, [entry, "clef", "check"], {
      cwd: root, encoding: "utf8", timeout: 10_000,
      env: { ...process.env, WARDEN_RISK_OFFLINE: "1" },
    });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /CLEF disabled by WARDEN_RISK_OFFLINE=1/);
    assert.equal(existsSync(path.join(root, ".warden")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("Cloudflare diagnostic refuses missing credentials without probing Ollama", async () => {
  let calls = 0;
  const result = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0" }, fetch: async () => {
    calls++;
    throw new Error("No endpoint should be reached");
  } });
  assert.equal(result.ok, false);
  assert.match(result.message, /Cloudflare CLEF not configured/);
  assert.equal(calls, 0);
});

test("Cloudflare diagnostic verifies four answers with no Ollama call and no ledger writes", async () => {
  const urls: string[] = [];
  const result = await checkClef({ env: {
    CLOUDFLARE_ACCOUNT_ID: "demo", CLOUDFLARE_API_TOKEN: "fake", WARDEN_ENABLE_OLLAMA: "1", WARDEN_RISK_OFFLINE: "0",
  }, fetch: async (input, init) => {
    urls.push(String(input));
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer fake");
    assert.doesNotMatch(String(init?.body), /NPM_TOKEN|fake/);
    return { ok: true, json: async () => ({ result: { answers: Object.fromEntries(
      ["injection", "secrets", "destructive", "offIntent"].map((key) => [key, answer(0.01)])) } }) } as Response;
  } });
  assert.equal(result.ok, true);
  assert.match(result.message, /backend=cloudflare/);
  assert.equal(urls.length, 1);
  assert.match(urls[0]!, /@cf\/cloudflare\/clef-flash$/);
});

test("local CLEF check explicitly opts into Ollama without leaking configured Cloudflare credentials", async () => {
  const urls: string[] = [];
  const checked = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0", CLOUDFLARE_ACCOUNT_ID: "demo", CLOUDFLARE_API_TOKEN: "fake" },
    fetch: async (input, init) => {
      urls.push(String(input));
      assert.doesNotMatch(JSON.stringify(init), /fake/);
      return { ok: true, json: async () => ({ answers: Object.fromEntries(
        ["injection", "secrets", "destructive", "offIntent"].map((key) => [key, { type: "noul", noul: 0.01 }])) }) } as Response;
    } }, undefined, "ollama");
  assert.equal(checked.ok, true);
  assert.deepEqual(urls, ["http://127.0.0.1:11434/v1/systemone"]);
});

test("hook inference timeout has a safe configurable bound", () => {
  assert.equal(clefTimeout({}), 350);
  assert.equal(clefTimeout({ WARDEN_CLEF_TIMEOUT_MS: "1200" }), 1200);
  assert.equal(clefTimeout({ WARDEN_CLEF_TIMEOUT_MS: "0" }), 350);
  assert.equal(clefTimeout({ WARDEN_CLEF_TIMEOUT_MS: "6000" }), 350);
  assert.equal(clefTimeout({ WARDEN_CLEF_TIMEOUT_MS: "n/a" }), 350);
});

test("engine records a CLEF-backed decision and its four typed answers", async () => {
  const root = tempWorkspace();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  const transport: typeof fetch = async (_url, init) => {
    const input = JSON.parse(String(init?.body)) as { model: string; questions: Record<string, unknown> };
    assert.equal(input.model, "clef-flash");
    assert.equal(Object.keys(input.questions).length, 4);
    return { ok: true, json: async () => ({ model: "clef-flash", answers: {
      injection: answer(0.1), secrets: answer(0.05), destructive: answer(0.02), offIntent: answer(0.03),
    } }) } as Response;
  };
  const scorer = new RiskScorer({ fetch: transport, env: { WARDEN_RISK_OFFLINE: "0", WARDEN_ENABLE_OLLAMA: "1" } });
  try {
    const engine = new Engine(store, { workspaceRoot: root, stages: { risk: (action, intent) => scorer.score(action, intent, root) } });
    const decision = await engine.decide({ source: "replay", sessionId: "clef-engine", agent: "test", kind: "write",
      tool: "write_to_file", target: "demo.txt", content: "Hello World", userIntent: "Write a greeting", untrustedInput: false });
    assert.equal(decision.verdict, "allow");
    assert.equal(decision.risk.backend, "ollama");
    assert.ok(decision.risk.actionProbability > 0.1);
    const saved = store.database.prepare("SELECT risk_backend, risk_questions_json, session_budget, risk_latency_ms FROM decisions LIMIT 1").get();
    assert.equal(saved?.risk_backend, "ollama");
    assert.deepEqual(JSON.parse(String(saved?.risk_questions_json)), {
      injection: 0.1, secrets: 0.05, destructive: 0.02, offIntent: 0.03,
    });
    assert.equal(saved?.session_budget, decision.risk.sessionBudget);
    assert.ok(Number(saved?.risk_latency_ms) >= 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("CLEF diagnostic uses real HTTP transport against an in-process loopback System One endpoint", async () => {
  let requests = 0;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => { body += chunk.toString(); });
    request.on("end", () => {
      requests++;
      assert.equal(request.url, "/v1/systemone");
      const payload = JSON.parse(body) as { model: string; questions: Record<string, unknown> };
      assert.equal(payload.model, "clef-flash");
      assert.equal(Object.keys(payload.questions).length, 4);
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ model: "clef-flash", answers: {
        injection: answer(0.01), secrets: answer(0.01), destructive: answer(0.01), offIntent: answer(0.01),
      }, usage: { input_tokens: 5, output_tokens: 4 } }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const checked = await checkClef({ env: { WARDEN_OLLAMA_URL: `http://127.0.0.1:${address.port}`, WARDEN_RISK_OFFLINE: "0" } }, undefined, "ollama");
    assert.equal(checked.ok, true);
    assert.equal(requests, 1);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("successful local CLEF diagnostic removes the project's cached Ollama outage", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "warden-clef-check-"));
  const cache = path.join(root, ".warden", "ollama-unavailable.json");
  mkdirSync(path.dirname(cache), { recursive: true });
  writeFileSync(cache, JSON.stringify({ url: "http://127.0.0.1:11434/v1/systemone", until: Date.now() + 120_000 }));
  try {
    const result = await checkClef({ env: { WARDEN_RISK_OFFLINE: "0" }, fetch: async () => ({
      ok: true, json: async () => ({ answers: {
        injection: answer(0), secrets: answer(0), destructive: answer(0), offIntent: answer(0),
      } }),
    }) as Response }, root, "ollama");
    assert.equal(result.ok, true);
    assert.equal(existsSync(cache), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});