import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { ASK_BUDGET, BLOCK_BUDGET, budgetIncrement, noisyOr, RiskScorer, safeState } from "../src/policy/risk.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const action = (sessionId: string, kind: AgentAction["kind"] = "write", target = "notes.txt"): AgentAction => ({
  source: "replay", sessionId, agent: "test", kind, tool: kind, target, content: "ordinary text", untrustedInput: false, userIntent: "Maintain notes",
});

test("four CLEF probabilities noisy-OR and a long series of small allowed steps crosses ask then block", async () => {
  assert.ok(Math.abs(noisyOr({ injection: 0.1, secrets: 0.2, destructive: 0, offIntent: 0 }) - 0.28) < 1e-12);
  const store = new WardenStore(":memory:");
  const root = tempWorkspace();
  const engine = new Engine(store, { workspaceRoot: root, approval: async () => ({ id: null, status: "denied", reason: "test denied" }), stages: { risk: async () => ({ backend: "heuristic", latencyMs: 3,
    questions: { injection: 0.12, secrets: 0, destructive: 0, offIntent: 0 }, actionProbability: 0.12, sessionBudget: 0 }) } });
  try {
    for (let step = 1; step <= 19; step++) {
      const result = await engine.decide(action("slow", "write", `step${step}.txt`));
      assert.equal(result.verdict, step < 10 ? "allow" : "block");
      if (step >= 10 && step < 18) assert.ok(result.labels.includes("approval:denied"));
      assert.equal(result.risk.backend, "heuristic");
      assert.equal(result.risk.latencyMs, 3);
    }
    assert.ok(store.sessionBudget("slow") >= BLOCK_BUDGET);
    assert.equal((store.database.prepare("SELECT risk_latency_ms AS ms FROM decisions ORDER BY id DESC LIMIT 1").get() as { ms: number }).ms, 3);
    const read = await engine.decide(action("slow", "read"));
    assert.equal(read.verdict, "allow", "reads never block solely due to budget");
    assert.ok(read.risk.sessionBudget > BLOCK_BUDGET);
    assert.ok(budgetIncrement(0.12, "read") < budgetIncrement(0.12, "write"));
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("routine offline session stays quiet: 100 actions, probability zero, budget zero", async () => {
  const store = new WardenStore(":memory:");
  const root = tempWorkspace();
  const engine = new Engine(store, { workspaceRoot: root, stages: { risk: (a, intent) => new RiskScorer({ env: { WARDEN_RISK_OFFLINE: "1" },
    fetch: () => { throw new Error("tests must not use network"); } }).score(a, intent) } });
  try {
    for (let i = 0; i < 100; i++) {
      const result = await engine.decide(action("normal", i % 2 ? "read" : "write", `src/module${i}.ts`));
      assert.equal(result.verdict, "allow");
      assert.equal(result.risk.actionProbability, 0);
    }
    assert.equal(store.sessionBudget("normal"), 0);
    assert.equal(ASK_BUDGET, 1.2);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});

test("CLEF uses typed noul results; slow local falls back to remote structural signals or offline", async () => {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const response = (p: number) => ({ ok: true, json: async () => ({ result: { answers: Object.fromEntries(
    ["injection", "secrets", "destructive", "offIntent"].map((key) => [key, { type: "noul", noul: p }])) } }) });
  const transport = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
    if (url.includes("127.0.0.1")) throw new Error("Ollama unavailable");
    return response(0.1) as Response;
  };
  const scorer = new RiskScorer({ fetch: transport as typeof fetch, env: { CLOUDFLARE_ACCOUNT_ID: "demo", CLOUDFLARE_AUTH_TOKEN: "fake", WARDEN_RISK_OFFLINE: "0" } });
  assert.ok(safeState(action("test"), "Maintain notes"));
  const scored = await scorer.score(action("test"), "Maintain notes");
  assert.equal(scored.backend, "cloudflare", JSON.stringify(calls));
  assert.equal(calls.length, 2);
  assert.match(calls[0]!.url, /\/v1\/systemone$/);
  assert.equal(calls[0]!.body.model, "clef-flash");
  assert.match(calls[1]!.url, /@cf\/cloudflare\/clef-flash$/);
  assert.ok(Math.abs(scored.actionProbability - (1 - 0.9 ** 4)) < 1e-12);
  assert.ok(!JSON.stringify(calls[1]!.body).includes("ordinary text"), "remote sees structural signals only");
  const slow = new RiskScorer({ timeoutMs: 15, fetch: (() => new Promise(() => {})) as typeof fetch,
    env: { WARDEN_OLLAMA_URL: "http://127.0.0.1:11434", WARDEN_RISK_OFFLINE: "0" } });
  const start = performance.now();
  assert.equal((await slow.score(action("test"), "Maintain notes")).backend, "heuristic");
  assert.ok(performance.now() - start < 200);
  const unsafe = new RiskScorer({ fetch: () => { throw new Error("unsafe content must never be sent"); }, env: { WARDEN_RISK_OFFLINE: "0" } });
  assert.equal((await unsafe.score({ ...action("test"), content: "NPM_TOKEN=real-secret" }, "test")).backend, "heuristic");
  const nonLocal = new RiskScorer({ fetch: () => { throw new Error("nonlocal Ollama must not receive raw text"); },
    env: { WARDEN_OLLAMA_URL: "https://outside.invalid", WARDEN_RISK_OFFLINE: "0" } });
  assert.equal((await nonLocal.score(action("test"), "Maintain notes")).backend, "heuristic");
});

test("absent Ollama is cached across new scorer instances in one workspace", async () => {
  const root = tempWorkspace();
  const { mkdirSync } = await import("node:fs");
  const path = await import("node:path");
  mkdirSync(path.join(root, ".warden"));
  let attempts = 0;
  const fake: typeof fetch = async () => { attempts++; throw new Error("Ollama not running"); };
  try {
    const first = new RiskScorer({ fetch: fake, env: { WARDEN_RISK_OFFLINE: "0" } });
    assert.equal((await first.score(action("cache"), "Maintain notes", root)).backend, "heuristic");
    const second = new RiskScorer({ fetch: fake, env: { WARDEN_RISK_OFFLINE: "0" } });
    assert.equal((await second.score(action("cache"), "Maintain notes", root)).backend, "heuristic");
    assert.equal(attempts, 1, "a new hook process should not retry an unavailable Ollama");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("simultaneous hook processes serialize risk thresholds for one session", async () => {
  const root = tempWorkspace();
  const file = path.join(root, "warden.db");
  new WardenStore(file).close();
  const worker = fileURLToPath(new URL("./fixtures/risk-worker.ts", import.meta.url));
  const run = (): Promise<{ verdict: string; budget: number }> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", import.meta.resolve("tsx"), worker, file, root, "parallel"], {
      cwd: root, env: { ...process.env, WARDEN_RISK_OFFLINE: "1" }, windowsHide: true });
    let output = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => { output += chunk; });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve(JSON.parse(output) as { verdict: string; budget: number }) : reject(new Error(stderr)));
  });
  try {
    const results = await Promise.all([run(), run(), run()]);
    assert.deepEqual(results.map((result) => result.verdict).sort(), ["allow", "block", "block"]);
    const store = new WardenStore(file);
    assert.ok(store.sessionBudget("parallel") > 2.3);
    assert.equal((store.database.prepare("SELECT COUNT(*) AS n FROM decisions WHERE verdict='block' AND session_budget >= 1.2").get() as { n: number }).n, 2);
    store.close();
  } finally { rmSync(root, { recursive: true, force: true }); }
});