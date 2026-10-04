# Project Progress

## Current status

Segments 00–08 are implemented in the merged tree. Demo Parts 1 and 2 are complete. Remaining work is approval/root-CLI integration and demo Part 3 responder recovery.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [x] Segment 03 — Trust Tracking (known shell/file visibility limitations)
- [x] Segment 04 — Risk Scoring (live model integration not exercised)
- [x] Segment 05 — Secret Vault
- [x] Segment 06 — Sandbox (schema-v5 evidence persistence)
- [x] Segment 07 — Cline Responder (root CLI/dashboard callback pending)
- [x] Segment 08A — Dashboard (engine/root CLI handoff pending)
- [x] Segment 08B — Install
- [ ] Remaining CLI integration
- [ ] Offline demo (Parts 1–2 complete; Part 3 pending)

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
- Sandbox summaries linked to actions and decisions persist in `sandbox_runs`; `warden status` and `warden score` are read-only commands.
- `warden init`, doctor, and uninstall pass real CLI-process tests in temporary repositories.
- Generated Cline and Cursor wrappers pass JSON stdio process tests.
- Root README documents installation and current limitations.
- Deterministic responder and restricted two-session SDK flow are implemented and tested.
- Local dashboard, approval waiter, security controls, and UI are implemented and tested.
- Demo Parts 1–2 prove localhost exfiltration without Warden and zero attacker requests with Warden.

## Remaining work

- Connect dashboard approval waiting to the engine and root CLI.
- Dispatch standalone dashboard/respond commands from the root CLI.
- Add responder recovery to demo Part 3.
- Broader shell/file observation and explicit reviewed trust reset.
- Full offline demo and remaining dashboard/responder CLI integration.

### Segment 08B remaining verification / packaging

- [ ] Manually verify `.ps1` discovery with the actual installed Cline version on Windows.
- [ ] Manually enable Cline Hooks in Feature Settings.
- [ ] Run generated Unix wrappers in Linux CI.
- [ ] Compile TypeScript for a distributable package without runtime dependence on dev `tsx`.
- [ ] Decide whether a future dispatcher should compose occupied Cline event filenames.

## Mocks and shortcuts

- `ask` still reaches hosts as cancel/deny pending Dashboard approval.
- CLEF model requests are tested with fakes; no live Ollama/Cloudflare evaluation or calibration was done. See `riskScoring.md`.
- Existing Cline hook files are preserved rather than composed.
- Automated tests use an in-memory secret store; native keychain needs manual smoke tests.
- Docker tests require Docker/image availability; the latest merged suite ran all Docker cases.
- Network wrappers can be bypassed by absolute-path clients, so static detection and `--network none` remain authoritative.
- Risk-budget read-then-write across concurrent hook processes is not strictly serializable; near-threshold races require future transactional handling.

## Known issues

- Dedicated `bin/hook.mjs` startup measured about 175 ms locally; production packaging needs compiled JavaScript.
- Cursor `ask` enforcement depends on host mode/version.
- Cline cancel on ask ends the task run.
- Dynamic/encoded commands and writes performed inside scripts remain observation gaps.

## Decision evolution

- Node 22.13 minimum for stable `node:sqlite`.
- Schema evolves only through appended migrations.
- Raw untrusted output is hashed, not stored.
- Taint is sticky until explicit reviewed cleanup.
- Sandbox allow continues evaluation; sandbox block joins final policy findings.
- Install manifest is bookkeeping, not authority; uninstall uses fixed event-derived paths and hashes.
- Cursor wrappers are project-local to avoid fragile Windows absolute-command quoting.

## Verification

- `npm.cmd test`: 117 passed, 0 failed, 0 skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.