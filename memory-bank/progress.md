# Project Progress

## Current status

Segment 00 is complete. Work is paused before Segment 01.

## Milestones

- [x] Segment 00 — Foundation
- [ ] Segment 01 — Agent Hooks
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

- Strict TypeScript ESM project configuration.
- Shared `AgentAction`, verdict, decision, and risk contracts.
- Cross-platform workspace and `.warden` path construction.
- Initial SQLite sessions, actions, decisions, and approvals schema.
- Transactional action and decision recording.
- Secret-like environment assignments are redacted from stored previews.
- The allow-only engine skeleton records each decision in the shared ledger.
- `npm.cmd test`: 4 passed, 0 failed.
- `npm.cmd run typecheck`: passed.

## Remaining work

All runtime security segments remain after the foundation.

## Mocks and shortcuts

- The Segment 00 engine intentionally returns `allow` for every action. Guardrails begin in Segment 02.
- No optional runtime integrations are installed yet.
- The ledger redactor currently covers common assignment forms; vault-aware canary handling belongs to Segment 05.

## Known issues

- Cline Windows hook behavior must be validated during Segment 01.
- Cursor `ask` enforcement can depend on Cursor mode/version.

## Decision evolution

- Adopted Node 22.13 as the effective minimum for stable built-in SQLite availability.
- Chose redacted previews plus content hashes for the action ledger.
- Use `npm.cmd` for local Windows validation because PowerShell blocks `npm.ps1`.