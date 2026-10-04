# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | 4 tests passed; strict typecheck passed |
| 01 Agent Hooks | Complete | 22 tests passed; strict typecheck passed |
| 02 Guardrails | Not started | — |
| 03 Trust Tracking | Not started | — |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Not started | — |
| 06 Sandbox | Not started | — |
| 07 Cline Responder | Not started | — |
| 08 Dashboard + Install | Not started | — |

## Current scope

Foundation plus Cline and Cursor hook adapters. The engine still allows everything.

## Deliberate shortcuts

- No security rule is active yet.
- No runtime dependency is installed yet.
- Hook wrapper scripts and installer arrive in Segment 08.

## Segment 01 result

- Added Cline (PreToolUse, UserPromptSubmit, TaskStart) and Cursor (beforeShellExecution, beforeMCPExecution, beforeReadFile, beforeSubmitPrompt, preToolUse) adapters.
- Added `runHook` and the stdio entry `src/hooks/main.ts <cline|cursor> [event]`, failing open with valid host JSON.
- Enabled SQLite WAL and busy timeout for concurrent hook processes.
- Added host-payload fixtures plus adapter, routing, fail-open, shared-ledger, and spawned-process tests.
- Verified with `npm.cmd test`, `npm.cmd run typecheck`, and `git diff --check`.
