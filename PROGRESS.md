# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Complete | 52/52 tests, typecheck, hook e2e |
| 03 Trust Tracking | Not started | — |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Complete; integration pending | Verified in combined suite |
| 06 Sandbox | Not started | — |
| 07 Cline Responder | Not started | — |
| 08 Dashboard + Install | Not started | — |

## Current scope

Segments 00, 01, 02, and 05 (standalone) are on `main`. The engine now enforces fixed guardrails; trust tracking (03) is next.

## Deliberate shortcuts

- Trust is the `untrustedInput` flag (always false from adapters) until Segment 03.
- `ask` and `sandbox` reach hosts as cancel/deny until approvals (08) and the sandbox (06) exist.
- Vault canary scanning in the engine and `src/cli/warden.ts` are deferred.
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

## Merge verification

- `npm.cmd test`: 29 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.