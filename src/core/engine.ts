import { readFileSync } from "node:fs";
import { invocationCommand, parseWardenRunCommand } from "../cli/args.js";
import { guardrails, type Finding, type GuardrailStage, type PolicyContext } from "../policy/guardrails.js";
import { pathKey, type PathKey } from "../policy/targets.js";
import { externalResult, looksLikeInjection, readKeys, snapshotTaintedWrite } from "./trust.js";
import { shadowRun, type SandboxResult } from "../sandbox/shadow.js";
import { ASK_BUDGET, BLOCK_BUDGET, budgetIncrement, RiskScorer } from "../policy/risk.js";
import { waitForApproval, type ApprovalResult } from "../dashboard/approval.js";
import type { WardenStore } from "../store/database.js";
import { isFullyCanaried, scanWardenCanaries } from "../vault/canary.js";
import type { AgentAction, Decision, Verdict } from "./types.js";

export type PolicyStage = (action: AgentAction, context: PolicyContext) => Finding[] | Promise<Finding[]>;

/** Pipeline stages, run in order. Tests swap any of them; later segments add trust, risk, and approval. */
export interface EngineStages {
  guardrails: GuardrailStage;
  canaries: PolicyStage;
  sandbox: (workspaceRoot: string, action: AgentAction) => SandboxResult;
  risk: (action: AgentAction, intent: string) => Promise<Decision["risk"]>;
}

/** The slice of SecretVault the engine needs; issues a single-use ticket for an allowed `warden run`. */
export interface RunTicketIssuer {
  issueRunTicket(sessionId: string, command: readonly string[], selection: readonly string[] | null): string;
}

export interface EngineOptions {
  workspaceRoot?: string;
  stages?: Partial<EngineStages>;
  vault?: RunTicketIssuer;
  approval?: (workspaceRoot: string, decisionId: number) => Promise<ApprovalResult>;
}

/** A Warden canary leaving through any outbound action is a confirmed exfiltration attempt. */
export const canaryStage: PolicyStage = (action) => {
  const outbound = action.kind === "exec" || action.kind === "net" || action.kind === "write" || action.kind === "mcp";
  if (!outbound || scanWardenCanaries(`${action.target}\n${action.content}`).length === 0) return [];
  return [{ verdict: "block", label: "vault:canary", reason: "Blocked: a Warden secret canary appeared in outbound content." }];
};

const defaultScorer = new RiskScorer();
export const defaultStages: EngineStages = { guardrails, canaries: canaryStage, sandbox: (workspaceRoot, action) => shadowRun({ workspaceRoot, action }),
  risk: (action, intent) => defaultScorer.score(action, intent) };

/** Strictest wins. Ask outranks sandbox because only a human can resolve it. */
const severity: Record<Verdict, number> = { allow: 0, sandbox: 1, ask: 2, block: 3 };

export class Engine {
  private readonly stages: EngineStages;
  private readonly workspaceRoot: string;
  private readonly vault: RunTicketIssuer | undefined;
  private readonly approval: (workspaceRoot: string, decisionId: number) => Promise<ApprovalResult>;

  constructor(private readonly store: WardenStore, options: EngineOptions = {}) {
    this.stages = { ...defaultStages, ...options.stages };
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    if (!options.stages?.risk) this.stages.risk = (action, intent) => defaultScorer.score(action, intent, this.workspaceRoot);
    this.vault = options.vault;
    this.approval = options.approval ?? waitForApproval;
  }

  async decide(action: AgentAction): Promise<Decision> {
    const previous = this.store.sessionOrigin(action.sessionId);
    const inherited = (action.kind === "read" || action.kind === "exec") ? readKeys(action, this.workspaceRoot)
      .map((key) => ({ key, origin: this.store.fileOrigin(key) })).find((entry) => entry.origin) : undefined;
    const origin = previous ?? (inherited?.origin
      ? { reason: `read ${inherited.key} which ${inherited.origin.writerSession} wrote after ${inherited.origin.reason}`, originSession: inherited.origin.writerSession }
      : null) ?? (action.untrustedInput ? { reason: "explicit untrusted input", originSession: null } : null);
    const external = externalResult(action);
    const detected = external && looksLikeInjection(action.observedOutput ?? "");
    const newReason = external ? `reading external result from ${action.tool} ${action.target || "(unknown target)"}` : null;
    const effectiveOrigin = origin ?? (newReason ? { reason: newReason, originSession: null } : null);
    const evaluated = { ...action, untrustedInput: action.untrustedInput || !!effectiveOrigin };
    const context = this.policyContext();
    // Post hooks are audit-only: nothing observed after execution can be blocked retroactively.
    const guardrailFindings = action.post ? [] : await this.stages.guardrails(evaluated, context);
    const canaryFindings = action.post ? [] : await this.stages.canaries(evaluated, context);
    const findings = [...guardrailFindings, ...canaryFindings];
    let sandboxLabels: string[] = [];
    let sandboxResult: SandboxResult | undefined;
    let sandboxDuration = 0;
    if (!action.post && guardrailFindings.some((finding) => finding.verdict === "sandbox")
      && !findings.some((finding) => finding.verdict === "ask" || finding.verdict === "block")) {
      const started = performance.now();
      const result = this.stages.sandbox(this.workspaceRoot, evaluated);
      sandboxDuration = performance.now() - started;
      sandboxResult = result;
      sandboxLabels = result.evidence.labels;
      // Preserve guardrail labels even after shadow execution clears their sandbox requests.
      findings.splice(0, findings.length, ...findings.filter((finding) => finding.verdict !== "sandbox"));
      sandboxLabels.push(...guardrailFindings.filter((finding) => finding.verdict === "sandbox").map((finding) => finding.label));
      if (result.verdict === "block") findings.push({ verdict: "block", label: "sandbox:block", reason: result.reason });
    }
    const previousBudget = this.store.sessionBudget(action.sessionId);
    let increment = 0;
    let risk = combine([]).risk;
    if (!action.post && action.kind !== "prompt" && !findings.some((finding) => finding.verdict === "block" || finding.verdict === "ask")) {
      const intent = action.userIntent || this.store.sessionIntent(action.sessionId);
      risk = await this.stages.risk(evaluated, intent);
      increment = budgetIncrement(risk.actionProbability, action.kind);
      const total = previousBudget + increment;
      if (action.kind !== "read" && total >= BLOCK_BUDGET) findings.push({ verdict: "block", label: "risk:budget", reason: `Cumulative session risk ${total.toFixed(2)} exceeded block threshold ${BLOCK_BUDGET}.` });
      else if (action.kind !== "read" && total >= ASK_BUDGET) findings.push({ verdict: "ask", label: "risk:budget", reason: `Cumulative session risk ${total.toFixed(2)} exceeded approval threshold ${ASK_BUDGET}.` });
    }
    risk.sessionBudget = previousBudget + increment;
    // A specific guardrail/canary/sandbox finding takes precedence over a generic budget explanation.
    const specific = findings.some((finding) => finding.label !== "risk:budget" && finding.verdict !== "sandbox");
    const decision = combine(specific ? findings.filter((finding) => finding.label !== "risk:budget") : findings);
    if (specific && findings.some((finding) => finding.label === "risk:budget")) decision.labels.push("risk:budget");
    decision.risk = risk;
    decision.labels.push(...sandboxLabels);
    if (effectiveOrigin) {
      decision.labels.push("trust:untrusted");
      if (decision.verdict !== "allow") decision.reason += ` Taint: ${effectiveOrigin.reason}.`;
    }
    if (detected) decision.labels.push("trust:injection-attempt");

    // First persist ask so the existing approvals FK can reference it; finalize that row after the click.
    const ids = this.store.record({ ...evaluated, untrustedInput: (decision.verdict === "allow" || (!!action.post && action.success !== false)) && evaluated.untrustedInput,
      // Tool results are volatile and can contain secrets; retain only their separate hash.
      content: action.post ? "" : evaluated.content }, decision, increment);
    if (sandboxResult) this.store.recordSandboxRun(ids, sandboxResult, sandboxDuration);
    if (!action.post && decision.verdict === "ask") {
      let approval: ApprovalResult;
      try { approval = await this.approval(this.workspaceRoot, ids.decisionId); }
      catch { approval = { id: null, status: "denied", reason: "Approval denied: dashboard unavailable." }; }
      decision.verdict = approval.status === "approved" ? "allow" : "block";
      decision.reason = approval.status === "approved" ? `Approved in Warden dashboard. ${decision.reason}` : approval.reason;
      decision.labels.push(`approval:${approval.status}`);
      if (approval.id) decision.approvalId = approval.id;
      this.store.finalizeApproval(ids.decisionId, decision);
      if (decision.verdict === "allow" && evaluated.untrustedInput) this.store.markApprovedActionUntrusted(ids.actionId);
    }
    const runInvocation = !action.post && decision.verdict === "allow" && action.kind === "exec" && this.vault
      ? parseWardenRunCommand(action.target || action.content) : null;
    if (runInvocation) {
      decision.labels.push("vault:run-ticket");
      this.store.finalizeDecisionLabels(ids.decisionId, decision.labels);
    }
    const advanced = decision.verdict === "allow" || (!!action.post && action.success !== false);
    // Permission hooks can be denied; never taint a session or snapshot a write that did not happen.
    if (advanced) {
      if (effectiveOrigin) this.store.markUntrusted(action.sessionId, effectiveOrigin.reason, effectiveOrigin.originSession);
      if (external) this.store.recordObservation(action.sessionId, action.tool, action.target, action.observedOutput ?? "", detected);
      if (!action.post && decision.verdict === "allow" && effectiveOrigin && (action.kind === "write" || action.kind === "exec")) {
        snapshotTaintedWrite(this.store, this.workspaceRoot, action, effectiveOrigin.reason);
      }
    }
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
