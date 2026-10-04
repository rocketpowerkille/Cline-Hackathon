import type { ActionKind, AgentAction, Decision } from "../core/types.js";
import {
  agentGuidance,
  denialMessage,
  firstRoot,
  firstText,
  HookInputError,
  isAllowed,
  json,
  record,
  text,
  type HostAdapter,
  type JsonRecord,
  type NormalizedHook,
} from "./common.js";

interface ToolMapping {
  kind: ActionKind;
  target: string;
  content: string;
}

/** Cline tools that only talk to the user or manage context; they never reach the policy engine. */
const passthroughTools = new Set([
  "ask_followup_question",
  "plan_mode_respond",
  "act_mode_respond",
  "focus_chain",
  "condense",
  "summarize_task",
  "load_mcp_documentation",
]);

export function mapClineTool(tool: string, params: JsonRecord): ToolMapping | null {
  const value = (...keys: string[]) => firstText(params, keys);

  switch (tool) {
    case "read_file":
    case "list_files":
    case "list_code_definition_names":
      return { kind: "read", target: value("path"), content: "" };
    case "search_files":
      return { kind: "read", target: value("path"), content: value("regex") };
    case "use_skill":
      return { kind: "read", target: value("skill_name", "name"), content: "" };
    case "write_to_file":
    case "new_rule":
      return { kind: "write", target: value("path"), content: value("content") };
    case "replace_in_file":
      return { kind: "write", target: value("path"), content: value("diff") };
    case "apply_patch": {
      const patch = value("input", "patch", "diff");
      const file = /\*\*\* (?:Add|Update|Delete) File: (.+)/.exec(patch)?.[1]?.trim() ?? "";
      return { kind: "write", target: value("path") || file, content: patch };
    }
    case "execute_command":
      return { kind: "exec", target: value("command"), content: value("command") };
    case "attempt_completion": {
      // attempt_completion may run a demonstration command, so it is an exec when one is present.
      const command = value("command");
      return command ? { kind: "exec", target: command, content: command } : null;
    }
    case "web_fetch":
      return { kind: "net", target: value("url"), content: value("prompt") };
    case "web_search":
      return { kind: "net", target: value("query"), content: value("query") };
    case "browser_action":
      return { kind: "net", target: value("url") || value("action"), content: value("text", "coordinate") };
    case "report_bug":
      return { kind: "net", target: "github.com/cline/cline", content: value("title") };
    case "use_mcp_tool":
      return { kind: "mcp", target: `${value("server_name")}/${value("tool_name")}`, content: value("arguments") };
    case "access_mcp_resource":
      return { kind: "mcp", target: `${value("server_name")}/${value("uri")}`, content: "" };
    case "new_task":
      return { kind: "prompt", target: "new_task", content: value("context") };
    case "use_subagents":
      return { kind: "prompt", target: "use_subagents", content: JSON.stringify(params) };
    default:
      if (passthroughTools.has(tool)) return null;
      // Dynamic and plugin tools are external capabilities; the MCP kind keeps them under policy.
      return { kind: "mcp", target: tool, content: JSON.stringify(params) };
  }
}

export const clineAdapter: HostAdapter = {
  eventName(payload) {
    return text(payload.hookName);
  },

  normalize(event, payload, environment): NormalizedHook {
    const workspaceRoot = firstRoot(payload.workspaceRoots) ?? environment.cwd;
    const base = {
      source: "cline",
      sessionId: text(payload.taskId) || "unknown",
      agent: "cline",
      untrustedInput: false,
      userIntent: "",
    } as const;

    switch (event) {
      case "PreToolUse": {
        const data = record(payload.preToolUse);
        const tool = text(data.toolName);
        if (!tool) throw new HookInputError("Cline PreToolUse input is missing preToolUse.toolName.");
        const mapped = mapClineTool(tool, record(data.parameters));
        const action: AgentAction | null = mapped && { ...base, tool, ...mapped };
        return { workspaceRoot, action };
      }
      case "PostToolUse": {
        const data = record(payload.postToolUse);
        const tool = text(data.toolName);
        if (!tool) throw new HookInputError("Cline PostToolUse input is missing postToolUse.toolName.");
        const mapped = mapClineTool(tool, record(data.parameters));
        return { workspaceRoot, action: mapped && {
          ...base, ...mapped, tool, post: true, success: data.success !== false,
          observedOutput: text(data.result),
          // Result bodies must never land in action previews; output is hashed separately.
          content: "",
        } };
      }
      case "UserPromptSubmit": {
        const prompt = text(record(payload.userPromptSubmit).prompt);
        return {
          workspaceRoot,
          action: { ...base, kind: "prompt", tool: "user_prompt", target: "", content: prompt, userIntent: prompt },
        };
      }
      case "TaskStart": {
        const task = text(record(record(payload.taskStart).taskMetadata).initialTask);
        return {
          workspaceRoot,
          action: { ...base, kind: "prompt", tool: "task_start", target: "", content: task, userIntent: task },
        };
      }
      default:
        return { workspaceRoot, action: null };
    }
  },

  respond(event, decision: Decision | null) {
    if (event === "PostToolUse") return json({ cancel: false });
    if (isAllowed(decision) || decision === null) return json({ cancel: false });
    return json({
      cancel: true,
      errorMessage: denialMessage(decision),
      contextModification: agentGuidance,
    });
  },
};
