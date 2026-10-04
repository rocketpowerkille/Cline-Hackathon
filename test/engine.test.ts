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