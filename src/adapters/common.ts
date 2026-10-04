import type { AgentAction, Decision } from "../core/types.js";

export type JsonRecord = Record<string, unknown>;

export interface HookEnvironment {
  cwd: string;
  env: Record<string, string | undefined>;
}

export interface NormalizedHook {
  /** Null when the hook event is observational or the tool has no side effects. */
  action: AgentAction | null;
  workspaceRoot: string;
}

export interface HookOutput {
  stdout: string;
  exitCode: number;
}

export interface HostAdapter {
  eventName(payload: JsonRecord): string;
  normalize(event: string, payload: JsonRecord, environment: HookEnvironment): NormalizedHook;
  /** A null decision means Warden made no decision and the host must proceed. */
  respond(event: string, decision: Decision | null): HookOutput;
}

/** Input validation failure. Messages never include hook content, so they are safe to log. */
export class HookInputError extends Error {
  override name = "HookInputError";
}

/** Decodes hook stdin. Windows PowerShell pipelines may deliver UTF-16LE with a byte order mark. */
export function decodeHookInput(bytes: Uint8Array): string {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  return new TextDecoder("utf-8").decode(bytes);
}

export function parseJsonObject(raw: string): JsonRecord {
  let value: unknown;
  try {
    // PowerShell pipelines may prepend a UTF-8 byte order mark.
    value = JSON.parse(raw.replace(/^\uFEFF/, ""));
  } catch {
    throw new HookInputError("Hook input is not valid JSON.");
  }
  if (!isRecord(value)) throw new HookInputError("Hook input must be a JSON object.");
  return value;
}

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function record(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

export function text(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function firstText(source: JsonRecord, keys: readonly string[]): string {
  for (const key of keys) {
    const value = text(source[key]);
    if (value) return value;
  }
  return "";
}

export function firstRoot(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const root = value.find((item): item is string => typeof item === "string" && item.length > 0);
  return root;
}

export function json(value: unknown): HookOutput {
  return { stdout: JSON.stringify(value), exitCode: 0 };
}

export function isAllowed(decision: Decision | null): boolean {
  return decision === null || decision.verdict === "allow";
}

export function denialMessage(decision: Decision): string {
  const prefix = decision.verdict === "ask" ? "Warden requires approval" : `Warden ${decision.verdict}`;
  return `${prefix}: ${decision.reason}`;
}

export const agentGuidance =
  "Warden stopped this action. Do not retry it or work around it; tell the user what was blocked and why.";
