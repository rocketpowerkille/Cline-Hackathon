import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { after, test } from "node:test";
import { Engine } from "../src/core/engine.js";
import { guardrails } from "../src/policy/guardrails.js";
import type { ActionKind, AgentAction, Decision, Verdict } from "../src/core/types.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

/** One real engine (default stages) over a temp workspace, closed after the test file. */
export function guardrailHarness() {
  const root = tempWorkspace();
  const store = new WardenStore(":memory:");
  const engine = new Engine(store, { workspaceRoot: root });
  after(() => {
    store.close();
    rmSync(root, { recursive: true, force: true });
  });

  const action = (kind: ActionKind, target: string, extra: Partial<AgentAction> = {}): AgentAction => ({
    source: "replay",
    sessionId: "s1",
    agent: "test",
    kind,
    tool: kind === "exec" ? "execute_command" : `${kind}_tool`,
    target,
    content: kind === "exec" ? target : "",
    untrustedInput: false,
    userIntent: "",
    ...extra,
  });

  const decide = (kind: ActionKind, target: string, extra: Partial<AgentAction> = {}): Promise<Decision> =>
    engine.decide(action(kind, target, extra));

  /** Registers one test asserting every target gets the expected verdict. */
  const cases = (name: string, kind: ActionKind, expected: Verdict, targets: string[], extra: Partial<AgentAction> = {}) =>
    test(`${name} -> ${expected}`, async () => {
      for (const target of targets) {
        const decision = await decide(kind, target, extra);
        if (expected === "sandbox") {
          const findings = await guardrails(action(kind, target, extra), { workspaceRoot: root, isCanariedEnv: () => false });
          assert.ok(findings.some((finding) => finding.verdict === "sandbox"), `${target} did not request sandbox`);
          continue; // Sandbox may allow or block based on actual evidence, not just the lexical rule.
        }
        assert.equal(decision.verdict, expected, `${kind} "${target}" -> ${decision.verdict}: ${decision.reason}`);
      }
    });

  return { root, store, engine, decide, cases };
}
