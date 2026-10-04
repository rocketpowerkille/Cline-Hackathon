# Host Hook Contracts (verified 2026-10-04)

Sources: `cline/cline` main (`apps/vscode/proto/cline/hooks.proto`, `apps/vscode/src/core/hooks/utils.ts`, `hook-factory.ts`, `HookProcess.ts`, `.clinerules/hooks/README.md`) and https://cursor.com/docs/agent/hooks.

## Cline (file hooks)

- Location: `<workspace>/.clinerules/hooks/<HookName>` and global `~/Documents/Cline/Hooks/`.
- Windows: only `<HookName>.ps1` is discovered, run as `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File <script>` with cwd = workspace root. Unix: extensionless executable.
- Hooks: TaskStart, TaskResume, TaskCancel, TaskComplete, PreToolUse, PostToolUse, UserPromptSubmit, Notification, PreCompact.
- Input (camelCase JSON on stdin): `clineVersion, hookName, timestamp, taskId, workspaceRoots[], userId, model`, plus one of `preToolUse{toolName, parameters}`, `postToolUse{..., result, success, executionTimeMs}`, `userPromptSubmit{prompt, attachments}`, `taskStart{taskMetadata{taskId, ulid, initialTask}}`.
- Output: `{cancel: boolean, contextModification?: string, errorMessage?: string}`.
- Valid JSON is honored regardless of exit code. Exit 0 without JSON = allow. Non-zero without JSON = hook error. Warden must always print JSON.
- Timeout: 30 s in VS Code; 120 s in CLI/SDK. Multiple hooks run concurrently; any `cancel: true` blocks.
- Tool names: `read_file, write_to_file, replace_in_file, apply_patch, execute_command, search_files, list_files, list_code_definition_names, browser_action, use_mcp_tool, access_mcp_resource, load_mcp_documentation, web_fetch, web_search, new_task, use_subagents, use_skill, new_rule, attempt_completion, ask_followup_question, plan_mode_respond, act_mode_respond, focus_chain, condense, summarize_task, report_bug`.
- Newer Cline docs route "Hooks" to SDK plugins (`AgentPlugin.hooks.beforeTool`, policy `failureMode`). File hooks remain supported in the VS Code extension; a plugin adapter can be added later.

### What `cancel: true` on PreToolUse does (verified 2026-10-04, cline/cline main)

**It stops the whole task run, not just that tool call.**

- VS Code now runs on the SDK runtime. `apps/vscode/src/sdk/hooks-adapter.ts` `beforeTool` -> `mapStopOrContextResult` -> `mapStopControl` turns `cancel: true` into `{stop: true, reason}`.
- `sdk/packages/agents/src/agent-runtime.ts` `prepareToolExecution` calls `applyStopControl(result)`, which throws `ControlledStopError`; the run ends with status `aborted`.
- The CLI/SDK file-hook path (`sdk/packages/core/src/hooks/hook-file-hooks.ts` `beforeToolResultFromControl`) maps `cancel` to `stop` the same way.
- Reason shown = `errorMessage`, falling back to `contextModification`. On cancel, `contextModification` is **not** injected into the conversation, so Warden's "do not retry" guidance only matters if the run continues.
- The runtime *does* support per-tool denial: a `beforeTool` result of `{skip: true, reason}` skips only that call and returns `reason` to the model as an error tool result. File hooks cannot produce `skip`; only an SDK `AgentPlugin` `beforeTool` hook can.
- `review: boolean` is parsed and merged from hook output, but `beforeToolResultFromControl` does not use it. Unverified elsewhere; don't depend on it.

**Consequences for "ask":**
- A Cline file hook that answers `ask` with cancel aborts the user's task. That is acceptable for `block`, but heavy for `ask`.
- Plan: resolve `ask` *inside* `Engine.decide` (wait for dashboard approval within the 30 s VS Code hook timeout) and only cancel on deny or timeout; or add a Cline SDK plugin adapter that returns `skip` for per-call denial.
- `sandbox` should never reach the host as a cancel once Segment 06 runs commands in the shadow workspace.

## Cursor

- Config: `<project>/.cursor/hooks.json` or `~/.cursor/hooks.json`: `{"version":1,"hooks":{"<event>":[{"command":"...","timeout":30,"matcher":"..."}]}}`.
- Common input: `conversation_id, generation_id, model, hook_event_name, cursor_version, workspace_roots[], user_email, transcript_path`. Env: `CURSOR_PROJECT_DIR`.
- `beforeShellExecution{command, cwd, sandbox}` / `beforeMCPExecution{tool_name, tool_input(string), mcp_server_name, url|command}` -> `{permission: allow|deny|ask, user_message, agent_message}`.
- `beforeReadFile{file_path, content, attachments}` -> `{permission: allow|deny, user_message}`.
- `beforeSubmitPrompt{prompt, attachments}` -> `{continue, user_message}`.
- `preToolUse{tool_name, tool_input(object), tool_use_id, cwd}` -> `{permission: allow|deny, user_message, agent_message, updated_input}`; `ask` is not enforced.
- Exit 2 = deny. Invalid JSON from a permission hook BLOCKS. Crash/timeout/other exit codes fail open unless `failClosed: true`.
- Observational `postToolUse` provides `tool_name`, `tool_input`, and JSON-stringified `tool_output`; specialized `afterShellExecution` and `afterMCPExecution` provide shell `output` and MCP `result_json` respectively. Warden responds with `{}` and never blocks on these events. `afterFileEdit` exists but is not wired yet.

## Segment 03 observations

- Cline `PostToolUse` uses `postToolUse{toolName,parameters,result,success}` and always responds `{cancel:false}`. Output is hashed, not saved verbatim.
- Cursor observation hooks are available; installation of hook wrappers/configuration still belongs to Segment 08.

## Warden mapping rules

- Every non-allow verdict -> Cline `cancel: true` (aborts the task run; see above); Cursor `deny` (or `continue: false`).
- Warden failure -> host allow JSON, exit 0, content-free stderr line.
- Unknown/plugin tools -> `mcp` kind so they stay under policy; user-chat tools pass through.
