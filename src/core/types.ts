export const actionSources = ["cline", "cursor", "replay"] as const;
export type ActionSource = (typeof actionSources)[number];

export const actionKinds = ["read", "write", "exec", "net", "mcp", "prompt"] as const;
export type ActionKind = (typeof actionKinds)[number];

export interface AgentAction {
  source: ActionSource;
  sessionId: string;
  agent: string;
  kind: ActionKind;
  tool: string;
  target: string;
  content: string;
  untrustedInput: boolean;
  userIntent: string;
  /** Observational hook result; never saved as an action preview. */
  observedOutput?: string;
  /** Only post-execution hooks set this. */
  post?: boolean;
  success?: boolean;
}

export const verdicts = ["allow", "ask", "sandbox", "block"] as const;
export type Verdict = (typeof verdicts)[number];

export interface RiskQuestions {
  injection: number;
  secrets: number;
  destructive: number;
  offIntent: number;
}

export type RiskBackend = "ollama" | "cloudflare" | "heuristic" | "none";

export interface DecisionRisk {
  actionProbability: number;
  sessionBudget: number;
  backend: RiskBackend;
  questions: RiskQuestions;
}

export interface Decision {
  verdict: Verdict;
  reason: string;
  labels: string[];
  risk: DecisionRisk;
  approvalId?: string;
}

export interface StoredDecision {
  actionId: number;
  decisionId: number;
}