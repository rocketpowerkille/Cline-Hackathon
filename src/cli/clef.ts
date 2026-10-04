import { clefTimeout, clearOllamaFailure, RiskScorer, type RiskOptions } from "../policy/risk.js";
import type { AgentAction } from "../core/types.js";
import { loadRiskEnvironment } from "../config/environment.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Harmless four-question probe; no ledger writes or user content. Cloudflare is the default. */
export async function checkClef(options: RiskOptions = {}, workspaceRoot?: string,
  provider: "cloudflare" | "ollama" = "cloudflare"): Promise<{ ok: boolean; message: string }> {
  const env = options.env ?? process.env;
  if (!options.env) loadRiskEnvironment(path.resolve(fileURLToPath(new URL("../..", import.meta.url))), env);
  const probe: NodeJS.ProcessEnv = {
    WARDEN_OLLAMA_URL: env.WARDEN_OLLAMA_URL,
    WARDEN_RISK_OFFLINE: env.WARDEN_RISK_OFFLINE,
    WARDEN_ENABLE_OLLAMA: provider === "ollama" ? "1" : "0",
    ...(provider === "cloudflare" ? {
      CLOUDFLARE_ACCOUNT_ID: env.CLOUDFLARE_ACCOUNT_ID,
      CLOUDFLARE_API_TOKEN: env.CLOUDFLARE_API_TOKEN,
      CLOUDFLARE_AUTH_TOKEN: env.CLOUDFLARE_AUTH_TOKEN,
      CLOUDFLARE_API_KEY: env.CLOUDFLARE_API_KEY,
    } : {}),
  };
  if (probe.WARDEN_RISK_OFFLINE === "1") return { ok: false, message: "CLEF disabled by WARDEN_RISK_OFFLINE=1. Remove it from the editor environment, then restart the editor." };
  if (provider === "cloudflare" && (!probe.CLOUDFLARE_ACCOUNT_ID
    || !(probe.CLOUDFLARE_API_TOKEN || probe.CLOUDFLARE_AUTH_TOKEN || probe.CLOUDFLARE_API_KEY))) {
    return { ok: false, message: "Cloudflare CLEF not configured. Set CLOUDFLARE_ACCOUNT_ID and a scoped CLOUDFLARE_API_TOKEN in Warden's .env or the process environment." };
  }
  const action: AgentAction = {
    source: "replay", sessionId: "clef-check", agent: "warden", kind: "write",
    tool: "write_to_file", target: "demo.txt", content: "Hello World",
    userIntent: "Write a harmless greeting to demo.txt", untrustedInput: false,
  };
  // Local diagnostics can warm a cold model; normal hooks retain the short bounded budget.
  const scorer = new RiskScorer({ ...options, env: probe, timeoutMs: options.timeoutMs ?? (provider === "ollama" ? 60_000 : 10_000) });
  const result = await scorer.score(action, action.userIntent);
  if (result.backend !== provider) return { ok: false, message: provider === "ollama"
    ? `Local CLEF check failed (${scorer.lastLocalFailure ?? "not selected"}). Check Ollama 0.35.1+, pull clef-flash, and inspect its server.log. Hooks use configured Cloudflare or the offline heuristic; local Ollama requires WARDEN_ENABLE_OLLAMA=1 and no Cloudflare credentials.`
    : "Cloudflare CLEF check failed. Verify the account ID, scoped Workers AI API token, model access, and connectivity; hooks fall back directly to the offline heuristic." };
  if (provider === "ollama" && workspaceRoot) clearOllamaFailure(workspaceRoot);
  const q = result.questions;
  return { ok: true, message: `CLEF ready: backend=${provider} latency=${result.latencyMs ?? 0}ms p=${result.actionProbability.toFixed(3)} injection=${q.injection.toFixed(3)} secrets=${q.secrets.toFixed(3)} destructive=${q.destructive.toFixed(3)} offIntent=${q.offIntent.toFixed(3)}. Hook budget is separate (${clefTimeout(env)}ms configured/default); confirm the dashboard shows backend ${provider} on real actions.` };
}