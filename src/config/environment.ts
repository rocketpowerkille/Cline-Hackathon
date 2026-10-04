import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";

/** Only Warden risk-provider settings may be loaded from the package-root .env. */
export const riskEnvironmentKeys = [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CLOUDFLARE_AUTH_TOKEN",
  "CLOUDFLARE_API_KEY",
  "WARDEN_OLLAMA_URL",
  "WARDEN_RISK_OFFLINE",
  "WARDEN_DEMO_CLEF_TIMEOUT_MS",
] as const;

export function loadRiskEnvironment(
  packageRoot: string,
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const filename = path.join(packageRoot, ".env");
  if (!existsSync(filename)) return [];
  let values: Record<string, string | undefined>;
  try {
    values = parseEnv(readFileSync(filename, "utf8"));
  } catch {
    // Optional provider configuration must never prevent a hook from starting.
    return [];
  }
  const loaded: string[] = [];
  for (const key of riskEnvironmentKeys) {
    const value = values[key];
    const valid = value !== undefined && value.length > 0 && !/[\0\r\n]/.test(value) && !/^['"]|['"]$/.test(value);
    if (environment[key] === undefined && valid) {
      environment[key] = value;
      loaded.push(key);
    }
  }
  return loaded;
}