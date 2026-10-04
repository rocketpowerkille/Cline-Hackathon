#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { parseWardenRunArgv } from "./args.js";
import { wardenStatePath } from "../core/paths.js";
import { WardenStore } from "../store/database.js";
import { KeyringSecretStore, keyringService, SecretVault } from "../vault/secrets.js";

export interface CliIo {
  stdin: NodeJS.ReadableStream;
  stdout: NodeJS.WritableStream;
  stderr: NodeJS.WritableStream;
  promptSecret(label: string): Promise<string>;
}

export interface CliContext {
  root: string;
  vault: SecretVault;
  close(): void;
  spawnChild?(command: string, args: readonly string[], env: NodeJS.ProcessEnv): ChildProcess;
}

export async function runCli(
  argv: readonly string[],
  io: CliIo = defaultIo,
  openContext: (root: string) => CliContext = openRepositoryContext,
): Promise<number> {
  const [command, subcommand, ...rest] = argv;
  const context = openContext(process.cwd());
  try {
    if (command === "vault" && subcommand === "add") {
      const name = rest[0];
      if (!name || rest.length !== 1) throw new Error("Usage: warden vault add <NAME>");
      const value = await io.promptSecret(`Secret value for ${name}: `);
      context.vault.add(name, value);
      io.stdout.write(`Added ${name}.\n`);
      return 0;
    }

    if (command === "vault" && subcommand === "seed") {
      const filename = rest[0] ?? ".env";
      if (rest.length > 1) throw new Error("Usage: warden vault seed [FILE]");
      const result = context.vault.seedEnv(filename);
      io.stdout.write(`Seeded ${result.seeded.length} key(s); skipped ${result.skipped.length}.\n`);
      return 0;
    }

    if (command === "vault" && subcommand === "list") {
      if (rest.length > 0) throw new Error("Usage: warden vault list");
      for (const entry of context.vault.list()) io.stdout.write(`${entry.name}\n`);
      return 0;
    }

    if (command === "run") {
      const invocation = parseWardenRunArgv([subcommand, ...rest].filter((value): value is string => value !== undefined));
      const child = context.vault.runWithTicket(
        invocation.command,
        invocation.args,
        invocation.only,
        (environment) => (context.spawnChild ?? spawnForPlatform)(invocation.command, invocation.args, environment),
      );
      return await new Promise<number>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) => resolve(code ?? 1));
      });
    }

    throw new Error("Usage: warden <vault add|seed|list|run>");
  } finally {
    context.close();
  }
}

export function openRepositoryContext(root: string): CliContext {
  const store = new WardenStore(wardenStatePath(root, "warden.db"));
  const vault = new SecretVault(root, store.database, new KeyringSecretStore(keyringService(root)));
  return { root, vault, close: () => store.close() };
}

async function promptHidden(label: string): Promise<string> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    const lines = createInterface({ input: process.stdin, terminal: false });
    const value = await lines.question("");
    lines.close();
    return value;
  }

  process.stdout.write(label);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");
  let value = "";
  try {
    for await (const chunk of process.stdin) {
      for (const character of String(chunk)) {
        if (character === "\r" || character === "\n") {
          process.stdout.write("\n");
          return value;
        }
        if (character === "\u0003") throw new Error("Secret entry cancelled");
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    }
    return value;
  } finally {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }
}

function spawnForPlatform(command: string, args: readonly string[], injected: NodeJS.ProcessEnv): ChildProcess {
  return spawn(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...injected },
  });
}

const defaultIo: CliIo = {
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  promptSecret: promptHidden,
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown error";
      process.stderr.write(`warden: ${message}\n`);
      process.exitCode = 1;
    },
  );
}