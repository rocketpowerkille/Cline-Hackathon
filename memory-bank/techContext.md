# Technical Context

## Stack

- TypeScript with strict checking
- Node.js 22.13 or newer
- ECMAScript modules
- `tsx` for execution and tests
- Built-in `node:sqlite` with `DatabaseSync`
- Built-in `node:test`

## Dependency policy

Approved runtime dependencies, added only when needed:

- `@napi-rs/keyring` for the OS keychain
- `@cline/sdk` is **not** installed by default; optional SDK mode requires separate installation and audit.

Approved development dependencies:

- `tsx`
- `typescript`
- `@types/node`

Ask before adding anything else.

## Platform requirements

- Primary environment: Windows 11 and PowerShell.
- Use `.ps1` wrappers where supported on Windows.
- Keep path matching portable across backslashes, forward slashes, and Windows case folding.
- Do not require Docker; it is an optional sandbox backend.

## State

All protected-repository state lives under `.warden/`:

```text
.warden/warden.db
.warden/incidents/
.warden/quarantine/
```

## Commands

```text
npm.cmd test
npm.cmd run typecheck
npm.cmd run warden -- init [--seed-env]
npm.cmd run warden -- doctor
npm.cmd run warden -- uninstall
```

On systems where PowerShell execution policy does not shadow npm, normal `npm` commands work.

## Optional integrations

- Ollama CLEF/System One
- Cloudflare Workers AI CLEF
- Docker sandbox
- Cline SDK responder
- Anthropic-compatible responder credentials

Every optional integration requires an offline fallback.

Cloudflare configuration uses `CLOUDFLARE_ACCOUNT_ID` plus a scoped bearer `CLOUDFLARE_API_TOKEN`. The Warden package-root `.env` is parsed through an allowlist; explicit process values take precedence. `CLOUDFLARE_API_KEY` is supported only as a bearer-token alias, not as the legacy Global API Key.

## Vault implementation

- `@napi-rs/keyring` 2.1.0 is installed as a runtime dependency.
- Production storage uses synchronous `Entry(service, account)` operations.
- Tests use `MemorySecretStore`; they do not access Windows Credential Manager, macOS Keychain, or Linux credential stores.
- Vault metadata uses shared `vault_entries`/`vault_grants` (migration v2) and `vault_run_tickets` (migration v3).
- Canary helpers (`scanWardenCanaries`, `isCanary`, `isFullyCanaried`) live in `src/vault/canary.ts` (no keyring import) so the engine path stays light.

## Schema migrations

- `src/store/schema.ts` exports `migrations[]`; `migrate(db)` applies `migrations[user_version..]` one by one under `BEGIN IMMEDIATE`.
- Append new migrations; never edit shipped ones. Use `IF NOT EXISTS` / additive changes so concurrent hooks and older DBs are safe.
- Trust tables are migration v4; redacted `sandbox_runs` and `decisions.risk_latency_ms` are migration v5.

## Current CLI

```text
npm.cmd run warden -- vault add <NAME>
npm.cmd run warden -- vault seed [.env]
npm.cmd run warden -- vault list
npm.cmd run warden -- status
npm.cmd run warden -- score [SESSION_ID]
npm.cmd run warden -- dashboard
npm.cmd run warden -- respond --session <ID> [--deterministic]
npm.cmd run warden -- trust review-file <PATH> # interactive local terminal only
npm.cmd run build # dist/ runtime without tsx
npm.cmd run warden -- run [--only NAME[,NAME...]] -- <command> [args...]
```

- The installed `warden` bin points at `bin/warden.mjs`, which registers `tsx` and loads the TypeScript CLI.
- `vault add` reads the value from hidden TTY input; non-interactive input may be piped over stdin.
- `warden run` requires a live ticket issued by an allowed agent action.
- Dashboard binds to `127.0.0.1:8765`; manual approvals are resolved within 20 seconds before Cline's 30-second hook deadline. `warden respond --deterministic` needs no SDK credentials.
- `npm.cmd audit --omit=dev` reports **0** with the default installation. The previously bundled optional SDK introduced 32 transitive findings and must be audited separately before use. Default response leaves real keys OPEN until a verified rotation provider exists.

## Sandbox implementation

- No new npm dependency is used; filesystem inspection and Docker invocation use Node's standard library.
- Default cached image name: `node:22-alpine`, overridable with `WARDEN_SANDBOX_IMAGE`.
- Docker readiness and image inspection use an allowlisted client environment.
- Docker execution uses `--pull=never`, `--network none`, dropped capabilities, no-new-privileges, PID/memory/CPU limits, and a 5-second default timeout.
- Docker tests skip when the daemon/image is unavailable; static fallback tests always run. Static-only untrusted executable code is **blocked** even when no lexical risk was found.
- Current local state: Docker client is installed, but the Docker Desktop Linux daemon is not running.

### Implemented sandbox persistence (schema v5)

The shared `sandbox_runs` table links to action_id and decision_id and records:

```text
id INTEGER PRIMARY KEY
action_id INTEGER NOT NULL REFERENCES actions(id)
decision_id INTEGER NOT NULL REFERENCES decisions(id)
backend TEXT NOT NULL
verdict TEXT NOT NULL
reason TEXT NOT NULL
labels_json TEXT NOT NULL
inspected_files_json TEXT NOT NULL
changed_files_json TEXT NOT NULL
secret_files_json TEXT NOT NULL
canaries_count INTEGER NOT NULL
network_attempts_json TEXT NOT NULL
control_files_json TEXT NOT NULL
exit_code INTEGER
timed_out INTEGER NOT NULL
duration_ms INTEGER NOT NULL
created_at TEXT NOT NULL
```

Do not store raw command output, copied source text, environment variables, or secret values. `WardenStore.recordSandboxRun(ids, result, durationMs)` owns the prepared SQL and redaction.

### Engine integration

`new Engine(store, { workspaceRoot, stages, vault })` has injectable `stages.guardrails`, `stages.canaries`, `stages.sandbox`, and `stages.risk`. The store writes redacted sandbox summaries after the action/decision row exists. `WARDEN_RISK_OFFLINE=1` forces the risk heuristic; tests preload this before any spawned hooks.

## Install implementation (Segment 08B)

- Cline Windows files: `.clinerules/hooks/{PreToolUse,PostToolUse,TaskStart,UserPromptSubmit}.ps1`.
- Cline Unix files: the same event names without extensions and with executable mode.
- Cursor config: `.cursor/hooks.json` version 1 with Warden entries in `preToolUse`, `postToolUse`, `afterShellExecution`, `afterMCPExecution`, and `beforeSubmitPrompt` arrays. Specialized before-hooks are deliberately excluded to avoid duplicate risk-budget scoring.
- Cursor wrappers: `.warden/hooks/cursor-<event>.ps1` on Windows and extensionless executable files on Unix.
- Ownership manifest: `.warden/install.json`; it contains paths/hashes and no secret values.
- Faster hook entry: `bin/hook.mjs` registers `tsx/esm/api` in-process. Local benchmark: about 175 ms versus about 206 ms for the previous path.
- Doctor checks Node 22.13+, the launcher, `tsx`, Git ignore state, exact Cline wrappers, exact Cursor wrappers, and merged Cursor entries.
- `npm run build` emits `dist/`; both launchers use compiled code in production-only installs without `tsx`. A temporary `npm ci --omit=dev` install verified the compiled CLI and hook. `npm pack --dry-run --json` lists only the allowlisted `bin/`, `dist/`, README, and package metadata; `prepack` rebuilds before packaging. The package remains private for now.
