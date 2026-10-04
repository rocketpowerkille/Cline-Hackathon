import { readFileSync } from "node:fs";
import { guardrails, type Finding, type GuardrailStage, type PolicyContext } from "../policy/guardrails.js";
import { pathKey, type PathKey } from "../policy/targets.js";
import type { WardenStore } from "../store/database.js";
import { isFullyCanaried } from "../vault/canary.js";
import type { AgentAction, Decision, Verdict } from "./types.js";

/** Pipeline stages. Tests swap any of them; later segments add trust, risk, sandbox, and approval here. */
export interface EngineStages {
  guardrails: GuardrailStage;
}

export interface EngineOptions {
  workspaceRoot?: string;
  stages?: Partial<EngineStages>;
}

export const defaultStages: EngineStages = { guardrails };

/** Strictest wins. Ask outranks sandbox because only a human can resolve it. */
const severity: Record<Verdict, number> = { allow: 0, sandbox: 1, ask: 2, block: 3 };

export class Engine {
  private readonly stages: EngineStages;
  private readonly workspaceRoot: string;

  constructor(private readonly store: WardenStore, options: EngineOptions = {}) {
    this.stages = { ...defaultStages, ...options.stages };
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
  }

  async decide(action: AgentAction): Promise<Decision> {
    const findings = await this.stages.guardrails(action, this.policyContext());
    const decision = combine(findings);
    this.store.record(action, decision);
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
  return {
    verdict,
    reason: verdict === "allow" ? "Allowed: no Warden policy matched." : [...new Set(top.map((finding) => finding.reason))].join(" "),
    labels: [...new Set(findings.map((finding) => finding.label))],
    risk: {
      actionProbability: 0,
      sessionBudget: 0,
      backend: "none",
      questions: { injection: 0, secrets: 0, destructive: 0, offIntent: 0 },
    },
  };
}
