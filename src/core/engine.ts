import type { AgentAction, Decision } from "./types.js";
import { WardenStore } from "../store/database.js";
import { invocationCommand, parseWardenRunCommand } from "../cli/args.js";
import { scanWardenCanaries } from "../vault/secrets.js";

const zeroQuestions = {
  injection: 0,
  secrets: 0,
  destructive: 0,
  offIntent: 0,
} as const;

export class Engine {
  constructor(
    private readonly store: WardenStore,
    private readonly vault?: {
      issueRunTicket(
        sessionId: string,
        command: readonly string[],
        selection: readonly string[] | null,
      ): string;
    },
  ) {}

  decide(action: AgentAction): Decision {
    const canaries = isOutbound(action) ? scanWardenCanaries(`${action.target}\n${action.content}`) : [];
    const decision: Decision = canaries.length > 0 ? {
      verdict: "block",
      reason: "Blocked: a Warden secret canary appeared in outbound content.",
      labels: ["vault:canary"],
      risk: {
        actionProbability: 1,
        sessionBudget: 0,
        backend: "none",
        questions: { ...zeroQuestions, secrets: 1 },
      },
    } : {
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

    let runInvocation: ReturnType<typeof parseWardenRunCommand> = null;
    if (decision.verdict === "allow" && action.kind === "exec" && this.vault) {
      runInvocation = parseWardenRunCommand(action.target || action.content);
      if (runInvocation) {
        decision.labels.push("vault:run-ticket");
      }
    }

    this.store.record(action, decision);
    if (runInvocation && this.vault) {
      this.vault.issueRunTicket(action.sessionId, invocationCommand(runInvocation), runInvocation.only);
    }
    return decision;
  }
}

function isOutbound(action: AgentAction): boolean {
  return action.kind === "exec" || action.kind === "net" || action.kind === "write" || action.kind === "mcp";
}