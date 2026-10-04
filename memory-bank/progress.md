# Project Progress

## Current status

Segments 00 and 01 are complete. Segment 02 (Guardrails) is next.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [ ] Segment 02 — Guardrails
- [ ] Segment 03 — Trust Tracking
- [ ] Segment 04 — Risk Scoring
- [ ] Segment 05 — Secret Vault
- [ ] Segment 06 — Sandbox
- [ ] Segment 07 — Cline Responder
- [ ] Segment 08 — Dashboard + Install
- [ ] CLI integration
- [ ] Offline demo

## What works

- Strict TypeScript ESM project, core contracts, portable paths.
- SQLite ledger (sessions, actions, decisions, approvals) with redacted previews, WAL, busy timeout.
- Allow-only engine that records every decision.
- Cline and Cursor hook adapters normalize real host payloads into `AgentAction` and translate verdicts into each host's output schema.
- `runHook` fails open with valid host allow JSON on any Warden error; stdio entry point verified as a separate process, including UTF-8/UTF-16 BOM input from PowerShell.
- Cline and Cursor sessions write to one shared `.warden/warden.db` in the protected repo.
- `npm.cmd test`: 22 passed, 0 failed. `npm.cmd run typecheck`: passed.

## Remaining work

Segments 02-08, CLI integration, offline demo.

## Mocks and shortcuts

- Engine still returns `allow` for everything; adapter tests use a fake engine for non-allow verdicts.
- Hook scripts/installer are not generated yet (Segment 08); hosts invoke `tsx src/hooks/main.ts` manually for now.
- No Cline SDK plugin adapter yet; file hooks only.

## Known issues

- Hook startup through tsx costs about 300 ms per call.
- `npm ci` prints an esbuild `allowScripts` warning (harmless).

## Decision evolution

- Node 22.13 minimum for stable `node:sqlite`.
- Redacted previews plus SHA-256 hashes in the ledger.
- `npm.cmd` for Windows validation.
- Segment 01: hosts never see `ask`; every non-allow verdict is a hard cancel/deny at the host boundary.
