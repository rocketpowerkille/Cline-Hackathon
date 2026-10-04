# Warden Progress

| Segment | Status | Verification |
| --- | --- | --- |
| 00 Foundation | Complete | Verified in combined suite |
| 01 Agent Hooks | Complete | Verified in combined suite |
| 02 Guardrails | Complete | Verified in combined suite |
| 03 Trust Tracking | Complete with documented visibility limits | Cross-agent/session tests passed |
| 04 Risk Scoring | Implemented; model/network caveats documented | Slow attack, routine workload, mock CLEF tests |
| 05 Secret Vault | Complete | Verified in combined suite |
| 06 Sandbox | Complete; evidence persisted in schema v5 | Redacted summary and decision linkage tested |
| 07 Cline Responder | Not started | — |
| 08A Dashboard | Not started | — |
| 08B Install | Complete | CLI and generated-wrapper e2e passed |

## Current scope

Segments 00–06 and 08B Install are implemented. Segment 04 risk scoring and schema-v5 sandbox evidence persistence are wired into the engine. Remaining priorities are Segment 07 responder and 08A Dashboard.

## Deliberate shortcuts

- `ask` still reaches hosts as cancel/deny until dashboard approvals are implemented.
- Model availability and latency are bounded; live CLEF integration still needs an environment with a model installed or Cloudflare credentials. Ollama is attempted per fresh hook process, so an absent local server can add up to 350 ms per scored action.
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

## Segment 04 and sandbox evidence result

- Four CLEF `noul` probability questions combine with noisy-OR; per-session budget adds `-ln(1-p)` (reads weighted 0.2). Ask at 1.2; block at 2.3; reads never block on budget alone. Existing specific findings provide the reason instead of budget.
- Local Ollama `/v1/systemone` clef-flash first, Cloudflare REST when configured, otherwise offline heuristic, with a 350 ms total budget. Cloudflare receives only structural signals. Backend, questions, probability, budget, and latency appear in decisions and persistence. Contract documented in `memory-bank/riskScoring.md`.
- Schema v5 adds redacted `sandbox_runs` linked to action and decision IDs, including inspected/changed/secret/control paths, network destinations, backend, verdict, duration, and canary count; no raw script output or tokens.
- `warden status` and `warden score [SESSION_ID]` are separate read-only command modules and do not initialize an absent ledger or open the keychain.
- Verified slow series: `p=0.12` asks on step 10 and blocks on step 18; normal 100-action session stayed at `p=0`, budget `0`, no asks. Tests load offline mode and use fake transport for API assertions.

## Combined verification

- `npm.cmd test`: 99 passed, 0 failed, 3 Docker-only tests skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.