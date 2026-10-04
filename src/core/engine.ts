import { readFileSync } from "node:fs";
import { invocationCommand, parseWardenRunCommand } from "../cli/args.js";
import { guardrails, type Finding, type GuardrailStage, type PolicyContext } from "../policy/guardrails.js";
import { pathKey, type PathKey } from "../policy/targets.js";
import type { WardenStore } from "../store/database.js";
import { isFullyCanaried, scanWardenCanaries } from "../vault/canary.js";
import type { AgentAction, Decision, Verdict } from "./types.js";

export type PolicyStage = (action: AgentAction, context: PolicyContext) => Finding[] | Promise<Finding[]>;

/** Pipeline stages, run in order. Tests swap any of them; later segments add trust, risk, and approval. */
export interface EngineStages {
  guardrails: GuardrailStage;
  canaries: PolicyStage;
}

/** The slice of SecretVault the engine needs; issues a single-use ticket for an allowed `warden run`. */
export interface RunTicketIssuer {
  issueRunTicket(sessionId: string, command: readonly string[], selection: readonly string[] | null): string;
}

export interface EngineOptions {
  workspaceRoot?: string;
  stages?: Partial<EngineStages>;
  vault?: RunTicketIssuer;
}

/** A Warden canary leaving through any outbound action is a confirmed exfiltration attempt. */
export const canaryStage: PolicyStage = (action) => {
  const outbound = action.kind === "exec" || action.kind === "net" || action.kind === "write" || action.kind === "mcp";
  if (!outbound || scanWardenCanaries(`${action.target}\n${action.content}`).length === 0) return [];
  return [{ verdict: "block", label: "vault:canary", reason: "Blocked: a Warden secret canary appeared in outbound content." }];
};

export const defaultStages: EngineStages = { guardrails, canaries: canaryStage };

/** Strictest wins. Ask outranks sandbox because only a human can resolve it. */
const severity: Record<Verdict, number> = { allow: 0, sandbox: 1, ask: 2, block: 3 };

export class Engine {
  private readonly stages: EngineStages;
  private readonly workspaceRoot: string;
  private readonly vault: RunTicketIssuer | undefined;

  constructor(private readonly store: WardenStore, options: EngineOptions = {}) {
    this.stages = { ...defaultStages, ...options.stages };
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.vault = options.vault;
  }

  async decide(action: AgentAction): Promise<Decision> {
    const context = this.policyContext();
    const findings = [
      ...(await this.stages.guardrails(action, context)),
      ...(await this.stages.canaries(action, context)),
    ];
    const decision = combine(findings);

    // Only a fully allowed `warden run` earns a ticket; any block/ask/sandbox suppresses it.
    const runInvocation =
      decision.verdict === "allow" && action.kind === "exec" && this.vault
        ? parseWardenRunCommand(action.target || action.content)
        : null;
    if (runInvocation) decision.labels.push("vault:run-ticket");

    this.store.record(action, decision);
    if (runInvocation && this.vault) {
      this.vault.issueRunTicket(action.sessionId, invocationCommand(runInvocation), runInvocation.only);
    }
    return decision;
  }

  private policyContext(): PolicyContext {
    const root = this.workspaceRoot;
    let seeded: Set<string> | undefined;
    return {
      workspaceRoot: root,
      isCanariedEnv: (file: PathKey) => {
        seeded ??= new Set(this.store.vaultSourcePaths().map((source) => pathKey(root, source)?.key ?? ""));
        if (!seeded.has(file.key)) return false;
        try {
          // Re-check contents: a seeded file can later regain real values.
          return isFullyCanaried(readFileSync(file.resolved, "utf8"));
        } catch {
          return false;
        }
      },
    };
  }
}

export function combine(findings: Finding[]): Decision {
  const verdict = findings.reduce<Verdict>((worst, finding) => (severity[finding.verdict] > severity[worst] ? finding.verdict : worst), "allow");
  const top = findings.filter((finding) => finding.verdict === verdict);
  const secrets = findings.some((finding) => finding.label === "vault:canary") ? 1 : 0;
  return {
    verdict,
    reason: verdict === "allow" ? "Allowed: no Warden policy matched." : [...new Set(top.map((finding) => finding.reason))].join(" "),
    labels: [...new Set(findings.map((finding) => finding.label))],
    risk: {
      actionProbability: secrets,
      sessionBudget: 0,
      backend: "none",
      questions: { injection: 0, secrets, destructive: 0, offIntent: 0 },
    },
  };
}
