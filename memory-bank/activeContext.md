# Active Context

## Current focus

Segment 02 (Guardrails) is complete on `main` (uncommitted). Segment 03 (Trust Tracking) is next and waits for the user's go-ahead.

### Segment 02

- `Engine.decide()` is async; `OpenEngine.decide` and `runHook` return Promises.
- `Engine(store, {workspaceRoot, stages})`: stages are injectable (`EngineStages.guardrails` for now). `combine()` picks block > ask > sandbox > allow and unions labels.
- Schema uses ordered `migrations[]` + `PRAGMA user_version` (`migrate()` in `schema.ts`, `BEGIN IMMEDIATE`, idempotent). v2 = vault tables. `SecretVault` calls `migrate()` instead of self-creating tables. Old v1 DBs upgrade with data intact.
- `src/vault/canary.ts` holds `CANARY_PREFIX`, `isCanary`, and `isFullyCanaried`; it is keychain-free so hooks don't load the native keyring.
- Guardrail details live in `memory-bank/guardrails.md`. `untrustedInput` stands in for trust until Segment 03.
- Cline `cancel:true` on PreToolUse aborts the **whole task run**. This is recorded in `hookContracts.md` and drives how "ask" is resolved later.

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
- Vault tables are in shared migrations (v2).
- Automated tests never write to the developer's real keychain.
- New schema changes = append to `migrations[]`; never edit a shipped entry.
- Guardrails return findings only; only `Engine.combine` sets verdict precedence.
- "ask" currently surfaces as cancel/deny. In Cline that aborts the task, so Segment 08 approvals should resolve inside `decide()` before replying.

## Next step

Segment 03 (Trust Tracking): replace `action.untrustedInput` with session/file taint as a new engine stage before guardrails. Vault canary scanning in the engine (stage 4) and the CLI remain integration work.

## Verification

- `npm.cmd test`: 52 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

## Active risks

- Installer must generate Cline PowerShell/Unix wrappers and Cursor configuration in Segment 08.
- Hook startup through `tsx` is roughly 300 ms.
- Cursor `ask` is not reliably enforced; Warden uses deny at the host boundary.
- Cline `cancel` aborts the whole task; per-call `skip` needs an SDK plugin adapter.
- Guardrail shell matching is lexical; variables, encoded commands, and scripts are not followed.
- Ollama System One compatibility remains for Segment 04.
- The real `@napi-rs/keyring` backend is not exercised by automated tests.