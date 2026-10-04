#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ClineSdkAgentRunner, respondWithAgents } from "../responder/agents.js";
import { respondDeterministically } from "../responder/runbook.js";
import type { KeyProvider } from "../responder/providers.js";

export interface RespondCliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function runRespondCli(argv: readonly string[], io: RespondCliIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed.sdk) {
    try { import.meta.resolve("@cline/sdk"); }
    catch { throw new Error("Optional Cline SDK is not installed. Install and audit it separately before using --sdk."); }
  }
  const root = process.cwd();
  const databasePath = path.join(root, ".warden", "warden.db");
  const database = new DatabaseSync(databasePath);
  try {
    // The demo injects mocks directly into its own runbook; CLI never simulates real rotation.
    const providers: KeyProvider[] = [];
    const apiKey = process.env.WARDEN_RESPONDER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const result = !parsed.sdk
      ? await respondDeterministically({
          workspaceRoot: root,
          database,
          sessionId: parsed.sessionId,
          trigger: parsed.trigger,
          providers,
        })
      : await respondWithAgents({
          workspaceRoot: root,
          database,
          sessionId: parsed.sessionId,
          trigger: parsed.trigger,
          providers,
          runner: new ClineSdkAgentRunner({
            providerId: process.env.WARDEN_RESPONDER_PROVIDER ?? "anthropic",
            modelId: process.env.WARDEN_RESPONDER_MODEL ?? "claude-sonnet-4-6",
            apiKey: apiKey!,
          }),
        });
    io.stdout.write(`${result.closed ? "CLOSED" : "OPEN"} ${result.reportPath}\n`);
    for (const rotation of result.rotations) io.stdout.write(`${rotation.oldRejected ? "OK" : "CRITICAL"} ${rotation.message}\n`);
    for (const file of result.files) io.stdout.write(`${file.status.toUpperCase()} ${file.path}: ${file.message}\n`);
    return result.closed ? 0 : 2;
  } finally {
    database.close();
  }
}

function parseArgs(argv: readonly string[]): { sessionId: string; trigger: string; deterministic: boolean; sdk: boolean } {
  let sessionId = "";
  let trigger = "manual response";
  let deterministic = false;
  let sdk = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--session") sessionId = argv[++index] ?? "";
    else if (arg === "--trigger") trigger = argv[++index] ?? "";
    else if (arg === "--deterministic") deterministic = true;
    else if (arg === "--sdk") sdk = true;
    else throw new Error(`Unknown respond option: ${arg}`);
  }
  if (!sessionId || !trigger || (sdk && deterministic)) throw new Error('Usage: warden respond --session <id> --trigger "<why>" [--deterministic|--sdk]');
  if (sdk && !process.env.WARDEN_RESPONDER_API_KEY && !process.env.ANTHROPIC_API_KEY) throw new Error("SDK response needs a responder API key; use --deterministic for offline response.");
  return { sessionId, trigger, deterministic, sdk };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runRespondCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      process.stderr.write(`warden respond: ${error instanceof Error ? error.message : "Unknown error"}\n`);
      process.exitCode = 1;
    },
  );
}