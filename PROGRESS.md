# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Complete | Verified in combined suite |
| 03 Trust Tracking | Complete with documented visibility limits | Cross-agent/session tests passed |
| 04 Risk Scoring | Not started | — |
| 05 Secret Vault | Complete | Verified in combined suite |
| 06 Sandbox | Complete; evidence persistence pending | Static and optional Docker paths tested |
| 07 Cline Responder | Not started | — |
| 08A Dashboard | Not started | — |
| 08B Install | Complete | CLI and generated-wrapper e2e passed |

## Current scope

Segments 00, 01, 02, 03, 05, 06, and 08B Install are implemented. Trust tracking now enriches sessions from shared provenance and guardrail sandbox requests invoke `shadowRun()`. Remaining priorities are sandbox evidence persistence, Segment 04 risk scoring, Segment 07 responder, and 08A Dashboard.

## Deliberate shortcuts

- `ask` still reaches hosts as cancel/deny until dashboard approvals are implemented.
- Sandbox summaries are not yet persisted in `sandbox_runs`.
- Existing non-Warden Cline event files cannot be merged because Cline exposes one workspace filename per event; init preserves them and doctor reports the collision.
- Trust visibility for dynamically generated shell paths, writes inside scripts, and broad search/list outputs is incomplete.

## Segment 03 result

- Added sticky session origins, file provenance, and hashed post-result injection observations.
- Added Cline and Cursor post-tool observation hooks that never block.
- Workspace reads inherit taint across agents and sessions.
- Allowed tainted writes preserve the original file baseline once under `.warden/snapshots/` or record that the file was newly created.
- Trusted edits do not automatically clear taint; explicit reviewed cleanup remains future work.
- Guardrail sandbox findings now invoke `shadowRun()` and continue evaluation after a sandbox allow.

## Segment 08B Install result

- Added `warden init [--seed-env]`, `warden uninstall`, and `warden doctor`.
- Generates PowerShell Cline hooks on Windows and executable extensionless hooks on Linux/macOS.
- Merges Cursor arrays through project-local wrappers without replacing existing entries.
- Adds `.warden/` to `.gitignore` once and tracks ownership in `.warden/install.json`.
- Repeat init is idempotent and preserves user-owned or modified hooks.
- Uninstall removes only fixed, Warden-owned, hash-matching files and one owned Cursor entry.
- Optional `--seed-env` moves `.env` values into the vault before hook installation.
- Added a root README with installation, verification, vault, run, uninstall, and development instructions.
- Dedicated `bin/hook.mjs` startup measured about 175 ms versus about 206 ms for the previous path.
- Installer tests use temporary repositories only; this repository was never initialized.

## Combined verification

- `npm.cmd test`: 94 passed, 0 failed, 3 Docker-only tests skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.