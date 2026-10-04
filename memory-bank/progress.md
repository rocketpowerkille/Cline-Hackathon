# Project Progress

## Current status

Segments 00, 01, 02, 05 and standalone Segment 06 are complete; Segment 03 trust tracking and sandbox invocation are implemented. Sandbox evidence persistence, shell-write coverage, and approval remain outstanding.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [x] Segment 03 — Trust Tracking (known shell visibility limitations)
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault
- [x] Segment 06 — Sandbox (engine/guardrail wiring pending)
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
- Versioned schema migrations (`user_version` 3: ledger, vault, run tickets); older databases upgrade in place.
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
- Static sandbox fallback catches secret-file access, token environment use, canaries, network attempts, encoding tricks, control-file changes, and outside-workspace scripts.
- Docker shadow execution uses a sanitized throwaway copy, fake curl/wget logging, no network, no host application environment, and resource/time limits.
- Docker never pulls images during a hook and falls back to static inspection when unavailable.

## Remaining work

Segments 03–04 and 07–08, sandbox engine/ledger wiring, remaining CLI commands, and the offline demo.

### Segment 06 wiring checklist

- [x] Explicit workspace root and injectable stages on `Engine` (Segment 02). Still needed: a `sandbox` stage.
- [ ] Invoke the sandbox only for a Segment 02 `sandbox` guardrail result.
- [ ] Merge sandbox block reasons/labels into the final decision.
- [ ] Continue the engine pipeline after sandbox allow.
- [ ] Add `sandbox_runs` to the shared schema and store redacted evidence summaries.
- [ ] Add engine tests for all four guardrail verdict paths.
- [ ] Add hook-level sandbox allow/block tests.
- [ ] Add the poisoned `setup.sh` path to the offline demo.

## Mocks and shortcuts

- Trust is enriched by shared session/file provenance in the engine; adapters still start with false.
- `ask` still reaches hosts as cancel/deny pending approval; `sandbox` is evaluated in the engine.
- Risk fields in decisions are zero until Segment 04.
- Hook scripts and installer are deferred to Segment 08.
- No Cline SDK plugin adapter yet; file hooks only.
- Automated tests do not touch the real OS keychain.
- Automated tests use memory storage; the native keychain needs one manual smoke test per platform.
- Docker-only tests are skipped locally because the daemon is unavailable; static fallback is the required zero-Docker path.
- Network wrappers can be bypassed by absolute-path clients, so static network detection and `--network none` remain authoritative.
- Sandbox evidence ledger summaries are not yet persisted; dynamically generated shell writes and file discovery through listing/search remain blind spots.

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
- Vault canary blocking is an engine stage combined with guardrails; run tickets are issued only on a final allow.
- Run tickets bind session, exact child argv, and sorted `--only` selection for 30 seconds.
- Ambiguous identical tickets fail closed to protect responder attribution.
- Sandbox static analysis always runs before optional Docker execution.
- Sandbox rejects timeouts, Docker execution errors, and scripts outside the workspace.
- Shadow copies exclude known credential files and redact secret-like assignments and common inline token formats.
- Session taint and file taint are sticky; only a future explicit reviewed cleanup may clear provenance. The first pre-taint snapshot is never replaced by later tainted edits.

## Verification

- Segment 03: `npm.cmd test` 79 passed, 0 failed, 3 Docker-only skips; `npm.cmd run typecheck` and `git diff --check` passed.
- `npm.cmd test`: 74 passed, 0 failed, 3 skipped because Docker is unavailable (after merging Segment 02 with 05/06).
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.
- Real CLI launcher smoke test passed.