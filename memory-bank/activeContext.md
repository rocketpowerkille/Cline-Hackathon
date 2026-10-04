# Active Context

## Current focus

Segment 01 (Agent Hooks) is complete. Next is Segment 02 (Guardrails).

## Repository state

- Node 24.20.0 locally; minimum remains 22.13.
- PowerShell blocks `npm.ps1`; use `npm.cmd`. Run `npm ci` first on a fresh checkout (node_modules is not committed).
- `npm ci` warns that esbuild's postinstall is not in `allowScripts`; tsx still works.

## Recent changes (Segment 01)

- `src/adapters/common.ts`: `HostAdapter` contract, `HookInputError` (content-free messages), JSON/BOM/UTF-16 input decoding.
- `src/adapters/cline.ts`: Cline file-hook adapter (PreToolUse, UserPromptSubmit, TaskStart) and tool->kind mapping.
- `src/adapters/cursor.ts`: Cursor adapter (beforeShellExecution, beforeMCPExecution, beforeReadFile, beforeSubmitPrompt, preToolUse) with per-event response schemas.
- `src/hooks/run.ts`: `runHook()` = parse -> normalize -> `Engine.decide` -> translate; fails open; injectable `EngineFactory`.
- `src/hooks/main.ts`: stdio entry `tsx src/hooks/main.ts <cline|cursor> [event]`.
- Store: `busy_timeout=5000` and WAL for concurrent hook processes.
- Removed a stray patch fragment that had been pasted into `.gitignore`.
- Host contracts recorded in `memory-bank/hookContracts.md`.

## Current decisions

- Event name may be passed by the installer (argv) and falls back to the payload's `hookName`/`hook_event_name`.
- Workspace root comes from the payload's workspace roots, then `CURSOR_PROJECT_DIR`, then cwd; the ledger is `<root>/.warden/warden.db`.
- All non-allow verdicts become Cline `cancel` / Cursor `deny`; `ask` is resolved inside the engine (Segment 08 approvals), never delegated to hosts.
- Unknown tools map to `mcp` so they remain under policy; pure chat/context tools bypass the engine.
- Adapters always set `untrustedInput: false` and empty intent for tool calls; trust tracking (Segment 03) derives taint from the ledger.
- Hook stderr only prints `HookInputError` messages or error class names, never raw input.

## Next step

Segment 02: guardrails module returning small results/labels; engine composes them (block/ask/sandbox verdicts for control-file writes, secret paths, exfil-shaped exec/net).

## Active risks

- Installer (Segment 08) must write `.clinerules/hooks/PreToolUse.ps1` on Windows and extensionless scripts elsewhere, and `.cursor/hooks.json`; wrappers must always emit JSON.
- Hook process startup via tsx is ~300 ms; acceptable for MVP, may need a compiled build later.
- Cursor `ask` is not enforced for `preToolUse`; Warden already uses `deny`.
- Ollama System One compatibility is still to be tested in Segment 04.
