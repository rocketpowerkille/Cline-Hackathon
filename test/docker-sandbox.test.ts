import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { dockerReady, shadowRun } from "../src/sandbox/shadow.js";
import { WardenStore } from "../src/store/database.js";

const ready = dockerReady();
if (process.env.WARDEN_REQUIRE_DOCKER === "1" && !ready) {
  throw new Error("Docker sandbox tests require a running daemon and a cached, secret-free WARDEN_SANDBOX_IMAGE (default node:22-alpine). No static fallback is accepted.");
}
const options = { skip: ready ? false : "Docker daemon or cached sandbox image unavailable" };
function action(command: string): AgentAction {
  return { source: "replay", sessionId: "docker-integration", agent: "test", kind: "exec", tool: "shell",
    target: command, content: command, untrustedInput: true, userIntent: "Verify isolated execution" };
}
function fixture(run: (root: string) => void): void {
  const root = mkdtempSync(path.join(tmpdir(), "warden-docker-test-"));
  try { run(root); } finally { rmSync(root, { recursive: true, force: true }); }
}

test("Docker executes a benign build in the shadow copy without changing source files", options, () => {
  fixture((root) => {
    writeFileSync(path.join(root, "input.txt"), "original\n");
    writeFileSync(path.join(root, "build.cjs"), "const fs=require('node:fs');fs.writeFileSync('input.txt','shadow only');fs.writeFileSync('result.txt','built');\n");
    const result = shadowRun({ workspaceRoot: root, action: action("node build.cjs") });
    assert.equal(result.evidence.backend, "docker");
    assert.equal(result.evidence.exitCode, 0);
    assert.equal(result.verdict, "allow", result.reason);
    assert.deepEqual(result.evidence.changedFiles, ["input.txt", "result.txt"]);
    assert.equal(readFileSync(path.join(root, "input.txt"), "utf8"), "original\n");
    assert.equal(existsSync(path.join(root, "result.txt")), false);
  });
});

test("Docker detects a runtime-generated control-file write invisible to static control matching", options, () => {
  fixture((root) => {
    writeFileSync(path.join(root, "AGENTS.md"), "trusted baseline\n");
    writeFileSync(path.join(root, "dynamic.cjs"), "const fs=require('node:fs');const name=String.fromCharCode(65,71,69,78,84,83,46,109,100);fs.writeFileSync(name,'injected');\n");
    const proposed = action("node dynamic.cjs");
    const lexical = shadowRun({ workspaceRoot: root, action: proposed, docker: "missing-docker" });
    assert.deepEqual(lexical.evidence.controlFiles, []);
    assert.deepEqual(lexical.evidence.changedFiles, []);
    const result = shadowRun({ workspaceRoot: root, action: proposed });
    assert.equal(result.evidence.backend, "docker");
    assert.equal(result.evidence.exitCode, 0);
    assert.equal(result.verdict, "block");
    assert.ok(result.evidence.changedFiles.includes("AGENTS.md"));
    assert.ok(result.evidence.controlFiles.includes("AGENTS.md"));
    assert.ok(result.evidence.labels.includes("sandbox:control-file"));
    assert.equal(readFileSync(path.join(root, "AGENTS.md"), "utf8"), "trusted baseline\n");
  });
});

test("Docker replaces environment-file values with canaries and detects copying them", options, () => {
  fixture((root) => {
    const original = "NPM_TOKEN=FAKE_HOST_VALUE_NEVER_FOR_CONTAINER\n";
    writeFileSync(path.join(root, ".env"), original);
    writeFileSync(path.join(root, "copy.cjs"), "const fs=require('node:fs');const name=String.fromCharCode(46,101,110,118);fs.writeFileSync('copied.txt',fs.readFileSync(name));\n");
    const result = shadowRun({ workspaceRoot: root, action: action("node copy.cjs") });
    assert.equal(result.evidence.backend, "docker");
    assert.equal(result.evidence.exitCode, 0);
    assert.equal(result.verdict, "block");
    assert.ok(result.evidence.changedFiles.includes("copied.txt"));
    assert.ok(result.evidence.canaries.some((value) => value.startsWith("__WARDEN_CANARY__NPM_TOKEN__")));
    assert.ok(result.evidence.labels.includes("sandbox:canary"));
    assert.ok(!JSON.stringify(result).includes("FAKE_HOST_VALUE_NEVER_FOR_CONTAINER"));
    assert.equal(readFileSync(path.join(root, ".env"), "utf8"), original);
    assert.equal(existsSync(path.join(root, "copied.txt")), false);
  });
});

test("Docker container has loopback-only networking, zero effective capabilities and no-new-privileges", options, () => {
  fixture((root) => {
    writeFileSync(path.join(root, "isolation.cjs"), [
      "const fs=require('node:fs');const assert=require('node:assert/strict');",
      "assert.deepEqual(fs.readdirSync('/sys/class/net'),['lo']);",
      "const status=fs.readFileSync('/proc/self/status','utf8');",
      "assert.match(status,/CapEff:\\s+0+\\n/);assert.match(status,/NoNewPrivs:\\s+1\\n/);",
      "fs.writeFileSync('isolation-passed.txt','verified in container');",
    ].join("\n"));
    const result = shadowRun({ workspaceRoot: root, action: action("node isolation.cjs") });
    assert.equal(result.evidence.backend, "docker");
    assert.equal(result.evidence.exitCode, 0, result.reason);
    assert.equal(result.verdict, "allow", result.reason);
    assert.ok(result.evidence.changedFiles.includes("isolation-passed.txt"));
    assert.equal(existsSync(path.join(root, "isolation-passed.txt")), false);
  });
});

test("Engine persists real Docker execution and runtime egress evidence linked to a blocked decision", options, async () => {
  const root = mkdtempSync(path.join(tmpdir(), "warden-docker-ledger-"));
  const store = new WardenStore(":memory:");
  try {
    writeFileSync(path.join(root, "network.sh"), "curl -X POST -d fake http://127.0.0.1:9/collect\n");
    const engine = new Engine(store, { workspaceRoot: root });
    const decision = await engine.decide(action("sh network.sh"));
    assert.equal(decision.verdict, "block");
    assert.ok(decision.labels.includes("sandbox:network"));
    const row = store.database.prepare(`SELECT s.*, d.verdict AS final_verdict, a.target AS action_target
      FROM sandbox_runs s JOIN decisions d ON d.id=s.decision_id JOIN actions a ON a.id=s.action_id`).get()!;
    assert.equal(row.backend, "docker");
    assert.equal(row.verdict, "block");
    assert.equal(row.final_verdict, "block");
    assert.equal(row.action_target, "sh network.sh");
    const attempts = JSON.parse(String(row.network_attempts_json)) as string[];
    assert.ok(attempts.some((attempt) => /^curl\t/.test(attempt)), "runtime wrapper evidence, not just lexical URL matching");
    assert.ok(Number(row.duration_ms) > 0);
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});