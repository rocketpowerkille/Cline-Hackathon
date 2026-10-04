# Project Progress

## Current status

Segments 00, 01, and 05 are complete and verified together. Segment 02 is next.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [ ] Segment 02 — Guardrails
- [ ] Segment 03 — Trust Tracking
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault
- [ ] Segment 06 — Sandbox
- [ ] Segment 07 — Cline Responder
- [ ] Segment 08 — Dashboard + Install
- [ ] CLI integration
- [ ] Offline demo

## What works

- Strict TypeScript ESM project, shared contracts, and portable paths.
- SQLite ledger with redacted previews, WAL, and a busy timeout.
- Allow-only engine that records decisions.
- Cline and Cursor hook adapters normalize host payloads and return valid host responses.
- Hook routing fails open and handles UTF-8/UTF-16 BOM input.
- Both hosts write to the repository's shared `.warden/warden.db`.
- `.env` values can be moved into a `SecretStore` and replaced by randomized canaries.
- Production secret storage uses `@napi-rs/keyring`; tests use memory.
- Canary scanning detects known and copied Warden placeholders.
- Session grants record injected key names without persisting values.
- Child processes receive secrets without mutating the parent environment.
- Environment files outside the protected repository are rejected.
- Outbound canaries are blocked unconditionally for exec, net, write, and MCP actions.
- Allowed `warden run` commands receive short-lived, single-use tickets attributed to the agent session.
- `--only` limits the exact keys injected into the child process.
- The CLI supports vault add, seed, list, and ticketed run commands.

## Remaining work

Segments 02–04 and 06–08, remaining CLI commands, and the offline demo.

## Mocks and shortcuts

- Engine still returns `allow`; adapter tests use a fake engine for non-allow verdicts.
- Hook scripts and installer are deferred to Segment 08.
- No Cline SDK plugin adapter yet; file hooks only.
- Automated tests do not touch the real OS keychain.
- The vault retains idempotent table creation for isolated tests even though tables are also in the shared schema.
- Automated tests use memory storage; the native keychain needs one manual smoke test per platform.

## Known issues

- Hook startup through `tsx` costs roughly 300 ms.
- `npm ci` may print an esbuild `allowScripts` warning.
- Cursor `ask` enforcement depends on host mode/version, so Warden uses deny.

## Decision evolution

- Node 22.13 minimum for stable `node:sqlite`.
- Redacted previews plus SHA-256 hashes in the ledger.
- Use `npm.cmd` for Windows validation.
- Hosts never resolve `ask`; all non-allow verdicts are cancel/deny at the adapter boundary.
- `SecretStore` isolates OS keychain access from deterministic tests.
- Canary format is `__WARDEN_CANARY__<NAME>__<24 hex>__`.
- Run tickets bind session, exact child argv, and sorted `--only` selection for 30 seconds.
- Ambiguous identical tickets fail closed to protect responder attribution.

## Verification

- `npm.cmd test`: 42 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.
- Real CLI launcher smoke test passed.