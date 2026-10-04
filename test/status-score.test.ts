import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { runCli } from "../src/cli/warden.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

test("status and score are read-only when absent and summarize stored decisions", async () => {
  const root = tempWorkspace();
  const cwd = process.cwd();
  const output = new PassThrough();
  const io = { stdin: new PassThrough(), stdout: output, stderr: output, promptSecret: async () => "" };
  process.chdir(root);
  try {
    assert.equal(await runCli(["status"], io, () => { throw new Error("should not open keychain"); }), 0);
    assert.equal(await runCli(["score"], io, () => { throw new Error("should not open keychain"); }), 0);
    const store = new WardenStore(path.join(root, ".warden", "warden.db"));
    store.database.prepare("INSERT INTO sessions (session_id,source,agent,risk_budget,created_at,updated_at) VALUES ('sample','replay','test',1.25,'now','now')").run();
    store.close();
    assert.equal(await runCli(["status"], io, () => { throw new Error("should not open keychain"); }), 0);
    assert.equal(await runCli(["score", "sample"], io, () => { throw new Error("should not open keychain"); }), 0);
    const text = String(output.read());
    assert.match(text, /Warden ledger not initialized/);
    assert.match(text, /Sessions: 1/);
    assert.match(text, /Sandbox runs: 0/);
    assert.match(text, /sample: 1\.250 \(ask 1\.2, block 2\.3\)/);
  } finally { process.chdir(cwd); rmSync(root, { recursive: true, force: true }); }
});