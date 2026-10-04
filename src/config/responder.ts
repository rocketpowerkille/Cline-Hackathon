import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

const keys = ["WARDEN_RESPONDER_PROVIDER", "WARDEN_RESPONDER_MODEL", "WARDEN_RESPONDER_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"] as const;

/** Called only for explicit SDK response; never load responder credentials into ordinary hooks. */
export function responderConfiguration(packageRoot: string, environment: NodeJS.ProcessEnv = process.env): {
  providerId: string; modelId: string; apiKey: string;
} {
  let file: Record<string, string | undefined> = {};
  const filename = path.join(packageRoot, ".env");
  if (existsSync(filename)) {
    try { file = parseEnv(readFileSync(filename, "utf8")); }
    catch { throw new Error("Unable to parse Warden responder .env configuration."); }
  }
  const values: Record<string, string | undefined> = {};
  for (const key of keys) {
    const value = environment[key] ?? file[key];
    if (value && /[\0\r\n]/.test(value)) throw new Error("Invalid multiline responder configuration.");
    values[key] = value?.trim();
  }
  const selected = values.WARDEN_RESPONDER_PROVIDER || "anthropic";
  const providerId = selected === "openai" ? "openai-native" : selected;
  const openai = providerId === "openai-native" || providerId === "openai-compatible";
  const apiKey = values.WARDEN_RESPONDER_API_KEY || (openai ? values.OPENAI_API_KEY : providerId === "anthropic" ? values.ANTHROPIC_API_KEY : undefined);
  if (!apiKey) throw new Error(openai
    ? "OpenAI SDK response needs OPENAI_API_KEY or WARDEN_RESPONDER_API_KEY in the process environment or Warden package-root .env."
    : "SDK response needs a matching responder API key; use --deterministic for offline response.");
  const modelId = values.WARDEN_RESPONDER_MODEL || (openai ? "gpt-4.1-mini" : providerId === "anthropic" ? "claude-sonnet-4-6" : undefined);
  if (!modelId) throw new Error("Set WARDEN_RESPONDER_MODEL for the selected provider.");
  return { providerId, modelId, apiKey };
}