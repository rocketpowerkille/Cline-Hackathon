import type { ActionKind, AgentAction, Decision } from "../core/types.js";
import {
  agentGuidance,
  denialMessage,
  firstRoot,
  firstText,
  HookInputError,
  isAllowed,
  isRecord,
  json,
  text,
  type HookOutput,
  type HostAdapter,
  type JsonRecord,
  type NormalizedHook,
} from "./common.js";

interface ToolMapping {
  kind: ActionKind;
  target: string;
  content: string;
}

const execTools = new Set(["shell", "terminal", "run_terminal_cmd"]);
const readTools = new Set(["read", "read_file", "grep", "glob", "ls", "list_dir", "codebase_search", "search"]);
const writeTools = new Set([
  "write",
  "edit",
  "edit_file",
  "strreplace",
  "str_replace",
  "search_replace",
  "multiedit",
  "delete",
  "delete_file",
  "apply_patch",
]);
const netTools = new Set(["webfetch", "web_fetch", "websearch", "web_search", "fetch"]);
const promptTools = new Set(["task"]);

const targetKeys = ["file_path", "path", "target_file", "command", "url", "query"] as const;
const contentKeys = ["command", "contents", "content", "new_string", "code_edit", "prompt", "pattern"] as const;

/** Maps Cursor's generic preToolUse payload. Unknown tools stay under policy as external capabilities. */
export function mapCursorTool(tool: string, input: unknown): ToolMapping {
  const fields: JsonRecord = isRecord(input) ? input : {};
  const target = firstText(fields, targetKeys);
  const content = firstText(fields, contentKeys) || (isRecord(input) ? JSON.stringify(input) : text(input));
  const name = tool.toLowerCase();

  if (execTools.has(name)) return { kind: "exec", target, content };
  if (readTools.has(name)) return { kind: "read", target, content: "" };
  if (writeTools.has(name)) return { kind: "write", target, content };
  if (netTools.has(name)) return { kind: "net", target, content };
  if (promptTools.has(name)) return { kind: "prompt", target: tool, content };
  return { kind: "mcp", target: target || tool, content };
}

export const cursorAdapter: HostAdapter = {
  eventName(payload) {
    return text(payload.hook_event_name);
  },

  normalize(event, payload, environment): NormalizedHook {
    const workspaceRoot = firstRoot(payload.workspace_roots) ?? environment.env.CURSOR_PROJECT_DIR ?? environment.cwd;
    const base = {
      source: "cursor",
      sessionId: text(payload.conversation_id) || text(payload.session_id) || "unknown",
      agent: "cursor",
      untrustedInput: false,
      userIntent: "",
    } as const;
    const action = (fields: Pick<AgentAction, "kind" | "tool" | "target" | "content">, userIntent = ""): NormalizedHook => ({
      workspaceRoot,
      action: { ...base, ...fields, userIntent },
    });

    switch (event) {
      case "beforeShellExecution": {
        const command = text(payload.command);
        return action({ kind: "exec", tool: "Shell", target: command, content: command });
      }
      case "beforeMCPExecution": {
        const tool = text(payload.tool_name);
        const server = text(payload.mcp_server_name) || text(payload.mcp_server_url) || "unknown";
        return action({ kind: "mcp", tool, target: `${server}/${tool}`, content: text(payload.tool_input) });
      }
      case "beforeReadFile":
        return action({ kind: "read", tool: "Read", target: text(payload.file_path), content: text(payload.content) });
      case "beforeSubmitPrompt": {
        const prompt = text(payload.prompt);
        return action({ kind: "prompt", tool: "user_prompt", target: "", content: prompt }, prompt);
      }
      case "preToolUse": {
        const tool = text(payload.tool_name);
        if (!tool) throw new HookInputError("Cursor preToolUse input is missing tool_name.");
        return action({ tool, ...mapCursorTool(tool, payload.tool_input) });
      }
      default:
        return { workspaceRoot, action: null };
    }
  },

  respond(event, decision: Decision | null): HookOutput {
    const allowed = isAllowed(decision) || decision === null;
    const message = allowed || decision === null ? "" : denialMessage(decision);

    switch (event) {
      case "beforeSubmitPrompt":
        return json(allowed ? { continue: true } : { continue: false, user_message: message });
      case "beforeReadFile":
        return json(allowed ? { permission: "allow" } : { permission: "deny", user_message: message });
      case "beforeShellExecution":
      case "beforeMCPExecution":
      case "preToolUse":
        // Cursor does not reliably enforce "ask", so every non-allow verdict is a deny.
        return json(
          allowed
            ? { permission: "allow" }
            : { permission: "deny", user_message: message, agent_message: `${message}\n${agentGuidance}` },
        );
      default:
        return json({});
    }
  },
};
