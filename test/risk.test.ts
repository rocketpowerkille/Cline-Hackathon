import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { ASK_BUDGET, BLOCK_BUDGET, budgetIncrement, noisyOr, RiskScorer, safeState } from "../src/policy/risk.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

const action = (sessionId: string, kind: AgentAction["kind"] = "write", target = "notes.txt"): AgentAction => ({
  source: "replay", sessionId, agent: "test", kind, tool: kind, target, content: "ordinary text", untrustedInput: false, userIntent: "Maintain notes",
});

test("four CLEF probabilities noisy-OR and a long series of small allowed steps crosses ask then block", async () => {
  assert.ok(Math.abs(noisyOr({ injection: 0.1, secrets: 0.2, destructive: 0, offIntent: 0 }) - 0.28) < 1e-12);
  const store = new WardenStore(":memory:");
  const root = tempWorkspace();
  const engine = new Engine(store, { workspaceRoot: root, stages: { risk: async () => ({ backend: "heuristic", latencyMs: 3,
    questions: { injection: 0.12, secrets: 0, destructive: 0, offIntent: 0 }, actionProbability: 0.12, sessionBudget: 0 }) } });
  try {
    for (let step = 1; step <= 19; step++) {
      const result = await engine.decide(action("slow", "write", `step${step}.txt`));
      assert.equal(result.verdict, step < 10 ? "allow" : step < 18 ? "ask" : "block");
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