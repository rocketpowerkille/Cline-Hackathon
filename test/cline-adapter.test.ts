import assert from "node:assert/strict";
import test from "node:test";
import { clineAdapter, mapClineTool } from "../src/adapters/cline.js";
import { decodeHookInput, HookInputError, parseJsonObject } from "../src/adapters/common.js";
import { decision, fixture } from "./helpers.js";

const environment = { cwd: "fallback-root", env: {} };

test("cline PreToolUse normalizes to an exec AgentAction", () => {
  const payload = fixture("cline-pre-tool-use.json", "repo-root");
  const result = clineAdapter.normalize("PreToolUse", payload, environment);

  assert.equal(result.workspaceRoot, "repo-root");
  assert.deepEqual(result.action, {
    source: "cline",
    sessionId: "task-poisoned-issue",
    agent: "cline",
    kind: "exec",
    tool: "execute_command",
    target: "powershell -File scripts/setup.ps1",
    content: "powershell -File scripts/setup.ps1",
    untrustedInput: false,
    userIntent: "",
  });
});

test("cline tools map to action kinds", () => {
  assert.deepEqual(mapClineTool("write_to_file", { path: ".clinerules/setup.md", content: "run it" }), {
    kind: "write",
    target: ".clinerules/setup.md",
    content: "run it",
  });
  assert.equal(mapClineTool("read_file", { path: "README.md" })?.kind, "read");
  assert.equal(mapClineTool("replace_in_file", { path: "a.ts", diff: "x" })?.kind, "write");
  assert.equal(mapClineTool("web_fetch", { url: "https://example.test" })?.target, "https://example.test");
  assert.equal(mapClineTool("use_mcp_tool", { server_name: "gh", tool_name: "issue" })?.target, "gh/issue");
  assert.equal(mapClineTool("apply_patch", { input: "*** Update File: src/a.ts\n+x" })?.target, "src/a.ts");
  assert.equal(mapClineTool("attempt_completion", { result: "done", command: "npm start" })?.kind, "exec");
  assert.equal(mapClineTool("attempt_completion", { result: "done" }), null);
  assert.equal(mapClineTool("ask_followup_question", { question: "?" }), null);
  assert.equal(mapClineTool("some_plugin_tool", { a: 1 })?.kind, "mcp");
});

test("cline prompt and task-start events carry user intent", () => {
  const prompt = clineAdapter.normalize(
    "UserPromptSubmit",
    { taskId: "t", userPromptSubmit: { prompt: "Fix issue 7" } },
    environment,
  );
  assert.equal(prompt.action?.kind, "prompt");
  assert.equal(prompt.action?.userIntent, "Fix issue 7");
  assert.equal(prompt.workspaceRoot, "fallback-root");

  const start = clineAdapter.normalize(
    "TaskStart",
    { taskId: "t", taskStart: { taskMetadata: { initialTask: "Triage" } } },
    environment,
  );
  assert.equal(start.action?.userIntent, "Triage");
  assert.equal(clineAdapter.normalize("TaskComplete", { taskId: "t" }, environment).action, null);
});

test("cline PreToolUse without a tool name is rejected", () => {
  assert.throws(
    () => clineAdapter.normalize("PreToolUse", { taskId: "t", preToolUse: {} }, environment),
    HookInputError,
  );
});

test("cline responses cancel every non-allow verdict", () => {
  assert.deepEqual(JSON.parse(clineAdapter.respond("PreToolUse", null).stdout), { cancel: false });
  assert.deepEqual(JSON.parse(clineAdapter.respond("PreToolUse", decision("allow")).stdout), { cancel: false });
  for (const verdict of ["ask", "sandbox", "block"] as const) {
    const output = JSON.parse(clineAdapter.respond("PreToolUse", decision(verdict, "Exfiltration.")).stdout);
    assert.equal(output.cancel, true);
    assert.match(output.errorMessage, /Exfiltration\./);
    assert.match(output.contextModification, /Do not retry/);
  }
});

test("hook input decoding handles UTF-8 and UTF-16 byte order marks", () => {
  const body = '{"prompt":"café"}';
  const utf8 = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(body, "utf8")]);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, "utf16le")]);

  assert.deepEqual(parseJsonObject(decodeHookInput(utf8)), { prompt: "café" });
  assert.deepEqual(parseJsonObject(decodeHookInput(utf16)), { prompt: "café" });
  assert.deepEqual(parseJsonObject(decodeHookInput(Buffer.from(body))), { prompt: "café" });
});

test("hook input parsing accepts a BOM and rejects non-objects", () => {
  assert.deepEqual(parseJsonObject('\uFEFF{"a":1}'), { a: 1 });
  assert.throws(() => parseJsonObject("[]"), HookInputError);
  assert.throws(() => parseJsonObject("not json"), HookInputError);
});
