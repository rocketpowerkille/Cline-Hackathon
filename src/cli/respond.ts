#!/usr/bin/env node
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { ClineSdkAgentRunner, respondWithAgents } from "../responder/agents.js";
import { mockProviders } from "../responder/providers.js";
import { respondDeterministically } from "../responder/runbook.js";

export interface RespondCliIo {
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
}

export async function runRespondCli(argv: readonly string[], io: RespondCliIo = { stdout: process.stdout, stderr: process.stderr }): Promise<number> {
  const parsed = parseArgs(argv);
  const root = process.cwd();
  const databasePath = path.join(root, ".warden", "warden.db");
  const database = new DatabaseSync(databasePath);
  try {
    const providers = mockProviders();
    const apiKey = process.env.WARDEN_RESPONDER_API_KEY ?? process.env.ANTHROPIC_API_KEY;
    const result = parsed.deterministic || !apiKey
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
            apiKey,
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

function parseArgs(argv: readonly string[]): { sessionId: string; trigger: string; deterministic: boolean } {
  let sessionId = "";
  let trigger = "manual response";
  let deterministic = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--session") sessionId = argv[++index] ?? "";
    else if (arg === "--trigger") trigger = argv[++index] ?? "";
    else if (arg === "--deterministic") deterministic = true;
    else throw new Error(`Unknown respond option: ${arg}`);
  }
  if (!sessionId || !trigger) throw new Error('Usage: warden respond --session <id> --trigger "<why>" [--deterministic]');
  return { sessionId, trigger, deterministic };
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