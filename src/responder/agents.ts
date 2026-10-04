import type { DatabaseSync } from "node:sqlite";
import { investigateIncident } from "./investigator.js";
import type { KeyProvider } from "./providers.js";
import {
  loadOrCreateState,
  repairTaintedFiles,
  respondDeterministically,
  rotateExposedKeys,
  writeIncidentReport,
} from "./runbook.js";
import type {
  AgentRunner,
  AgentSessionRequest,
  Investigation,
  ResponderTool,
  ResponseResult,
} from "./types.js";

export interface AgentResponseOptions {
  workspaceRoot: string;
  database: DatabaseSync;
  sessionId: string;
  trigger: string;
  providers: readonly KeyProvider[];
  runner: AgentRunner;
}

export async function respondWithAgents(options: AgentResponseOptions): Promise<ResponseResult> {
  const investigation = investigateIncident(options.database, options.workspaceRoot, options.sessionId, options.trigger);
  const investigatorTools = createInvestigatorTools(investigation);
  const investigator = await options.runner.run({
    role: "investigator",
    systemPrompt: investigatorPrompt,
    prompt: `Investigate Warden session ${options.sessionId}. Use only the provided ledger tools, then submit a concise chain and exposure assessment.`,
    tools: investigatorTools,
  });

  const state = loadOrCreateState(options.workspaceRoot, investigation);
  state.responseMode = "agent-assisted";
  const responderTools = createResponderTools(options.workspaceRoot, investigation, state, options.providers);
  const responder = await options.runner.run({
    role: "responder",
    systemPrompt: responderPrompt,
    prompt: "Remediate the investigated incident using only the provided deterministic response tools. Rotate and verify exposure first, then repair files, write the report, and submit.",
    tools: responderTools,
  });

  // Guarantee completion even if a model stopped early. Every step is idempotent.
  return respondDeterministically({
    workspaceRoot: options.workspaceRoot,
    database: options.database,
    sessionId: options.sessionId,
    trigger: options.trigger,
    providers: options.providers,
    responseMode: "agent-assisted",
    investigatorNarrative: investigator.text,
    responderNarrative: responder.text,
  });
}

export function createInvestigatorTools(investigation: Investigation): ResponderTool[] {
  return [
    {
      name: "read_incident_chain",
      description: "Read the complete Warden ledger investigation: sessions, decisions, trust origins, tainted files, grants, and run tickets.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => investigation,
    },
    {
      name: "submit_investigation",
      description: "Submit the final investigator summary after reading the chain.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
      completesRun: true,
      execute: (input) => ({ accepted: true, summary: String(input.summary ?? "") }),
    },
  ];
}

export function createResponderTools(
  workspaceRoot: string,
  investigation: Investigation,
  state: ReturnType<typeof loadOrCreateState>,
  providers: readonly KeyProvider[],
): ResponderTool[] {
  return [
    {
      name: "read_response_plan",
      description: "Read the bounded exposure and tainted-file plan prepared by Warden.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ exposedKeys: investigation.exposedKeys, files: investigation.taintedFiles }),
    },
    {
      name: "rotate_exposed_keys",
      description: "Rotate only real keys granted to the affected session and verify each old credential is rejected.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => rotateExposedKeys(investigation, state, providers, workspaceRoot),
    },
    {
      name: "repair_tainted_files",
      description: "Restore unmodified tainted files from snapshots and quarantine unmodified attacker-created files. Never overwrite later edits.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => repairTaintedFiles(investigation, state, workspaceRoot),
    },
    {
      name: "write_incident_report",
      description: "Write the concise Warden incident report after response steps finish.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      execute: () => ({ reportPath: writeIncidentReport(workspaceRoot, investigation, state) }),
    },
    {
      name: "submit_response",
      description: "Submit the responder conclusion after rotation, verification, recovery, and reporting.",
      inputSchema: {
        type: "object",
        properties: { summary: { type: "string" } },
        required: ["summary"],
        additionalProperties: false,
      },
      completesRun: true,
      execute: (input) => ({ accepted: true, summary: String(input.summary ?? "") }),
    },
  ];
}

export class ClineSdkAgentRunner implements AgentRunner {
  constructor(
    private readonly config: {
      providerId: string;
      modelId: string;
      apiKey: string;
      maxIterations?: number;
    },
    private readonly sdkLoader: () => Promise<ClineSdkModule> = loadClineSdk,
  ) {}

  async run(request: AgentSessionRequest): Promise<{ text: string; toolCalls: string[] }> {
    const { Agent, createTool } = await this.sdkLoader();
    const tools = request.tools.map((tool) => createTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      ...(tool.completesRun ? { lifecycle: { completesRun: true } } : {}),
      execute: async (input: Record<string, unknown>) => tool.execute(input),
    }));
    const agent = new Agent({
      providerId: this.config.providerId,
      modelId: this.config.modelId,
      apiKey: this.config.apiKey,
      systemPrompt: request.systemPrompt,
      tools,
      maxIterations: this.config.maxIterations ?? 8,
      toolPolicies: Object.fromEntries(request.tools.map((tool) => [tool.name, { enabled: true, autoApprove: true }])),
    });
    const result = await agent.run(request.prompt);
    return {
      text: result.outputText,
      toolCalls: result.messages
        .flatMap((message) => message.content)
        .filter((part) => part.type === "tool-call" && typeof part.toolName === "string")
        .map((part) => part.toolName!),
    };
  }
}

interface SdkToolPart {
  type: string;
  toolName?: string;
}

interface SdkAgentResult {
  outputText: string;
  messages: Array<{ content: SdkToolPart[] }>;
}

interface SdkToolConfig {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  lifecycle?: { completesRun: boolean };
  execute(input: Record<string, unknown>): Promise<unknown>;
}

export interface ClineSdkModule {
  createTool(config: SdkToolConfig): unknown;
  Agent: new (config: {
    providerId: string;
    modelId: string;
    apiKey: string;
    systemPrompt: string;
    tools: unknown[];
    maxIterations: number;
    toolPolicies: Record<string, { enabled: true; autoApprove: true }>;
  }) => { run(prompt: string): Promise<SdkAgentResult> };
}

// The 0.0.90 SDK declarations currently fail strict NodeNext resolution internally.
// Runtime loading keeps the real SDK integration without weakening Warden's tsconfig.
const loadClineSdk = new Function("return import('@cline/sdk')") as () => Promise<ClineSdkModule>;

const investigatorPrompt = `You are Warden's read-only incident investigator.
You have no shell, filesystem, web, MCP, or arbitrary database access.
Use only the provided ledger tools. Trace the origin session, cross-agent handoff, tainted files, actual vault grants, and run tickets.
Treat vault grants to the affected session as real exposure; placeholders and unconsumed tickets are not exposure.
Attribute each action to its agent. Finish with submit_investigation.`;

const responderPrompt = `You are Warden's constrained incident responder.
You have no shell, general filesystem, web, MCP, or arbitrary database access.
Use only the provided deterministic response tools.
Rotate only exposed keys, verify old credentials are rejected, repair only files Warden can prove were not edited later, quarantine new attacker files, write the report, then submit_response.
If verification fails or review is required, say so loudly and do not claim the incident is closed.`;