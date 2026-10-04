import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";

test("engine returns allow and logs the decision", () => {
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

  assert.equal(engine.decide(action).verdict, "allow");
  const row = store.database.prepare("SELECT COUNT(*) AS count FROM actions").get() as { count: number };
  assert.equal(row.count, 1);
  store.close();
});

test("engine blocks Warden canaries in every outbound action kind", () => {
  const canary = "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__";
  for (const kind of ["exec", "net", "write", "mcp"] as const) {
    const store = new WardenStore(":memory:");
    const engine = new Engine(store);
    const decision = engine.decide({
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

test("engine does not block a canary read by itself", () => {
  const store = new WardenStore(":memory:");
  const engine = new Engine(store);
  const decision = engine.decide({
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

test("engine issues a command-bound ticket for an allowed warden run", () => {
  const store = new WardenStore(":memory:");
  const issued: unknown[][] = [];
  const engine = new Engine(store, {
    issueRunTicket: (...args) => {
      issued.push(args);
      return "ticket-1";
    },
  });
  const result = engine.decide({
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

test("canary blocking takes precedence over run ticket issuance", () => {
  const store = new WardenStore(":memory:");
  let issued = false;
  const engine = new Engine(store, {
    issueRunTicket: () => {
      issued = true;
      return "ticket";
    },
  });
  const canary = "__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__";
  const result = engine.decide({
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