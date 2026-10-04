# Project Progress

## Current status

Segments 00, 01, 02, 03, 05, 06, and 08B Install are implemented. Segment 08 is split: 08A Dashboard remains. Sandbox invocation is live; sandbox evidence persistence and broader observation remain outstanding.

## Milestones

- [x] Segment 00 — Foundation
- [x] Segment 01 — Agent Hooks
- [x] Segment 02 — Guardrails
- [x] Segment 03 — Trust Tracking (known shell/file visibility limitations)
- [ ] Segment 04 — Risk Scoring
- [x] Segment 05 — Secret Vault
- [x] Segment 06 — Sandbox (evidence persistence pending)
- [ ] Segment 07 — Cline Responder
- [ ] Segment 08A — Dashboard
- [x] Segment 08B — Install
- [ ] Remaining CLI integration
- [ ] Offline demo

## What works

- Strict TypeScript ESM project, shared action contracts, and portable paths.
- SQLite ledger with versioned migrations, WAL, busy timeout, sessions, decisions, vault metadata, and trust provenance.
- Cline and Cursor hooks share one repository ledger and fail open on Warden crashes.
- Fixed guardrails cover control files, secret reads, destructive commands, remote execution, untrusted execution/egress, MCP egress, and Warden tampering.
- Session taint persists across actions; file taint propagates across agents and sessions.
- Tainted writes preserve the original baseline or record a newly created file for responder recovery.
- Secret vault, canary blocking, single-use run tickets, and selective child-process injection work without storing values in SQLite.
- Guardrail sandbox findings invoke static/optional Docker shadow execution.
- `warden init`, doctor, and uninstall pass real CLI-process tests in temporary repositories.
- Generated Cline and Cursor wrappers pass JSON stdio process tests.
- Root README documents installation and current limitations.

## Remaining work

- Segment 04 risk scoring.
- Segment 07 responder.
- Segment 08A Dashboard and approval flow.
- Redacted `sandbox_runs` persistence.
- Broader shell/file observation and explicit reviewed trust reset.
- Remaining CLI commands and full offline demo.

### Segment 08B remaining verification / packaging

- [ ] Manually verify `.ps1` discovery with the actual installed Cline version on Windows.
- [ ] Manually enable Cline Hooks in Feature Settings.
- [ ] Run generated Unix wrappers in Linux CI.
- [ ] Compile TypeScript for a distributable package without runtime dependence on dev `tsx`.
- [ ] Decide whether a future dispatcher should compose occupied Cline event filenames.

## Mocks and shortcuts

- `ask` still reaches hosts as cancel/deny pending Dashboard approval.
- Risk fields remain zero until Segment 04.
- Existing Cline hook files are preserved rather than composed.
- Automated tests use an in-memory secret store; native keychain needs manual smoke tests.
- Docker-only tests skip when Docker is unavailable.
- Network wrappers can be bypassed by absolute-path clients, so static detection and `--network none` remain authoritative.
- Sandbox evidence summaries are not yet persisted.

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

- `npm.cmd test`: 94 passed, 0 failed, 3 Docker-only tests skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.