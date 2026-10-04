import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { doctorWarden, installWarden, uninstallWarden } from "../src/install/init.js";
import { MemorySecretStore, SecretVault } from "../src/vault/secrets.js";
import { DatabaseSync } from "node:sqlite";

const packageRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const fakeNode = process.platform === "win32" ? "C:\\Program Files\\nodejs\\node.exe" : "/usr/bin/node";

function tempRepo(): { root: string; close(): void } {
  const root = mkdtempSync(path.join(tmpdir(), "warden-install-"));
  return { root, close: () => rmSync(root, { recursive: true, force: true }) };
}

test("Windows init writes PowerShell Cline hooks and merges Cursor hooks", () => {
  const repo = tempRepo();
  mkdirSync(path.join(repo.root, ".cursor"), { recursive: true });
  writeFileSync(
    path.join(repo.root, ".cursor", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "existing-security-hook", timeout: 9 }] }, custom: true }),
  );

  const result = installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  const preTool = readFileSync(path.join(repo.root, ".clinerules", "hooks", "PreToolUse.ps1"), "utf8");
  const cursor = JSON.parse(readFileSync(path.join(repo.root, ".cursor", "hooks.json"), "utf8"));

  assert.match(preTool, /WARDEN_MANAGED_HOOK/);
  assert.match(preTool, /bin[\\/]hook\.mjs/);
  assert.match(preTool, /cline PreToolUse/);
  assert.equal(cursor.custom, true);
  assert.equal(cursor.hooks.preToolUse[0].command, "existing-security-hook");
  assert.equal(cursor.hooks.preToolUse.length, 2);
  assert.equal(cursor.hooks.beforeSubmitPrompt.length, 1);
  assert.match(readFileSync(path.join(repo.root, ".gitignore"), "utf8"), /^\.warden\/$/m);
  assert.ok(existsSync(path.join(repo.root, ".warden", "install.json")));
  assert.ok(result.installed.length > 0);
  repo.close();
});

test("init is idempotent", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  const firstCursor = readFileSync(path.join(repo.root, ".cursor", "hooks.json"), "utf8");

  const second = installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });

  assert.deepEqual(second.installed, []);
  assert.deepEqual(second.skipped, []);
  assert.equal(readFileSync(path.join(repo.root, ".cursor", "hooks.json"), "utf8"), firstCursor);
  assert.equal(readFileSync(path.join(repo.root, ".gitignore"), "utf8").match(/\.warden\//g)?.length, 1);
  repo.close();
});

test("init preserves existing and modified Cline hooks", () => {
  const repo = tempRepo();
  const hookDirectory = path.join(repo.root, ".clinerules", "hooks");
  mkdirSync(hookDirectory, { recursive: true });
  const taskStart = path.join(hookDirectory, "TaskStart.ps1");
  writeFileSync(taskStart, "Write-Output '{\"cancel\":false}'\n");

  const first = installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  assert.ok(first.skipped.some((name) => name.endsWith("TaskStart.ps1")));
  assert.equal(readFileSync(taskStart, "utf8"), "Write-Output '{\"cancel\":false}'\n");

  const preTool = path.join(hookDirectory, "PreToolUse.ps1");
  writeFileSync(preTool, `${readFileSync(preTool, "utf8")}# local edit\n`);
  const second = installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  assert.ok(second.warnings.some((warning) => warning.includes("modified Warden")));
  assert.match(readFileSync(preTool, "utf8"), /local edit/);
  repo.close();
});

test("invalid Cursor config aborts before writing Cline hooks", () => {
  const repo = tempRepo();
  mkdirSync(path.join(repo.root, ".cursor"), { recursive: true });
  writeFileSync(path.join(repo.root, ".cursor", "hooks.json"), "{broken");

  assert.throws(
    () => installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode }),
    /Cannot safely merge/,
  );
  assert.equal(existsSync(path.join(repo.root, ".clinerules")), false);
  repo.close();
});

test("Linux init writes executable extensionless Cline hooks", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "linux", nodePath: "/usr/bin/node" });
  const hook = path.join(repo.root, ".clinerules", "hooks", "PreToolUse");
  const content = readFileSync(hook, "utf8");

  assert.match(content, /^#!\/bin\/sh/);
  assert.match(content, /cline PreToolUse/);
  if (process.platform !== "win32") assert.notEqual(statSync(hook).mode & 0o111, 0);
  repo.close();
});

test("doctor reports healthy and broken installations", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  assert.equal(doctorWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode }).ok, true);

  rmSync(path.join(repo.root, ".clinerules", "hooks", "PreToolUse.ps1"));
  const broken = doctorWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  assert.equal(broken.ok, false);
  assert.ok(broken.checks.some((check) => check.status === "error" && check.message.includes("PreToolUse")));
  repo.close();
});

test("uninstall removes only Warden-owned configuration", () => {
  const repo = tempRepo();
  mkdirSync(path.join(repo.root, ".cursor"), { recursive: true });
  writeFileSync(path.join(repo.root, ".cursor", "hooks.json"), JSON.stringify({ version: 1, hooks: { preToolUse: [{ command: "existing" }] } }));
  writeFileSync(path.join(repo.root, ".gitignore"), "dist/\n");
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });

  uninstallWarden(repo.root);
  const cursor = JSON.parse(readFileSync(path.join(repo.root, ".cursor", "hooks.json"), "utf8"));
  assert.deepEqual(cursor.hooks.preToolUse, [{ command: "existing" }]);
  assert.equal(cursor.hooks.beforeSubmitPrompt, undefined);
  assert.equal(existsSync(path.join(repo.root, ".clinerules", "hooks", "PreToolUse.ps1")), false);
  assert.equal(readFileSync(path.join(repo.root, ".gitignore"), "utf8"), "dist/\n");
  assert.equal(existsSync(path.join(repo.root, ".warden")), false);
  repo.close();
});

test("uninstall does not remove an identical pre-existing Cursor command", () => {
  const repo = tempRepo();
  const command = "powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .warden/hooks/cursor-preToolUse.ps1";
  mkdirSync(path.join(repo.root, ".cursor"), { recursive: true });
  writeFileSync(
    path.join(repo.root, ".cursor", "hooks.json"),
    JSON.stringify({ version: 1, hooks: { preToolUse: [{ command }] } }),
  );

  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  uninstallWarden(repo.root);

  const cursor = JSON.parse(readFileSync(path.join(repo.root, ".cursor", "hooks.json"), "utf8"));
  assert.deepEqual(cursor.hooks.preToolUse, [{ command }]);
  repo.close();
});

test("uninstall removes only one owned Cursor entry when duplicates exist", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  const filename = path.join(repo.root, ".cursor", "hooks.json");
  const cursor = JSON.parse(readFileSync(filename, "utf8"));
  cursor.hooks.preToolUse.push({ ...cursor.hooks.preToolUse[0] });
  writeFileSync(filename, JSON.stringify(cursor, null, 2));

  uninstallWarden(repo.root);

  const remaining = JSON.parse(readFileSync(filename, "utf8"));
  assert.equal(remaining.hooks.preToolUse.length, 1);
  repo.close();
});

test("uninstall ignores malicious manifest paths", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  const outside = path.join(path.dirname(repo.root), `warden-do-not-delete-${process.pid}.txt`);
  writeFileSync(outside, "keep me");
  const manifestFile = path.join(repo.root, ".warden", "install.json");
  const manifest = JSON.parse(readFileSync(manifestFile, "utf8"));
  manifest.clineFiles.push({ path: path.relative(repo.root, outside), sha256: "00" });
  manifest.cursorFiles.push({ path: path.relative(repo.root, outside), sha256: "00" });
  manifest.cursorEntries.push({ event: "../../outside", command: "delete me" });
  writeFileSync(manifestFile, JSON.stringify(manifest));

  uninstallWarden(repo.root);

  assert.equal(readFileSync(outside, "utf8"), "keep me");
  rmSync(outside, { force: true });
  repo.close();
});

test("uninstall preserves modified hooks and keeps state ignored", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: "win32", nodePath: fakeNode });
  const hook = path.join(repo.root, ".clinerules", "hooks", "PreToolUse.ps1");
  writeFileSync(hook, `${readFileSync(hook, "utf8")}# changed\n`);
  writeFileSync(path.join(repo.root, ".warden", "warden.db"), "state");

  const result = uninstallWarden(repo.root);
  assert.ok(result.warnings.some((warning) => warning.includes("modified Cline hook")));
  assert.ok(result.warnings.some((warning) => warning.includes("state remains")));
  assert.equal(existsSync(hook), true);
  assert.match(readFileSync(path.join(repo.root, ".gitignore"), "utf8"), /\.warden\//);
  repo.close();
});

test("init --seed-env uses the supplied vault and leaves no real value in .env", () => {
  const repo = tempRepo();
  const database = new DatabaseSync(":memory:");
  const secrets = new MemorySecretStore();
  const vault = new SecretVault(repo.root, database, secrets);
  writeFileSync(path.join(repo.root, ".env"), "NPM_TOKEN=npm_fake_install_token\n");

  const result = installWarden({
    root: repo.root,
    packageRoot,
    platform: "win32",
    nodePath: fakeNode,
    seedEnv: true,
    vault,
  });

  assert.deepEqual(result.seeded, ["NPM_TOKEN"]);
  assert.equal(secrets.get("NPM_TOKEN"), "npm_fake_install_token");
  assert.doesNotMatch(readFileSync(path.join(repo.root, ".env"), "utf8"), /npm_fake_install_token/);
  database.close();
  repo.close();
});

test("real CLI process initializes, diagnoses, and uninstalls a temporary repo", () => {
  const repo = tempRepo();
  const cli = path.join(packageRoot, "bin", "warden.mjs");
  const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], {
    cwd: repo.root,
    encoding: "utf8",
    timeout: 30_000,
  });

  const init = run("init");
  assert.equal(init.status, 0, init.stderr);
  assert.ok(existsSync(path.join(repo.root, ".warden", "install.json")));

  const doctor = run("doctor");
  assert.equal(doctor.status, 0, doctor.stderr);
  assert.match(doctor.stdout, /OK Hook launcher/);
  assert.match(doctor.stdout, /WARN Confirm Cline's Enable Hooks setting/);

  const uninstall = run("uninstall");
  assert.equal(uninstall.status, 0, uninstall.stderr);
  assert.equal(existsSync(path.join(repo.root, ".warden")), false);
  repo.close();
});

test("generated Cline wrapper speaks valid JSON over stdio", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: process.platform, nodePath: process.execPath });
  const fixture = JSON.parse(readFileSync(path.join(packageRoot, "test", "fixtures", "cline-pre-tool-use.json"), "utf8"));
  fixture.workspaceRoots = [repo.root];
  fixture.preToolUse.parameters.command = "npm test";
  const input = JSON.stringify(fixture);
  const hook = process.platform === "win32"
    ? path.join(repo.root, ".clinerules", "hooks", "PreToolUse.ps1")
    : path.join(repo.root, ".clinerules", "hooks", "PreToolUse");
  const execution = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", hook], {
        cwd: repo.root,
        input,
        encoding: "utf8",
        timeout: 30_000,
      })
    : spawnSync(hook, [], { cwd: repo.root, input, encoding: "utf8", timeout: 30_000 });

  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), { cancel: false });
  assert.ok(existsSync(path.join(repo.root, ".warden", "warden.db")));
  repo.close();
});

test("generated Cursor wrapper speaks valid JSON over stdio", () => {
  const repo = tempRepo();
  installWarden({ root: repo.root, packageRoot, platform: process.platform, nodePath: process.execPath });
  const fixture = JSON.parse(readFileSync(path.join(packageRoot, "test", "fixtures", "cursor-before-shell.json"), "utf8"));
  fixture.workspace_roots = [repo.root];
  fixture.cwd = repo.root;
  fixture.command = "npm test";
  const input = JSON.stringify(fixture);
  const hook = process.platform === "win32"
    ? path.join(repo.root, ".warden", "hooks", "cursor-preToolUse.ps1")
    : path.join(repo.root, ".warden", "hooks", "cursor-preToolUse");
  const execution = process.platform === "win32"
    ? spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", hook], {
        cwd: repo.root,
        input,
        encoding: "utf8",
        timeout: 30_000,
      })
    : spawnSync(hook, [], { cwd: repo.root, input, encoding: "utf8", timeout: 30_000 });

  assert.equal(execution.status, 0, execution.stderr);
  assert.deepEqual(JSON.parse(execution.stdout), { permission: "allow" });
  repo.close();
});