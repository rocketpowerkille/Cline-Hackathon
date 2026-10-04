export interface SessionSummary {
  sessionId: string;
  source: string;
  agent: string;
  userIntent: string;
  untrusted: boolean;
  originReason: string | null;
  originSession: string | null;
}

export interface ActionSummary {
  id: number;
  sessionId: string;
  source: string;
  agent: string;
  kind: string;
  tool: string;
  target: string;
  preview: string;
  verdict: string | null;
  reason: string | null;
  labels: string[];
  createdAt: string;
}

export interface TaintedFileSummary {
  path: string;
  writerSession: string;
  reason: string;
  snapshotPath: string | null;
  existedBefore: boolean;
  createdAt: string;
  expectedCurrentHash: string | null;
}

export interface GrantSummary {
  sessionId: string;
  keyName: string;
  grantedAt: string;
}

export interface RunTicketSummary {
  id: string;
  sessionId: string;
  command: string[];
  keyNames: string[];
  consumed: boolean;
  createdAt: string;
}

export interface SandboxSummary {
  actionId: number;
  sessionId: string;
  backend: string;
  verdict: string;
  reason: string;
  inspectedFiles: string[];
  changedFiles: string[];
  networkAttempts: string[];
  controlFiles: string[];
  canariesCount: number;
}

export interface Investigation {
  sessionId: string;
  trigger: string;
  sessions: SessionSummary[];
  actions: ActionSummary[];
  taintedFiles: TaintedFileSummary[];
  grants: GrantSummary[];
  runTickets: RunTicketSummary[];
  sandboxRuns: SandboxSummary[];
  exposedKeys: string[];
  generatedAt: string;
}

export interface RotationReceipt {
  provider: string;
  keyName: string;
  receiptId: string;
  oldFingerprint: string;
  rotatedAt: string;
}

export interface RotationOutcome {
  keyName: string;
  provider: string;
  status: "rotated" | "already-rotated" | "unsupported" | "verification-failed";
  oldRejected: boolean;
  receipt?: RotationReceipt;
  message: string;
}

export interface FileOutcome {
  path: string;
  status: "restored" | "quarantined" | "review" | "already-resolved";
  destination?: string;
  repairedHash?: string;
  message: string;
}

export interface IncidentState {
  responseMode?: "deterministic" | "agent-assisted";
  version: 1;
  incidentId: string;
  sessionId: string;
  trigger: string;
  createdAt: string;
  updatedAt: string;
  reportPath: string;
  rotations: Record<string, RotationOutcome>;
  files: Record<string, FileOutcome>;
  closed: boolean;
}

export interface ResponseResult {
  investigation: Investigation;
  rotations: RotationOutcome[];
  files: FileOutcome[];
  reportPath: string;
  closed: boolean;
  investigatorNarrative?: string;
  responderNarrative?: string;
}

export interface ResponderTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  completesRun?: boolean;
  execute(input: Record<string, unknown>): Promise<unknown> | unknown;
}

export interface AgentSessionRequest {
  role: "investigator" | "responder";
  systemPrompt: string;
  prompt: string;
  tools: ResponderTool[];
}

export interface AgentSessionResult {
  text: string;
  toolCalls: string[];
}

export interface AgentRunner {
  run(request: AgentSessionRequest): Promise<AgentSessionResult>;
}