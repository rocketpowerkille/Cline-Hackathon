# Project Progress

## Current status

Segment 05 is complete on `segment-05-vault`. Integration is paused while Segment 01–02 proceeds in parallel.

## Milestones

- [x] Segment 00 — Foundation
- [ ] Segment 01 — Agent Hooks
- [ ] Segment 02 — Guardrails
- [ ] Segment 03 — Trust Tracking
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault (isolated branch; integration pending)
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
- `.env` values can be moved into a `SecretStore` and replaced by randomized canaries.
- Production secret storage uses `@napi-rs/keyring`; tests use an in-memory adapter.
- Canary scanning detects both known vault placeholders and copied Warden-shaped placeholders.
- Session grants record which key names were injected without storing their values.
- Child processes receive real values without mutating the parent environment.
- Environment files outside the protected repository are rejected.
- `npm.cmd test`: 11 passed, 0 failed.
- `npm.cmd run typecheck`: passed.

## Remaining work

Segments 01–04 and 06–08 remain. Segment 05 still needs shared engine, schema-migration, and CLI wiring after parallel work merges.

## Mocks and shortcuts

- The Segment 00 engine intentionally returns `allow` for every action. Guardrails begin in Segment 02.
- The real OS keychain is not exercised by automated tests to avoid modifying developer credentials.
- Vault tables currently self-initialize in `SecretVault`; integration should move them into the shared migration path.
- Engine canary blocking and CLI argument handling are deliberately deferred to avoid parallel merge conflicts.

## Known issues

- Cline Windows hook behavior must be validated during Segment 01.
- Cursor `ask` enforcement can depend on Cursor mode/version.

## Decision evolution

- Adopted Node 22.13 as the effective minimum for stable built-in SQLite availability.
- Chose redacted previews plus content hashes for the action ledger.
- Use `npm.cmd` for local Windows validation because PowerShell blocks `npm.ps1`.
- Added `SecretStore` as the vault boundary so deterministic tests do not depend on an OS credential service.
- Randomized placeholders use `__WARDEN_CANARY__<NAME>__<24 hex>__` and are security signals, not secrets.