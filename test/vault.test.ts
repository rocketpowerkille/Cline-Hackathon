import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { MemorySecretStore, SecretVault } from "../src/vault/secrets.js";

function fixture(): {
  root: string;
  database: DatabaseSync;
  secrets: MemorySecretStore;
  vault: SecretVault;
  close(): void;
} {
  const root = mkdtempSync(path.join(tmpdir(), "warden-vault-"));
  const database = new DatabaseSync(":memory:");
  const secrets = new MemorySecretStore();
  return {
    root,
    database,
    secrets,
    vault: new SecretVault(root, database, secrets),
    close() {
      database.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("seedEnv moves values to secret storage and leaves canaries", () => {
  const context = fixture();
  const envPath = path.join(context.root, ".env");
  writeFileSync(
    envPath,
    "# fake demo credentials\nNPM_TOKEN=npm_fake_demo_token\nexport GITHUB_TOKEN='ghp_fake_demo_token' # demo\nEMPTY=\n",
  );

  const result = context.vault.seedEnv(".env");
  const rewritten = readFileSync(envPath, "utf8");

  assert.deepEqual(result.seeded, ["NPM_TOKEN", "GITHUB_TOKEN"]);
  assert.deepEqual(result.skipped, ["EMPTY"]);
  assert.equal(context.secrets.get("NPM_TOKEN"), "npm_fake_demo_token");
  assert.equal(context.secrets.get("GITHUB_TOKEN"), "ghp_fake_demo_token");
  assert.doesNotMatch(rewritten, /npm_fake_demo_token|ghp_fake_demo_token/);
  assert.match(rewritten, /NPM_TOKEN=__WARDEN_CANARY__NPM_TOKEN__[a-f0-9]{24}__/);
  assert.match(rewritten, /export GITHUB_TOKEN=__WARDEN_CANARY__GITHUB_TOKEN__[a-f0-9]{24}__ # demo/);
  assert.match(rewritten, /EMPTY=\n$/);
  context.close();
});

test("seedEnv is idempotent for existing canaries", () => {
  const context = fixture();
  const envPath = path.join(context.root, ".env");
  writeFileSync(envPath, "NPM_TOKEN=npm_fake_demo_token\n");

  context.vault.seedEnv(".env");
  const first = readFileSync(envPath, "utf8");
  const second = context.vault.seedEnv(".env");

  assert.deepEqual(second, { seeded: [], skipped: ["NPM_TOKEN"] });
  assert.equal(readFileSync(envPath, "utf8"), first);
  assert.equal(context.vault.list().length, 1);
  context.close();
});

test("seedEnv rejects files outside the protected repository", () => {
  const context = fixture();
  const outside = path.join(tmpdir(), `warden-outside-${process.pid}.env`);
  writeFileSync(outside, "NPM_TOKEN=npm_fake_demo_token\n");

  assert.throws(
    () => context.vault.seedEnv(outside),
    /inside the protected repository/,
  );
  assert.equal(context.secrets.get("NPM_TOKEN"), undefined);
  rmSync(outside, { force: true });
  context.close();
});

test("scanCanaries finds known and copied Warden placeholders", () => {
  const context = fixture();
  const entry = context.vault.add("NPM_TOKEN", "npm_fake_demo_token");
  const unknown = "__WARDEN_CANARY__OTHER_TOKEN__0123456789abcdef01234567__";

  assert.deepEqual(context.vault.scanCanaries(`curl -d ${entry.placeholder} ${unknown}`), [
    { name: "NPM_TOKEN", placeholder: entry.placeholder },
    { name: null, placeholder: unknown },
  ]);
  context.close();
});

test("grantEnvironment returns real values and records session exposure", () => {
  const context = fixture();
  context.vault.add("GITHUB_TOKEN", "ghp_fake_demo_token");
  context.vault.add("NPM_TOKEN", "npm_fake_demo_token");

  const environment = context.vault.grantEnvironment("session-42");

  assert.deepEqual(environment, {
    GITHUB_TOKEN: "ghp_fake_demo_token",
    NPM_TOKEN: "npm_fake_demo_token",
  });
  assert.deepEqual(context.vault.grantedNames("session-42"), ["GITHUB_TOKEN", "NPM_TOKEN"]);
  assert.deepEqual(context.vault.grantedNames("other-session"), []);
  context.close();
});

test("run injects secrets only into the child process", async () => {
  const context = fixture();
  context.vault.add("WARDEN_TEST_TOKEN", "obviously_fake_child_token");
  assert.equal(process.env.WARDEN_TEST_TOKEN, undefined);

  const child = context.vault.run(
    "session-child",
    process.execPath,
    ["-e", "process.stdout.write(process.env.WARDEN_TEST_TOKEN ?? '')"],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let output = "";
  child.stdout!.setEncoding("utf8");
  child.stdout!.on("data", (chunk: string) => output += chunk);
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  });

  assert.equal(exitCode, 0);
  assert.equal(output, "obviously_fake_child_token");
  assert.equal(process.env.WARDEN_TEST_TOKEN, undefined);
  assert.deepEqual(context.vault.grantedNames("session-child"), ["WARDEN_TEST_TOKEN"]);
  context.close();
});

test("vault metadata never stores a real secret", () => {
  const context = fixture();
  context.vault.add("NPM_TOKEN", "npm_fake_demo_token");

  const dump = JSON.stringify([
    ...context.database.prepare("SELECT * FROM vault_entries").iterate(),
    ...context.database.prepare("SELECT * FROM vault_grants").iterate(),
  ]);
  assert.doesNotMatch(dump, /npm_fake_demo_token/);
  context.close();
});