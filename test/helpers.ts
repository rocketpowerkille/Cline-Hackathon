import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AgentAction, Decision, Verdict } from "../src/core/types.js";
import type { EngineFactory } from "../src/hooks/run.js";

export function tempWorkspace(): string {
  return mkdtempSync(path.join(os.tmpdir(), "warden-"));
}

/** Loads a fixture and points every workspace field at the given root. */
export function fixture(name: string, workspace: string): Record<string, unknown> {
  const raw = readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");
  const data = JSON.parse(raw) as Record<string, unknown>;
  for (const key of ["workspaceRoots", "workspace_roots"]) if (key in data) data[key] = [workspace];
  if ("cwd" in data) data.cwd = workspace;
  return data;
}

export function decision(verdict: Verdict, reason = "test reason"): Decision {
  return {
    verdict,
    reason,
    labels: [],
    risk: {
      actionProbability: 0,
      sessionBudget: 0,
      backend: "none",
      questions: { injection: 0, secrets: 0, destructive: 0, offIntent: 0 },
    },
  };
}

export interface FakeEngine {
  factory: EngineFactory;
  actions: AgentAction[];
  roots: string[];
  closed: number;
}

export function fakeEngine(verdict: Verdict = "allow"): FakeEngine {
  const fake: FakeEngine = {
    actions: [],
    roots: [],
    closed: 0,
    factory: (root) => {
      fake.roots.push(root);
      return {
        decide: async (action) => {
          fake.actions.push(action);
          return decision(verdict, "Matched a test policy.");
        },
        close: () => {
          fake.closed += 1;
        },
      };
    },
  };
  return fake;
}
