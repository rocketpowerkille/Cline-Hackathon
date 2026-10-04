# Active Context

## Current focus

Segments 01 (Agent Hooks) and 05 (Secret Vault) are combined and verified on `segment-05-vault`. Segment 02 is next.

## Repository state

- Minimum Node version remains 22.13.
- PowerShell blocks `npm.ps1`; use `npm.cmd`.
- Run `npm ci` on a fresh checkout because `node_modules` is not committed.
- `npm ci` may warn that esbuild's postinstall is not in `allowScripts`; `tsx` still works.

## Recent changes

### Segment 01

- Added the shared `HostAdapter` contract, safe hook input errors, and UTF-8/UTF-16 BOM decoding.
- Added Cline adapters for PreToolUse, UserPromptSubmit, and TaskStart.
- Added Cursor adapters for beforeShellExecution, beforeMCPExecution, beforeReadFile, beforeSubmitPrompt, and preToolUse.
- Added fail-open hook routing and the stdio entry point.
- Enabled SQLite WAL and a busy timeout for concurrent hook processes.
- Recorded verified contracts in `memory-bank/hookContracts.md`.

### Segment 05

- Added native keychain and in-memory secret-store adapters.
- Added `.env` seeding with randomized Warden canaries.
- Added canary scanning, session grant records, and child-process-only secret injection.
- Added repository containment checks for seeded environment files.

## Current decisions

- Event names may come from installer arguments and fall back to the host payload.
- Workspace root comes from payload roots, then `CURSOR_PROJECT_DIR`, then cwd.
- Host adapters convert all non-allow decisions to cancel/deny; approval resolution belongs inside the engine.
- Unknown tools map to `mcp`; pure chat/context tools bypass the engine.
- Hook stderr never prints raw input.
- Vault storage is behind `SecretStore`; production uses the OS keychain and tests use memory.
- Vault tables currently self-initialize for isolation and should move into shared migrations during integration.
- Automated tests never write to the developer's real keychain.

## Next step

Proceed with Segment 02. Vault engine canary enforcement and CLI commands remain integration work.

## Verification

- `npm.cmd test`: 29 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

## Active risks

- Installer must generate Cline PowerShell/Unix wrappers and Cursor configuration in Segment 08.
- Hook startup through `tsx` is roughly 300 ms.
- Cursor `ask` is not reliably enforced; Warden uses deny at the host boundary.
- Ollama System One compatibility remains for Segment 04.
- The real `@napi-rs/keyring` backend is not exercised by automated tests.