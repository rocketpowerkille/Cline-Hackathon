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

## Cursor

- Config: `<project>/.cursor/hooks.json` or `~/.cursor/hooks.json`: `{"version":1,"hooks":{"<event>":[{"command":"...","timeout":30,"matcher":"..."}]}}`.
- Common input: `conversation_id, generation_id, model, hook_event_name, cursor_version, workspace_roots[], user_email, transcript_path`. Env: `CURSOR_PROJECT_DIR`.
- `beforeShellExecution{command, cwd, sandbox}` / `beforeMCPExecution{tool_name, tool_input(string), mcp_server_name, url|command}` -> `{permission: allow|deny|ask, user_message, agent_message}`.
- `beforeReadFile{file_path, content, attachments}` -> `{permission: allow|deny, user_message}`.
- `beforeSubmitPrompt{prompt, attachments}` -> `{continue, user_message}`.
- `preToolUse{tool_name, tool_input(object), tool_use_id, cwd}` -> `{permission: allow|deny, user_message, agent_message, updated_input}`; `ask` is not enforced.
- Exit 2 = deny. Invalid JSON from a permission hook BLOCKS. Crash/timeout/other exit codes fail open unless `failClosed: true`.

## Warden mapping rules

- Every non-allow verdict -> Cline `cancel: true`; Cursor `deny` (or `continue: false`).
- Warden failure -> host allow JSON, exit 0, content-free stderr line.
- Unknown/plugin tools -> `mcp` kind so they stay under policy; user-chat tools pass through.
