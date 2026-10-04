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
- `@cline/sdk` for the optional responder agent

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
```

On systems where PowerShell execution policy does not shadow npm, normal `npm` commands work.

## Optional integrations

- Ollama CLEF/System One
- Cloudflare Workers AI CLEF
- Docker sandbox
- Cline SDK responder
- Anthropic-compatible responder credentials

Every optional integration requires an offline fallback.

## Vault implementation

- `@napi-rs/keyring` 2.1.0 is installed as a runtime dependency.
- Production storage uses synchronous `Entry(service, account)` operations.
- Tests use `MemorySecretStore`; they do not access Windows Credential Manager, macOS Keychain, or Linux credential stores.
- Vault metadata uses shared `vault_entries`/`vault_grants` (migration v2) and `vault_run_tickets` (migration v3).
- Canary helpers (`scanWardenCanaries`, `isCanary`, `isFullyCanaried`) live in `src/vault/canary.ts` (no keyring import) so the engine path stays light.

## Schema migrations

- `src/store/schema.ts` exports `migrations[]`; `migrate(db)` applies `migrations[user_version..]` one by one under `BEGIN IMMEDIATE`.
- Append new migrations; never edit shipped ones. Use `IF NOT EXISTS` / additive changes so concurrent hooks and older DBs are safe.
- `sandbox_runs` (below) should be migration v4.

## Current CLI

```text
npm.cmd run warden -- vault add <NAME>
npm.cmd run warden -- vault seed [.env]
npm.cmd run warden -- vault list
npm.cmd run warden -- run [--only NAME[,NAME...]] -- <command> [args...]
```

- The installed `warden` bin points at `bin/warden.mjs`, which registers `tsx` and loads the TypeScript CLI.
- `vault add` reads the value from hidden TTY input; non-interactive input may be piped over stdin.
- `warden run` requires a live ticket issued by an allowed agent action.

## Sandbox implementation

- No new npm dependency is used; filesystem inspection and Docker invocation use Node's standard library.
- Default cached image name: `node:22-alpine`, overridable with `WARDEN_SANDBOX_IMAGE`.
- Docker readiness and image inspection use an allowlisted client environment.
- Docker execution uses `--pull=never`, `--network none`, dropped capabilities, no-new-privileges, PID/memory/CPU limits, and a 5-second default timeout.
- Docker tests skip when the daemon/image is unavailable; static fallback tests always run.
- Current local state: Docker client is installed, but the Docker Desktop Linux daemon is not running.

### Deferred sandbox persistence

Add a shared `sandbox_runs` table during Engine integration:

```text
id INTEGER PRIMARY KEY
action_id INTEGER NOT NULL REFERENCES actions(id)
backend TEXT NOT NULL
verdict TEXT NOT NULL
reason TEXT NOT NULL
labels_json TEXT NOT NULL
changed_files_json TEXT NOT NULL
secret_files_json TEXT NOT NULL
canaries_json TEXT NOT NULL
network_attempts_json TEXT NOT NULL
control_files_json TEXT NOT NULL
exit_code INTEGER
timed_out INTEGER NOT NULL
duration_ms INTEGER NOT NULL
created_at TEXT NOT NULL
```

Do not store raw command output, copied source text, environment variables, or secret values. Add a prepared `WardenStore.recordSandboxRun(actionId, result, durationMs)` method rather than writing SQL from `src/sandbox/`.

### Deferred Engine API change

The live repository engine should construct dependencies approximately as:

```text
new Engine(store, {
  workspaceRoot,
  vault,
  guardrails,
  sandbox: shadowRun,
})
```

The final shape may stay smaller, but `workspaceRoot` and the sandbox runner must be explicit and injectable.

Status after the Segment 02 merge: `new Engine(store, { workspaceRoot, stages, vault })` exists, with `stages.guardrails` and `stages.canaries`. Add `stages.sandbox` (wrapping `shadowRun`) to the same `EngineStages` interface.
