import { clineAdapter } from "../adapters/cline.js";
import { cursorAdapter } from "../adapters/cursor.js";
import { parseJsonObject, type HookOutput, type HostAdapter } from "../adapters/common.js";
import { Engine } from "../core/engine.js";
import { wardenStatePath } from "../core/paths.js";
import type { AgentAction, Decision } from "../core/types.js";
import { WardenStore } from "../store/database.js";

export const hookHosts = ["cline", "cursor"] as const;
export type HookHost = (typeof hookHosts)[number];

export interface OpenEngine {
  decide(action: AgentAction): Decision;
  close(): void;
}

export type EngineFactory = (workspaceRoot: string) => OpenEngine;

export interface HookRequest {
  host: HookHost;
  /** Installer-controlled event name; falls back to the event named in the payload. */
  event?: string | undefined;
  input: string;
  cwd: string;
  env?: Record<string, string | undefined>;
  openEngine?: EngineFactory;
  onError?: (error: unknown) => void;
}

const adapters: Record<HookHost, HostAdapter> = {
  cline: clineAdapter,
  cursor: cursorAdapter,
};

export function isHookHost(value: unknown): value is HookHost {
  return hookHosts.includes(value as HookHost);
}

export function openRepositoryEngine(workspaceRoot: string): OpenEngine {
  const store = new WardenStore(wardenStatePath(workspaceRoot, "warden.db"));
  const engine = new Engine(store);
  return {
    decide: (action) => engine.decide(action),
    close: () => store.close(),
  };
}

/** Runs one host hook. Any Warden failure fails open with the host's allow response. */
export function runHook(request: HookRequest): HookOutput {
  const adapter = adapters[request.host];
  let event = request.event ?? "";

  try {
    const payload = parseJsonObject(request.input);
    event ||= adapter.eventName(payload);
    const normalized = adapter.normalize(event, payload, { cwd: request.cwd, env: request.env ?? {} });
    if (!normalized.action) return adapter.respond(event, null);

    const engine = (request.openEngine ?? openRepositoryEngine)(normalized.workspaceRoot);
    try {
      return adapter.respond(event, engine.decide(normalized.action));
    } finally {
      engine.close();
    }
  } catch (error) {
    request.onError?.(error);
    return adapter.respond(event, null);
  }
}
