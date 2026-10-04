# Project Progress

## Current status

Segments 00, 01, 02, and the standalone portion of 05 are complete and verified together. Segment 03 is next.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [ ] Segment 03 — Trust Tracking
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault (engine/schema/CLI integration pending)
- [ ] Segment 06 — Sandbox
- [ ] Segment 07 — Cline Responder
- [ ] Segment 08 — Dashboard + Install
- [ ] CLI integration
- [ ] Offline demo

## What works

- Strict TypeScript ESM project, shared contracts, and portable paths.
- SQLite ledger with redacted previews, WAL, and a busy timeout.
- Async engine with injectable stages; strictest-finding-wins combination; every decision recorded.
- Fixed guardrails: control files (ask), secret reads (ask, except vault-canaried .env), destructive commands (ask), download-to-shell (sandbox/block), untrusted exec and egress (sandbox), untrusted outbound MCP (block), Warden tampering (block).
- Shell commands checked for redirects, copy targets, modifying verbs, and inline-code paths; paths canonicalized against Windows, casing, and traversal tricks.
- Versioned schema migrations (`user_version` 2) including vault tables; v1 databases upgrade in place.
- Cline and Cursor hook adapters normalize host payloads and return valid host responses.
- Hook routing fails open and handles UTF-8/UTF-16 BOM input.
- Both hosts write to the repository's shared `.warden/warden.db`.
- `.env` values can be moved into a `SecretStore` and replaced by randomized canaries.
- Production secret storage uses `@napi-rs/keyring`; tests use memory.
- Canary scanning detects known and copied Warden placeholders.
- Session grants record injected key names without persisting values.
- Child processes receive secrets without mutating the parent environment.
- Environment files outside the protected repository are rejected.

## Remaining work

Segments 03–04 and 06–08, CLI integration, offline demo, and the Segment 05 engine canary-scan stage.

## Mocks and shortcuts

- Trust is `action.untrustedInput` (adapters always set false) until Segment 03.
- `sandbox` and `ask` verdicts reach hosts as cancel/deny until Segments 06/08.
- Risk fields in decisions are zero until Segment 04.
- Hook scripts and installer are deferred to Segment 08.
- No Cline SDK plugin adapter yet; file hooks only.
- Automated tests do not touch the real OS keychain.
- Engine canary blocking and CLI argument handling are deferred.

## Known issues

- Hook startup through `tsx` costs roughly 300 ms.
- `npm ci` may print an esbuild `allowScripts` warning.
- Cursor `ask` enforcement depends on host mode/version, so Warden uses deny.
- Cline cancel on "ask" ends the user's task run.
- Guardrails miss variable indirection, encoded commands, and files written by scripts.

## Decision evolution

- Node 22.13 minimum for stable `node:sqlite`.
- Redacted previews plus SHA-256 hashes in the ledger.
- Use `npm.cmd` for Windows validation.
- Hosts never resolve `ask`; all non-allow verdicts are cancel/deny at the adapter boundary.
- `SecretStore` isolates OS keychain access from deterministic tests.
- Canary format is `__WARDEN_CANARY__<NAME>__<24 hex>__`.
- `decide()` is async to allow CLEF and dashboard approvals later.
- Schema evolves only through appended migrations.
- Guardrails use lexical shell matching, not a shell parser; deeper evasion is left to trust, risk, and the sandbox.
- Cline `cancel` aborts the task (verified in source), so "ask" must be resolved before replying to Cline.

## Verification

- `npm.cmd test`: 52 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.