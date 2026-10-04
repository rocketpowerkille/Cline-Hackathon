# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Complete | 74 passed + 3 Docker skips after merge, typecheck, hook e2e |
| 03 Trust Tracking | Implemented; shell visibility limits documented | Cross-agent/day chain, snapshot, post-hook and sandbox tests |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Complete | 42 tests passed; strict typecheck passed |
| 06 Sandbox | Complete; engine wiring pending | 51 tests passed; 3 Docker tests skipped |
| 07 Cline Responder | Not started | — |
| 08 Dashboard + Install | Not started | — |

## Current scope

Segments 00, 01, 02, 05, and the standalone Segment 06 sandbox were merged on `main`. Segment 03 now records sticky session/file provenance; the engine calls the sandbox for guardrail sandbox requests and continues evaluation on allow. Sandbox evidence persistence is still pending.

## Deliberate shortcuts

- Hook adapters still supply `untrustedInput: false`; the engine enriches this from shared ledger provenance. Generic shell output taints conservatively when observed.
- Guardrail `sandbox` verdicts invoke `shadowRun()`; `ask` still reaches hosts as deny (approvals arrive in 08).
- Hook wrapper scripts and installer arrive in Segment 08.

## Segment 01 result

- Added Cline and Cursor adapters for the required hook events.
- Added `runHook` and the stdio entry `src/hooks/main.ts <cline|cursor> [event]`, failing open with valid host JSON.
- Enabled SQLite WAL and busy timeout for concurrent hook processes.
- Added host-payload fixtures plus adapter, routing, fail-open, shared-ledger, and spawned-process tests.

## Segment 05 result

- Added `@napi-rs/keyring` for native OS credential storage.
- Added `.env` seeding that moves real values to secret storage and leaves randomized canaries.
- Added known and copied-canary scanning.
- Added session grant tracking without storing real values in SQLite.
- Added child-process-only environment injection for future `warden run` wiring.
- Added an in-memory secret store so tests remain offline and never touch the real keychain.
- Added unconditional engine blocking when a Warden canary appears in outbound exec, net, write, or MCP content.
- Added 30-second, exact-command, single-use run tickets that bind child key access to the originating agent session.
- Added selective injection with `warden run --only NAME[,NAME...] -- <command>`.
- Added `warden vault add`, `vault seed`, `vault list`, and `warden run` without an argument-parsing dependency.
- Real values are loaded only after ticket consumption and passed only to the spawned child environment.

## Segment 02 result

- Foundation: `decide()` is async; engine stages are injectable; schema uses versioned migrations (v2 adds the vault tables, and v1 DBs upgrade in place).
- Guardrails (`src/policy/`): control-file writes ask; secret reads ask unless the .env is vault-seeded and fully canaried; destructive commands ask; download-to-shell sandboxes (blocks if untrusted); untrusted exec and egress sandbox; untrusted outbound MCP blocks; touching Warden blocks.
- Catches shell routes (`echo >> AGENTS.md`, tee, cp/mv, Set-Content, sed -i, inline `node -e`) and path tricks (`..`, case, `\`, trailing dots, `::$DATA`, `\\?\`, `~`).
- Tests: 22 new guardrail cases, including an explicit no-false-positive suite for everyday dev commands.
- Verified that Cline `cancel:true` on PreToolUse aborts the whole task (`memory-bank/hookContracts.md`).

## Verification (Segment 02)

- `npm.cmd test`: 52 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- Hook process e2e: Cline `echo >> .\Agents.md` -> cancel, Cursor read `.ENV` -> deny, `npm test` -> allow.

## Segment 02 + 05/06 merge

- Vault canary blocking became the engine's `canaries` stage, combined by strictest-wins with guardrails. A run ticket is issued only when the final verdict is allow.
- `Engine(store, { workspaceRoot, stages, vault })` replaces the positional `vault` argument.
- `vault_run_tickets` is schema migration 3; `SecretVault` calls `migrate()` instead of creating its own tables.
- `scanWardenCanaries` moved to the keychain-free `src/vault/canary.ts` and is re-exported from `secrets.ts`.
- Verification: `npm.cmd test` 74 passed, 0 failed, 3 Docker-only skips; `npm.cmd run typecheck` passed.

## Merge verification

- `npm.cmd test`: 42 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.
- `node bin/warden.mjs vault list`: passed as a real CLI-process smoke test.

## Segment 06 result

- Added `shadowRun()` with deterministic static inspection and optional Docker execution.
- Docker runs only when the daemon responds and the configured image already exists locally; hooks never pull images.
- Docker uses a throwaway repository copy, `--network none`, no host application environment, resource limits, and a timeout.
- Secret files are replaced by canaries and copied text files are redacted before mounting.
- Fake `curl` and `wget` wrappers record attempted egress while returning failure.
- Static fallback follows bounded workspace-local scripts and detects secret reads, token environment access, canaries, network clients, encoding tricks, and control-file writes.
- Scripts outside the protected repository and sandbox timeouts fail closed.
- Docker-only tests skip when Docker is unavailable.
- Verified with 51 passing tests, 3 Docker skips, strict typechecking, and a zero-vulnerability audit.

## Segment 03 result

- Added schema v4 with sticky session origins, first-writer file provenance, and hashed post-result injection observations; raw result bodies are not persisted.
- Cline `PostToolUse` and Cursor `postToolUse` / `afterShellExecution` / `afterMCPExecution` are observational and never block. External results taint even if the injection regex does not flag them.
- Workspace file reads (and simple shell argument reads) inherit file taint across agents/sessions. A denied pre-read does not spread taint.
- Before an allowed tainted write, preserve the original existing file under `.warden/snapshots/` once, or record that it did not exist. Later tainted writes never replace the baseline. Trusted edits do not automatically clean a tainted file.
- Direct shell redirection targets are approximated; dynamically computed paths, writes inside scripts, missed hooks, and broad file search/list output remain visibility gaps. Filesystem/sandbox observation and a future explicit trust-reset/review workflow are needed.
- Untrusted command execution now invokes the sandbox: a poisoned `setup.sh` is blocked, while benign static evidence may allow through. Sandbox summaries are not yet stored in `sandbox_runs`.
- Verification: `npm.cmd run typecheck` and `npm.cmd test` (79 passed, 3 optional Docker skips); `git diff --check` passed.