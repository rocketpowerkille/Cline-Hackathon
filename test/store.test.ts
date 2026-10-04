import assert from "node:assert/strict";
import test from "node:test";
import type { AgentAction, Decision } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";

const action: AgentAction = {
  source: "replay",
  sessionId: "session-1",
  agent: "test-agent",
  kind: "exec",
  tool: "shell",
  target: "npm test",
  content: "NPM_TOKEN=obviously-fake-token",
  untrustedInput: false,
  userIntent: "Run tests",
};

const decision: Decision = {
  verdict: "allow",
  reason: "Allowed for test.",
  labels: [],
  risk: {
    actionProbability: 0,
    sessionBudget: 0,
    backend: "none",
    questions: { injection: 0, secrets: 0, destructive: 0, offIntent: 0 },
  },
};

test("store records a redacted action and decision in one ledger", () => {
  const store = new WardenStore(":memory:");
  const ids = store.record(action, decision);

  assert.equal(ids.actionId, 1);
  assert.equal(ids.decisionId, 1);
  const savedDecision = store.database.prepare("SELECT verdict FROM decisions").get() as { verdict: string };
  const savedAction = store.database.prepare("SELECT content_preview FROM actions").get() as {
    content_preview: string;
  };
  assert.equal(savedDecision.verdict, "allow");
  assert.equal(savedAction.content_preview, "NPM_TOKEN=[REDACTED]");
  store.close();
});