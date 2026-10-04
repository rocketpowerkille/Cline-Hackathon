# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Not started | — |
| 03 Trust Tracking | Not started | — |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Complete | 42 tests passed; strict typecheck passed |
| 06 Sandbox | Not started | — |
| 07 Cline Responder | Not started | — |
| 08 Dashboard + Install | Not started | — |

## Current scope

Segments 01 and 05 are combined on `segment-05-vault`. Vault canary enforcement, run-ticket attribution, and the first CLI commands are wired in. Segment 02 policy work is next.

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