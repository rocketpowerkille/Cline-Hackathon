import type { AgentAction, Decision } from "./types.js";
import { WardenStore } from "../store/database.js";

const zeroQuestions = {
  injection: 0,
  secrets: 0,
  destructive: 0,
  offIntent: 0,
} as const;

export class Engine {
  constructor(private readonly store: WardenStore) {}

  decide(action: AgentAction): Decision {
    // Segment 00 deliberately allows everything. Policy starts in Segments 01-02.
    const decision: Decision = {
      verdict: "allow",
      reason: "Allowed: no Warden policy matched.",
      labels: [],
      risk: {
        actionProbability: 0,
        sessionBudget: 0,
        backend: "none",
        questions: { ...zeroQuestions },
      },
    };

    this.store.record(action, decision);
    return decision;
  }
}