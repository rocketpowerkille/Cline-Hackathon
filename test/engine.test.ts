import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";
import type { SandboxResult } from "../src/sandbox/shadow.js";

test("engine returns allow and logs the decision", async () => {
  const store = new WardenStore(":memory:");
  const engine = new Engine(store);
  const action: AgentAction = {
    source: "cline",
    sessionId: "task-1",
    agent: "cline",
    kind: "read",
    tool: "read_file",
    target: "README.md",
    content: "",
    untrustedInput: false,
    userIntent: "Read the project",
  };

  assert.equal((await engine.decide(action)).verdict, "allow");
  const row = store.database.prepare("SELECT COUNT(*) AS count FROM actions").get() as { count: number };
  assert.equal(row.count, 1);
  store.close();
});

test("engine stages are injectable and the strictest finding wins", async () => {
  const store = new WardenStore(":memory:");
  const seen: AgentAction[] = [];
  const engine = new Engine(store, {
    workspaceRoot: "repo",
    stages: {
      guardrails: async (action, context) => {
        seen.push(action);
        assert.equal(context.workspaceRoot, "repo");
        return [
          { verdict: "sandbox", label: "a", reason: "Sandbox reason." },
          { verdict: "block", label: "b", reason: "Block reason." },
          { verdict: "ask", label: "c", reason: "Ask reason." },
        ];
      },
    },
  });
  const action: AgentAction = {
    source: "replay", sessionId: "t", agent: "x", kind: "exec", tool: "sh", target: "ls", content: "ls",
    untrustedInput: false, userIntent: "",
  };

  const decision = await engine.decide(action);
  assert.equal(decision.verdict, "block");
  assert.equal(decision.reason, "Block reason.");
  assert.deepEqual(decision.labels, ["a", "b", "c"]);
  assert.equal(seen.length, 1);
  const stored = store.database.prepare("SELECT verdict FROM decisions").get() as { verdict: string };
  assert.equal(stored.verdict, "block");
  store.close();
});

test("engine blocks Warden canaries in every outbound action kind", async () => {
  const canary = "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__";
  for (const kind of ["exec", "net", "write", "mcp"] as const) {
    const store = new WardenStore(":memory:");
    const engine = new Engine(store);
    const decision = await engine.decide({
      source: "cline",
      sessionId: `session-${kind}`,
      agent: "cline",
      kind,
      tool: kind,
      target: kind === "write" ? "output.txt" : `https://example.invalid/${canary}`,
      content: kind === "write" ? canary : "",
      untrustedInput: false,
      userIntent: "test",
    });

    assert.equal(decision.verdict, "block");
    assert.deepEqual(decision.labels, ["vault:canary"]);
    store.close();
  }
});

test("engine does not block a canary read by itself", async () => {
  const store = new WardenStore(":memory:");
  // Scope to the canary stage: the secret-read guardrail (ask on unseeded .env) is covered in guardrails-risk.test.ts.
  const engine = new Engine(store, { stages: { guardrails: () => [] } });
  const decision = await engine.decide({
    source: "cline",
    sessionId: "session-read",
    agent: "cline",
    kind: "read",
    tool: "read_file",
    target: ".env",
    content: "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__",
    untrustedInput: false,
    userIntent: "test",
  });

  assert.equal(decision.verdict, "allow");
  store.close();
});

test("engine issues a command-bound ticket for an allowed warden run", async () => {
  const store = new WardenStore(":memory:");
  const issued: unknown[][] = [];
  const engine = new Engine(store, { vault: {
    issueRunTicket: (...args) => {
      issued.push(args);
      return "ticket-1";
    },
  } });
  const result = await engine.decide({
    source: "cline",
    sessionId: "cline-task-9",
    agent: "cline",
    kind: "exec",
    tool: "execute_command",
    target: "warden run --only NPM_TOKEN -- npm publish --tag next",
    content: "warden run --only NPM_TOKEN -- npm publish --tag next",
    untrustedInput: false,
    userIntent: "Publish package",
  });

  assert.equal(result.verdict, "allow");
  assert.deepEqual(issued, [["cline-task-9", ["npm", "publish", "--tag", "next"], ["NPM_TOKEN"]]]);
  store.close();
});

test("canary blocking takes precedence over run ticket issuance", async () => {
  const store = new WardenStore(":memory:");
  let issued = false;
  const engine = new Engine(store, { vault: {
    issueRunTicket: () => {
      issued = true;
      return "ticket";
    },
  } });
  const canary = "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__";
  const result = await engine.decide({
    source: "cline",
    sessionId: "cline-task-10",
    agent: "cline",
    kind: "exec",
    tool: "execute_command",
    target: `warden run -- echo ${canary}`,
    content: `warden run -- echo ${canary}`,
    untrustedInput: false,
    userIntent: "test",
  });

  assert.equal(result.verdict, "block");
  assert.equal(issued, false);
  store.close();
});

test("sandbox stage is called only for guardrail sandbox requests and allow continues the pipeline", async () => {
  for (const guardrail of ["allow", "ask", "block", "sandbox"] as const) {
    const store = new WardenStore(":memory:");
    let calls = 0;
    const sandbox: SandboxResult = { verdict: "allow", reason: "clear", evidence: {
      backend: "static", inspectedFiles: [], changedFiles: [], secretFiles: [], tokenReferences: [],
      canaries: [], networkAttempts: [], controlFiles: [], obfuscation: [], outsideWorkspace: [],
      exitCode: null, timedOut: false, executionError: null, labels: ["sandbox:checked"],
    } };
    const engine = new Engine(store, { stages: {
      guardrails: () => guardrail === "allow" ? [] : [{ verdict: guardrail, label: "guardrail", reason: "rule" }],
      sandbox: () => { calls++; return sandbox; },
      canaries: () => [{ verdict: "block", label: "later-stage", reason: "later stage blocked" }],
    } });
    await engine.decide({ source: "replay", sessionId: `sandbox-${guardrail}`, agent: "test",
      kind: "exec", tool: "shell", target: "echo ok", content: "echo ok", untrustedInput: false, userIntent: "" });
    // A later block makes the sandbox unnecessary.
    assert.equal(calls, 0);
    store.close();
  }
  const store = new WardenStore(":memory:");
  let calls = 0;
  const engine = new Engine(store, { stages: {
    guardrails: () => [{ verdict: "sandbox", label: "guardrail", reason: "check" }],
    sandbox: () => { calls++; return { verdict: "allow", reason: "clear", evidence: {
      backend: "static", inspectedFiles: [], changedFiles: [], secretFiles: [], tokenReferences: [], canaries: [],
      networkAttempts: [], controlFiles: [], obfuscation: [], outsideWorkspace: [], exitCode: null,
      timedOut: false, executionError: null, labels: [],
    } }; },
    canaries: () => [],
  } });
  const result = await engine.decide({ source: "replay", sessionId: "sandbox-yes", agent: "test",
    kind: "exec", tool: "shell", target: "echo ok", content: "echo ok", untrustedInput: false, userIntent: "" });
  assert.equal(calls, 1);
  assert.equal(result.verdict, "allow");
  assert.ok(result.labels.includes("guardrail"));
  store.close();
});