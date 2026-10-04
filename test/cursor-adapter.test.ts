import assert from "node:assert/strict";
import test from "node:test";
import { cursorAdapter, mapCursorTool } from "../src/adapters/cursor.js";
import { decision, fixture } from "./helpers.js";

const environment = { cwd: "fallback-root", env: {} };

test("cursor beforeShellExecution normalizes to an exec AgentAction", () => {
  const payload = fixture("cursor-before-shell.json", "repo-root");
  const result = cursorAdapter.normalize("beforeShellExecution", payload, environment);

  assert.equal(result.workspaceRoot, "repo-root");
  assert.deepEqual(result.action, {
    source: "cursor",
    sessionId: "conv-second-session",
    agent: "cursor",
    kind: "exec",
    tool: "Shell",
    target: "npm run setup",
    content: "npm run setup",
    untrustedInput: false,
    userIntent: "",
  });
});

test("cursor events normalize MCP, reads, prompts, and generic tools", () => {
  const base = { conversation_id: "c1" };
  const mcp = cursorAdapter.normalize(
    "beforeMCPExecution",
    { ...base, tool_name: "create_issue", tool_input: "{}", mcp_server_name: "github" },
    environment,
  );
  assert.equal(mcp.action?.target, "github/create_issue");

  const read = cursorAdapter.normalize("beforeReadFile", { ...base, file_path: "C:\\repo\\.env", content: "A=1" }, environment);
  assert.equal(read.action?.kind, "read");

  const prompt = cursorAdapter.normalize("beforeSubmitPrompt", { ...base, prompt: "Fix the bug" }, environment);
  assert.equal(prompt.action?.userIntent, "Fix the bug");

  const tool = cursorAdapter.normalize(
    "preToolUse",
    { ...base, tool_name: "Write", tool_input: { file_path: "a.ts", contents: "x" } },
    environment,
  );
  assert.deepEqual([tool.action?.kind, tool.action?.target, tool.action?.content], ["write", "a.ts", "x"]);

  assert.equal(cursorAdapter.normalize("afterFileEdit", base, environment).action, null);
  const projectEnv = { cwd: "x", env: { CURSOR_PROJECT_DIR: "project" } };
  assert.equal(cursorAdapter.normalize("stop", base, projectEnv).workspaceRoot, "project");
});

test("cursor generic tools map to action kinds", () => {
  assert.equal(mapCursorTool("Shell", { command: "ls" }).kind, "exec");
  assert.equal(mapCursorTool("Read", { file_path: "a" }).kind, "read");
  assert.equal(mapCursorTool("StrReplace", { path: "a", new_string: "b" }).content, "b");
  assert.equal(mapCursorTool("WebFetch", { url: "https://x.test" }).kind, "net");
  assert.equal(mapCursorTool("Task", { prompt: "go" }).kind, "prompt");
  assert.equal(mapCursorTool("mystery", { a: 1 }).kind, "mcp");
});

test("cursor responses use each event's schema and deny every non-allow verdict", () => {
  const out = (event: string, verdict?: "allow" | "ask" | "block") =>
    JSON.parse(cursorAdapter.respond(event, verdict ? decision(verdict, "Exfiltration.") : null).stdout);

  assert.deepEqual(out("beforeShellExecution"), { permission: "allow" });
  assert.deepEqual(out("preToolUse", "allow"), { permission: "allow" });

  const denied = out("beforeShellExecution", "ask");
  assert.equal(denied.permission, "deny");
  assert.match(denied.user_message, /approval: Exfiltration\./);
  assert.match(denied.agent_message, /Do not retry/);

  assert.deepEqual(out("beforeReadFile", "block"), { permission: "deny", user_message: "Warden block: Exfiltration." });
  assert.deepEqual(out("beforeSubmitPrompt", "block"), { continue: false, user_message: "Warden block: Exfiltration." });
  assert.deepEqual(out("beforeSubmitPrompt"), { continue: true });
  assert.deepEqual(out("afterFileEdit", "block"), {});
});
