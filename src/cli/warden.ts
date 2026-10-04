#!/usr/bin/env node
import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseWardenRunArgv } from "./args.js";
import { status } from "./status.js";
import { score } from "./score.js";
import { dashboard } from "./dashboard.js";
import { runRespondCli } from "./respond.js";
import { wardenStatePath } from "../core/paths.js";
import { doctorWarden, installWarden, uninstallWarden, type InstallResult } from "../install/init.js";
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
  const root = process.cwd();
  const packageRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

  if (command === "status") {
    if (subcommand || rest.length) throw new Error("Usage: warden status");
    io.stdout.write(status(root));
    return 0;
  }
  if (command === "score") {
    if (rest.length || subcommand?.startsWith("-")) throw new Error("Usage: warden score [SESSION_ID]");
    io.stdout.write(score(root, subcommand));
    return 0;
  }
  if (command === "dashboard") {
    if (subcommand || rest.length) throw new Error("Usage: warden dashboard");
    const server = await dashboard(root, io.stdout);
    if (io === defaultIo) {
      const shutdown = () => { void server.close().then(() => { process.exitCode = 0; }); };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
    }
    return 0;
  }
  if (command === "respond") return runRespondCli([subcommand, ...rest].filter((value): value is string => value !== undefined), io);

  if (command === "init") {
    const seedEnv = subcommand === "--seed-env";
    if ((subcommand && !seedEnv) || rest.length > 0) throw new Error("Usage: warden init [--seed-env]");
    let context: CliContext | undefined;
    try {
      if (seedEnv) context = openContext(root);
      const result = installWarden({
        root,
        packageRoot,
        seedEnv,
        ...(context ? { vault: context.vault } : {}),
      });
      printInstallResult(result, io);
      return 0;
    } finally {
      context?.close();
    }
  }

  if (command === "uninstall") {
    if (subcommand || rest.length) throw new Error("Usage: warden uninstall");
    printInstallResult(uninstallWarden(root), io);
    return 0;
  }

  if (command === "doctor") {
    if (subcommand || rest.length) throw new Error("Usage: warden doctor");
    const result = doctorWarden({ root, packageRoot });
    for (const check of result.checks) io.stdout.write(`${check.status.toUpperCase()} ${check.message}\n`);
    return result.ok ? 0 : 1;
  }

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

    throw new Error("Usage: warden <init|uninstall|doctor|status|score|dashboard|respond|vault add|seed|list|run>");
  } finally {
    context.close();
  }
}

function printInstallResult(result: InstallResult, io: CliIo): void {
  for (const item of result.installed) io.stdout.write(`${item}\n`);
  for (const item of result.skipped) io.stdout.write(`SKIPPED ${item}\n`);
  for (const warning of result.warnings) io.stderr.write(`WARN ${warning}\n`);
  if (result.seeded.length) io.stdout.write(`Seeded: ${result.seeded.join(", ")}\n`);
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