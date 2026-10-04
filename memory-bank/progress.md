# Project Progress

## Current status

Segments 00, 01, 02, 05, 06, and 08B Install are complete and verified. Segment 08 is split: 08A Dashboard remains. Next core work is sandbox engine wiring, then Segment 03.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [ ] Segment 03 — Trust Tracking
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault
- [x] Segment 06 — Sandbox (engine/guardrail wiring pending)
- [ ] Segment 07 — Cline Responder
- [ ] Segment 08A — Dashboard
- [x] Segment 08B — Install
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
- `warden init`, `doctor`, and `uninstall` pass real CLI-process tests in temporary repositories.
- Init generates Windows/Linux Cline hooks, merges Cursor arrays, adds `.warden/` to Git ignore, and optionally seeds `.env`.
- Install is idempotent and preserves existing or modified hooks.
- Uninstall removes only fixed, Warden-owned, hash-matching files and keeps state ignored when state remains.
- Generated Cline and Cursor wrappers both pass JSON stdio process tests.

## Remaining work

Segments 03–04, 07, 08A Dashboard, sandbox engine/ledger wiring, remaining CLI commands, and the offline demo.

### Segment 08B remaining verification / packaging

- [ ] Manually verify `.ps1` discovery with the actual installed Cline version on Windows.
- [ ] Manually enable Cline Hooks in Feature Settings; repository installation cannot toggle it.
- [ ] Add CI execution of Unix wrappers on a real Linux runner.
- [ ] Compile TypeScript for a distributable package so runtime hooks do not depend on the source checkout's `tsx` dev dependency.
- [ ] Decide whether a future dispatcher should compose occupied Cline event filenames; current behavior safely skips and reports them.

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

- Trust is `action.untrustedInput` (adapters always set false) until Segment 03.
- `sandbox` and `ask` verdicts reach hosts as cancel/deny until Segments 06/08.
- Risk fields in decisions are zero until Segment 04.
- Existing Cline hook files cannot be merged through Cline's one-file-per-event interface; doctor reports these collisions as errors.
- No Cline SDK plugin adapter yet; file hooks only.
- Automated tests do not touch the real OS keychain.
- Automated tests use memory storage; the native keychain needs one manual smoke test per platform.
- Docker-only tests are skipped locally because the daemon is unavailable; static fallback is the required zero-Docker path.
- Network wrappers can be bypassed by absolute-path clients, so static network detection and `--network none` remain authoritative.
- The standalone sandbox is not yet reachable from live agent hooks; Guardrails now emit `sandbox`; the engine stage that calls `shadowRun()` is the next step.

## Known issues

- Dedicated `bin/hook.mjs` startup measured about 175 ms locally; production packaging still needs compiled JavaScript.
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

## Verification

- `npm.cmd test`: 89 passed, 0 failed, 3 skipped because Docker is unavailable.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.
- Real CLI launcher smoke test passed.