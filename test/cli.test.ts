import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { ChildProcess } from "node:child_process";
import { parseWardenRunArgv, parseWardenRunCommand } from "../src/cli/args.js";
import { runCli, type CliContext, type CliIo } from "../src/cli/warden.js";
import { MemorySecretStore, SecretVault } from "../src/vault/secrets.js";

function cliFixture(secret = "obviously_fake_cli_secret"): {
  root: string;
  vault: SecretVault;
  secrets: MemorySecretStore;
  database: DatabaseSync;
  output: PassThrough;
  io: CliIo;
  openContext: () => CliContext;
  close(): void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "warden-cli-"));
  const database = new DatabaseSync(":memory:");
  const secrets = new MemorySecretStore();
  const vault = new SecretVault(root, database, secrets);
  const output = new PassThrough();
  const io: CliIo = {
    stdin: new PassThrough(),
    stdout: output,
    stderr: output,
    promptSecret: async () => secret,
  };
  return {
    root,
    vault,
    secrets,
    database,
    output,
    io,
    openContext: () => ({ root, vault, close() {} }),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("run arguments and engine command parsing agree", () => {
  assert.deepEqual(parseWardenRunArgv(["--only", "NPM_TOKEN,GITHUB_TOKEN", "--", "npm", "publish"]), {
    command: "npm",
    args: ["publish"],
    only: ["GITHUB_TOKEN", "NPM_TOKEN"],
  });
  assert.deepEqual(parseWardenRunCommand('warden run --only=NPM_TOKEN -- npm publish --tag "next test"'), {
    command: "npm",
    args: ["publish", "--tag", "next test"],
    only: ["NPM_TOKEN"],
  });
  assert.deepEqual(parseWardenRunCommand('warden run -- "C:\\Tools\\publisher.exe" release'), {
    command: "C:\\Tools\\publisher.exe",
    args: ["release"],
    only: null,
  });
});

test("vault add prompts for the value instead of accepting it in argv", async () => {
  const context = cliFixture();
  assert.equal(await runCli(["vault", "add", "NPM_TOKEN"], context.io, context.openContext), 0);
  assert.equal(context.secrets.get("NPM_TOKEN"), "obviously_fake_cli_secret");
  await assert.rejects(
    runCli(["vault", "add", "NPM_TOKEN", "must-not-be-an-argument"], context.io, context.openContext),
    /Usage: warden vault add/,
  );
  context.close();
});

test("vault seed and list expose names but not values", async () => {
  const context = cliFixture();
  writeFileSync(path.join(context.root, ".env"), "NPM_TOKEN=npm_fake_demo_token\n");
  const previous = process.cwd();
  process.chdir(context.root);
  try {
    assert.equal(await runCli(["vault", "seed"], context.io, context.openContext), 0);
    assert.equal(await runCli(["vault", "list"], context.io, context.openContext), 0);
  } finally {
    process.chdir(previous);
  }
  const output = context.output.read()?.toString() ?? "";
  assert.match(output, /NPM_TOKEN/);
  assert.doesNotMatch(output, /npm_fake_demo_token/);
  context.close();
});

test("warden run consumes a ticket and injects only selected keys", async () => {
  const context = cliFixture();
  context.vault.add("GITHUB_TOKEN", "ghp_fake_demo_token");
  context.vault.add("NPM_TOKEN", "npm_fake_demo_token");
  context.vault.issueRunTicket("cline-session", ["npm", "publish"], ["NPM_TOKEN"]);
  let childEnvironment: NodeJS.ProcessEnv | undefined;
  const child = new EventEmitter() as ChildProcess;
  const openContext = (): CliContext => ({
    root: context.root,
    vault: context.vault,
    close() {},
    spawnChild(_command, _args, environment) {
      childEnvironment = environment;
      queueMicrotask(() => {
        child.emit("spawn");
        child.emit("close", 0);
      });
      return child;
    },
  });

  assert.equal(await runCli(["run", "--only", "NPM_TOKEN", "--", "npm", "publish"], context.io, openContext), 0);
  assert.deepEqual(childEnvironment, { NPM_TOKEN: "npm_fake_demo_token" });
  assert.equal((childEnvironment as NodeJS.ProcessEnv | undefined)?.GITHUB_TOKEN, undefined);
  assert.deepEqual(context.vault.grantedNames("cline-session"), ["NPM_TOKEN"]);
  context.close();
});

test("warden run fails closed without a matching ticket", async () => {
  const context = cliFixture();
  context.vault.add("NPM_TOKEN", "npm_fake_demo_token");
  await assert.rejects(
    runCli(["run", "--", "npm", "publish"], context.io, context.openContext),
    /No valid Warden run ticket/,
  );
  assert.deepEqual(context.vault.grantedNames("cline-session"), []);
  context.close();
});

test("a child spawn failure does not record secret exposure", async () => {
  const context = cliFixture();
  context.vault.add("NPM_TOKEN", "npm_fake_demo_token");
  context.vault.issueRunTicket("cline-session", ["npm", "publish"], null);
  const openContext = (): CliContext => ({
    root: context.root,
    vault: context.vault,
    close() {},
    spawnChild() {
      throw new Error("spawn failed");
    },
  });

  await assert.rejects(
    runCli(["run", "--", "npm", "publish"], context.io, openContext),
    /spawn failed/,
  );
  assert.deepEqual(context.vault.grantedNames("cline-session"), []);
  context.close();
});