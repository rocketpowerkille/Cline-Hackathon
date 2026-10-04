import assert from "node:assert/strict";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import type { AgentAction } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";

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