# Project Progress

## Current status

Segments 00–08 and all three offline demo parts are integrated. Fresh-install Cline/Cursor result hooks now propagate taint across sessions; static-only execution denies when Docker cannot validate it; concurrent risk budget threshold checks are serialized. Production responder does not claim mock rotation as real.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [x] Segment 03 — Trust Tracking (known shell/file visibility limitations)
- [x] Segment 04 — Risk Scoring (live model integration not exercised)
- [x] Segment 05 — Secret Vault
- [x] Segment 06 — Sandbox (schema-v5 evidence persistence)
- [x] Segment 07 — Cline Responder (root CLI/dashboard callback and sandbox evidence integrated)
- [x] Segment 08A — Dashboard (engine/root CLI handoff integrated)
- [x] Segment 08B — Install
- [x] Remaining CLI integration
- [x] Offline demo (Parts 1–3, fake key and mock provider)

## What works

- Strict TypeScript ESM project, shared action contracts, and portable paths.
- SQLite ledger with versioned migrations, WAL, busy timeout, sessions, decisions, vault metadata, and trust provenance.
- Cline and Cursor hooks share one repository ledger and fail open on Warden crashes.
- Fixed guardrails cover control files, secret reads, destructive commands, remote execution, untrusted execution/egress, MCP egress, and Warden tampering.
- Session taint persists across actions; file taint propagates across agents and sessions.
- Tainted writes preserve the original baseline or record a newly created file for responder recovery.
- Secret vault, canary blocking, single-use run tickets, and selective child-process injection work without storing values in SQLite.
- Guardrail sandbox findings invoke static/optional Docker shadow execution.
- Risk answers combine through noisy-OR into a per-session cumulative budget, with Ollama/Cloudflare/heuristic backends and bounded fallback.
- Cloudflare credentials can be supplied through an allowlisted Warden package-root `.env` using account ID plus scoped bearer API token.
- Sandbox summaries linked to actions and decisions persist in `sandbox_runs`; `warden status` and `warden score` are read-only commands.
- `warden init`, doctor, and uninstall pass real CLI-process tests in temporary repositories.
- Generated Cline and Cursor wrappers pass JSON stdio process tests.
- Root README documents installation and current limitations.
- Deterministic responder and restricted two-session SDK flow are implemented and tested.
- Local dashboard, approval waiter, security controls, and UI are implemented and tested.
- Demo Parts 1–3 prove localhost exfiltration without Warden, zero attacker requests with Warden, and mock-backed rotation, restoration, and quarantine.
- Configured interactive demo runs require persisted `cloudflare` scoring; the test preload still forces the heuristic and makes no network calls.

## Remaining work

- Verify native host integrations, live model, and Docker backend on target machines; tests do not substitute for running these external services.
- Implement and verify actual npm/GitHub provider rotation or keep incidents open (the current default).
- Extend trust visibility for dynamic script writes and search/list results; reviewed file cleanup is implemented but session trust remains sticky.

### Segment 08B remaining verification / packaging

- [ ] Manually verify `.ps1` discovery with the actual installed Cline version on Windows.
- [ ] Manually enable Cline Hooks in Feature Settings.
- [ ] Run generated Unix wrappers in Linux CI.
- [x] Compile TypeScript into `dist/` and exercise a production-only CLI/hook install without dev `tsx`.
- [ ] Decide whether a future dispatcher should compose occupied Cline event filenames.

## Mocks and shortcuts

- An `ask` is recorded, waits for the dashboard (20-second maximum), then finalizes to allow/block before the host receives a verdict. No-dashboard denies immediately.
- CLEF model requests are tested with fakes; no live Ollama/Cloudflare evaluation or calibration was done. See `riskScoring.md`.
- Existing Cline hook files are preserved rather than composed.
- Automated tests use an in-memory secret store; native keychain needs manual smoke tests.
- Docker tests require a running Docker daemon and cached image; the current local suite skips three cases. Static-only untrusted executable code is denied, not cleared.
- Network wrappers can be bypassed by absolute-path clients, so static detection and `--network none` remain authoritative.
- Risk-budget decisions and increments are made while holding the SQLite immediate write lock; a three-process threshold test passes.

## Known issues

- Dedicated `bin/hook.mjs` startup measured about 175 ms locally; production packaging needs compiled JavaScript.
- Cursor `ask` enforcement depends on host mode/version.
- Cline cancel on ask ends the task run.
- Dynamic/encoded commands and writes performed inside scripts remain observation gaps; static-only execution blocks rather than inferring safety.

## Decision evolution

- Node 22.13 minimum for stable `node:sqlite`.
- Schema evolves only through appended migrations.
- Raw untrusted output is hashed, not stored.
- Taint is sticky until explicit reviewed cleanup.
- Sandbox allow continues evaluation; sandbox block joins final policy findings.
- Install manifest is bookkeeping, not authority; uninstall uses fixed event-derived paths and hashes.
- Cursor wrappers are project-local to avoid fragile Windows absolute-command quoting.

## Verification

- Full `npm.cmd test`: 125 passed, 0 failed, 3 optional Docker skips (October 4, 2026 verification).
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: **0 findings** after removing optional `@cline/sdk` from default dependencies. The opt-in SDK must be audited separately before installation or production use.