import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runHook } from "../src/hooks/run.js";
import { WardenStore } from "../src/store/database.js";
import { fakeEngine, fixture, tempWorkspace } from "./helpers.js";

const repoRoot = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const hookEntry = path.join(repoRoot, "src", "hooks", "main.ts");

test("runHook routes a Cline action through the engine and cancels a block", async () => {
  const fake = fakeEngine("block");
  const output = await runHook({
    host: "cline",
    input: JSON.stringify(fixture("cline-pre-tool-use.json", "repo-root")),
    cwd: "elsewhere",
    openEngine: fake.factory,
  });

  assert.equal(fake.actions[0]?.kind, "exec");
  assert.deepEqual(fake.roots, ["repo-root"]);
  assert.equal(fake.closed, 1);
  assert.equal(JSON.parse(output.stdout).cancel, true);
  assert.equal(output.exitCode, 0);
});

test("runHook uses the installer event name for Cursor", async () => {
  const fake = fakeEngine("sandbox");
  const payload = { ...fixture("cursor-before-shell.json", "repo-root"), hook_event_name: "" };
  const output = await runHook({ host: "cursor", event: "beforeShellExecution", input: JSON.stringify(payload), cwd: ".", openEngine: fake.factory });

  assert.equal(fake.actions[0]?.target, "npm run setup");
  assert.equal(JSON.parse(output.stdout).permission, "deny");
});

test("runHook skips the engine for observational events", async () => {
  const fake = fakeEngine("block");
  const output = await runHook({ host: "cline", input: JSON.stringify({ hookName: "TaskComplete", taskId: "t" }), cwd: ".", openEngine: fake.factory });

  assert.equal(fake.actions.length, 0);
  assert.deepEqual(JSON.parse(output.stdout), { cancel: false });
});

test("runHook fails open with host allow output when Warden fails", async () => {
  const errors: unknown[] = [];
  const broken = () => {
    throw new Error("database unavailable");
  };

  const cline = await runHook({ host: "cline", input: "{broken", cwd: ".", onError: (error) => errors.push(error) });
  const cursor = await runHook({
    host: "cursor",
    input: JSON.stringify(fixture("cursor-before-shell.json", "repo-root")),
    cwd: ".",
    openEngine: broken,
    onError: (error) => errors.push(error),
  });

  assert.deepEqual(JSON.parse(cline.stdout), { cancel: false });
  assert.deepEqual(JSON.parse(cursor.stdout), { permission: "allow" });
  assert.equal(errors.length, 2);
});

test("runHook closes the engine even when a decision throws", async () => {
  let closed = 0;
  const output = await runHook({
    host: "cursor",
    input: JSON.stringify(fixture("cursor-before-shell.json", "repo-root")),
    cwd: ".",
    openEngine: () => ({
      decide: () => {
        throw new Error("policy crash");
      },
      close: () => {
        closed += 1;
      },
    }),
  });

  assert.equal(closed, 1);
  assert.deepEqual(JSON.parse(output.stdout), { permission: "allow" });
});

test("Cline and Cursor sessions share one ledger in the protected repository", async () => {
  const workspace = tempWorkspace();
  try {
    await runHook({ host: "cline", input: JSON.stringify(fixture("cline-pre-tool-use.json", workspace)), cwd: "." });
    await runHook({ host: "cursor", input: JSON.stringify(fixture("cursor-before-shell.json", workspace)), cwd: "." });

    const store = new WardenStore(path.join(workspace, ".warden", "warden.db"));
    const rows = store.database.prepare("SELECT source, session_id AS sessionId FROM actions ORDER BY id").all();
    store.close();
    assert.deepEqual(
      rows.map((row) => ({ ...row })),
      [
        { source: "cline", sessionId: "task-poisoned-issue" },
        { source: "cursor", sessionId: "conv-second-session" },
      ],
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("hook entry point speaks JSON over stdio as a separate process", async () => {
  const workspace = tempWorkspace();
  const run = (args: string[], input: string) =>
    spawnSync(process.execPath, ["--import", "tsx", hookEntry, ...args], {
      cwd: repoRoot,
      input,
      encoding: "utf8",
      timeout: 30_000,
    });

  try {
    const allowed = run(["cline"], JSON.stringify(fixture("cline-pre-tool-use.json", workspace)));
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.deepEqual(JSON.parse(allowed.stdout), { cancel: false });
    assert.ok(existsSync(path.join(workspace, ".warden", "warden.db")));

    const broken = run(["cursor", "beforeShellExecution"], "NPM_TOKEN=secret-value");
    assert.equal(broken.status, 0);
    assert.deepEqual(JSON.parse(broken.stdout), { permission: "allow" });
    assert.match(broken.stderr, /failed open \(Hook input is not valid JSON\.\)/);
    assert.doesNotMatch(broken.stderr, /secret-value/);

    const unknownHost = run(["claude"], "{}");
    assert.equal(unknownHost.status, 1);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
