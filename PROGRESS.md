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
| 07 Cline Responder | Integrated | Root CLI, dashboard callback, sandbox evidence in reports tested |
| 08A Dashboard | Integrated | Live approvals, blocked-session incidents, report link tested |
| 08B Install | Complete | CLI and generated-wrapper e2e passed |

## Current scope

Segments 00–08 and the three-part offline demo are integrated. The fresh-install result-observation path, concurrent risk thresholding, fail-closed no-Docker execution, and production-only compiled runtime are tested. The demo uses a fake token/mock provider; real key rotation is deliberately not claimed.

## Deliberate shortcuts

- An ask is recorded and shown while waiting, then finalized on that same decision row: approved allows, denied/expired blocks. The run ticket and tainted-write snapshot are created only after approval. Cline still aborts the entire task on a final block.
- Model availability and latency are bounded; live CLEF integration still needs an environment with a model installed or Cloudflare credentials. Absent Ollama is cached under `.warden/` for 120 seconds across hook processes.
- Existing non-Warden Cline event files cannot be merged because Cline exposes one workspace filename per event; init preserves them and doctor reports the collision.
- Trust visibility for dynamically generated shell paths, writes inside scripts, and broad search/list outputs is incomplete; static-only untrusted execution is denied.
- Default responder has no real credential rotation providers: exposed keys remain OPEN. Mock rotation requires explicit demo flags and is never the dashboard default.

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

## Segment 07 responder result

- Deterministic investigator traces trust origins, tainted files, actual vault grants, and run tickets.
- Deterministic response rotates only granted keys, verifies old-key rejection, restores snapshots, quarantines created files, preserves later edits, and writes readable incident reports.
- Optional Cline SDK flow uses two restricted sessions with only Warden-provided tools.
- Root `warden respond` dispatch is active; deterministic mode requires no responder API credentials. Investigations and reports include persisted redacted sandbox evidence.

## Segment 08A dashboard result

- Local-only authenticated dashboard, decision/session timeline, risk and sandbox evidence, approvals, and incident listing are implemented.
- Engine approval wait and root `warden dashboard` dispatch are active. Sandbox/canary blocks produce open dashboard incident entries before any report exists; Respond runs deterministic recovery and offers an authenticated report view.

## Demo Parts 1 and 2

- Without Warden, the obviously fake npm token reaches a localhost attacker.
- With Warden, real Cursor/Cline payloads propagate taint, hold the control-file write, sandbox `scripts/setup.sh`, block execution, and deliver zero attacker requests.
- Demo Part 3 performs mock-backed key rotation/verification, restores the original `AGENTS.md`, and quarantines `scripts/setup.sh`.

## Combined verification

- Full `npm.cmd test`: 125 passed, 0 failed, 3 optional Docker tests skipped (October 4, 2026 verification).
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: **0 findings** after removing optional `@cline/sdk` from the default install. Installing it separately requires a new audit and security review.

## Known limitations

- Real host versions, local CLEF, OS keychain and Docker remain external verification gates; no native or live-provider success has been claimed.
- Mock rotation is suitable only for the offline demo. Build verified real providers before allowing an exposed real credential incident to close.