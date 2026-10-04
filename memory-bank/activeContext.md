# Active Context

## Current focus

Segments 00, 01, 02, 05, and the standalone 06 sandbox are merged on `main`. Next: connect guardrail `sandbox` verdicts to `shadowRun()` (wiring list below), then Segment 03 (Trust Tracking). Wait for the user's go-ahead.

### Segment 02

- `Engine.decide()` is async; `OpenEngine.decide` and `runHook` return Promises.
- `Engine(store, {workspaceRoot, stages, vault})`: stages are injectable (`EngineStages.guardrails`, `EngineStages.canaries`). `combine()` picks block > ask > sandbox > allow and unions labels.
- Schema uses ordered `migrations[]` + `PRAGMA user_version` (`migrate()` in `schema.ts`, `BEGIN IMMEDIATE`, idempotent). v2 = vault tables. `SecretVault` calls `migrate()` instead of self-creating tables. Old v1 DBs upgrade with data intact.
- `src/vault/canary.ts` holds `CANARY_PREFIX`, `isCanary`, and `isFullyCanaried`; it is keychain-free so hooks don't load the native keyring.
- Guardrail details live in `memory-bank/guardrails.md`. `untrustedInput` stands in for trust until Segment 03.
- Cline `cancel:true` on PreToolUse aborts the **whole task run**. This is recorded in `hookContracts.md` and drives how "ask" is resolved later.
- Merge: vault canary blocking is now the engine `canaries` stage; `vault_run_tickets` is migration 3; `Engine(store, {workspaceRoot, stages, vault})`; tickets are issued only on a final allow.

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
- Added shared vault schema tables and single-use run tickets.
- Added engine-level canary blocking for outbound exec, net, write, and MCP actions.
- Added command-bound session attribution for `warden run`, including `--only` selection.
- Added the initial dependency-free CLI and a JavaScript launcher that registers `tsx`.

### Segment 06

- Added synchronous `shadowRun()` so the sandbox can fit the existing hook path.
- Added an offline static analyzer that catches the demo `.env` + base64 + curl attack without Docker.
- Added bounded recursive inspection of workspace-local shell, PowerShell, JavaScript, Python, batch, and command scripts.
- Added optional Docker shadow execution using an already-cached image, a throwaway copy, no network, no host application environment, and resource/time limits.
- Added fake curl/wget wrappers, file manifests, canary scans, control-file change detection, and timeout cleanup.
- Added broader secret exclusion/redaction before the shadow copy is mounted.

## Current decisions

- Event names may come from installer arguments and fall back to the host payload.
- Workspace root comes from payload roots, then `CURSOR_PROJECT_DIR`, then cwd.
- Host adapters convert all non-allow decisions to cancel/deny; approval resolution belongs inside the engine.
- Unknown tools map to `mcp`; pure chat/context tools bypass the engine.
- Hook stderr never prints raw input.
- Vault storage is behind `SecretStore`; production uses the OS keychain and tests use memory.
- Vault tables are in shared migrations (v2 entries/grants, v3 run tickets).
- Automated tests never write to the developer's real keychain.
- New schema changes = append to `migrations[]`; never edit a shipped entry.
- Guardrails return findings only; only `Engine.combine` sets verdict precedence.
- "ask" currently surfaces as cancel/deny. In Cline that aborts the task, so Segment 08 approvals should resolve inside `decide()` before replying.
- Run tickets expire after 30 seconds, are exact-command and exact-selection bound, and are consumed once.
- Matching multiple live tickets is ambiguous and fails closed rather than guessing a session.
- Grants are recorded only after the child emits its successful `spawn` event.
- Vault `add` prompts through hidden TTY input; the value is never accepted as a command argument.
- The sandbox always runs static inspection first and combines that evidence with Docker observations.
- Docker is optional and never pulls images on the hook path.
- Windows-native commands use static fallback instead of being sent to a Linux container.
- Missing Docker, daemon failure, missing image, or unsafe image environment selects static fallback.
- Sandbox timeouts, execution errors, and outside-workspace script references fail closed.
- `shadowRun` exposes a result callback for future ledger integration without coupling to the store.

## Next step

Connect guardrail `sandbox` findings to `shadowRun()` via a new `sandbox` engine stage, then start Segment 03 (Trust Tracking).

## Remaining Segment 06 wiring

Segment 02 is now available; remaining steps:

1. Give `Engine` the protected repository root or an injected sandbox runner; do not infer the root from an action target.
2. Run `shadowRun({ workspaceRoot, action })` only when Guardrails returns `sandbox`.
3. Convert sandbox `block` into the final engine block reason and merge all sandbox labels into the decision.
4. Convert sandbox `allow` back to the normal engine pipeline; continue with vault canary scan, risk scoring, provenance, and approval rather than treating it as an unconditional final allow.
5. Add `sandbox_runs` to the shared schema and persist summaries only: backend, verdict, reason, labels, changed/control/secret files, canaries, network attempts, exit code, timeout, and duration. Never persist stdout, stderr, host environment, or secret values.
6. Add engine tests proving the sandbox is not called for `allow`, `ask`, or `block` guardrail results, and is called exactly once for `sandbox`.
7. Add hook-level tests proving a poisoned setup script is denied while a harmless shadow result proceeds.
8. Add the demo trace after Guardrails and trust tracking can create the intended untrusted-session path.

## Verification

- `npm.cmd test`: 74 passed, 0 failed, 3 Docker-only tests skipped (after the Segment 02 merge).
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.
- Real CLI launcher smoke test passed.

## Active risks

- Installer must generate Cline PowerShell/Unix wrappers and Cursor configuration in Segment 08.
- Hook startup through `tsx` is roughly 300 ms.
- Cursor `ask` is not reliably enforced; Warden uses deny at the host boundary.
- Cline `cancel` aborts the whole task; per-call `skip` needs an SDK plugin adapter.
- Guardrail shell matching is lexical; variables, encoded commands, and scripts are not followed.
- Ollama System One compatibility remains for Segment 04.
- The real `@napi-rs/keyring` backend is not exercised by automated tests.
- Docker runtime behavior remains conditionally tested because the local daemon is unavailable; static fallback is fully exercised.
- Until the wiring above lands, `shadowRun()` is not called by `Engine.decide()` and cannot affect live hook verdicts.
