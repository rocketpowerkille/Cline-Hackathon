# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Not started | — |
| 03 Trust Tracking | Not started | — |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Complete | 42 tests passed; strict typecheck passed |
| 06 Sandbox | Complete; engine wiring pending | 51 tests passed; 3 Docker tests skipped |
| 07 Cline Responder | Not started | — |
| 08 Dashboard + Install | Not started | — |

## Current scope

Segments 01, 05, and the standalone Segment 06 sandbox are implemented. Segment 02 policy work is next; it will decide when the engine calls the sandbox.

## Deliberate shortcuts

- No security rule is active yet.
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