# Active Context

## Current focus

All segment branches are merged into `segment-demo-chain`, including risk scoring, responder, dashboard, installer, and demo Parts 1–2. Current work is merge reconciliation and final integration boundaries.

## Repository state

- Minimum Node version is 22.13.
- PowerShell blocks `npm.ps1`; use `npm.cmd` locally.
- Run `npm ci` on a fresh checkout because `node_modules` is not committed.
- The source-checkout hook launchers require the approved `tsx` development dependency.

## Recent changes

### Segment 04 and sandbox ledger

- CLEF typed noul scores use Ollama `/v1/systemone` then Cloudflare Workers AI with 350 ms total timeout and offline fallback; remote state is structural only.
- Noisy-OR risk and weighted cumulative budget use ask 1.2/block 2.3; reads accrue at 0.2 weight but never budget-block.
- Decision backend, questions, p, budget, and latency are persisted; schema v5 adds `sandbox_runs` redacted summaries linked to actions and decisions.
- Added `warden status` and `warden score [SESSION_ID]` separate modules; test preload forces offline mode.
- Contract and limitations are in `riskScoring.md`.

### Segment 03

- Added schema v4 with sticky session origins, first-writer file provenance, snapshots, and hashed injection observations.
- Added `src/core/trust.ts` and engine trust enrichment from shared ledger provenance.
- Added Cline `PostToolUse` plus Cursor `postToolUse`, `afterShellExecution`, and `afterMCPExecution` observation paths.
- External results taint conservatively; raw result bodies are not persisted.
- Tainted file reads propagate trust across agents and sessions.
- Allowed tainted writes preserve the first pre-taint baseline once.
- Engine invokes `shadowRun()` only for guardrail sandbox requests without a higher-priority finding.

### Segment 08B Install

- Added `warden init [--seed-env]`, `warden uninstall`, and `warden doctor`.
- Added PowerShell Cline wrappers on Windows and executable extensionless wrappers on Unix.
- Added project-local Cursor wrappers and merged `preToolUse` plus `beforeSubmitPrompt` entries.
- Added ownership metadata with fixed-event and hash-checked uninstall behavior.
- Added idempotency, existing-hook preservation, malicious-manifest containment, duplicate Cursor-entry, CLI-process, and generated-wrapper tests.
- Added `README.md` with installation and usage instructions.
- Added `bin/hook.mjs`; local startup benchmark was about 175 ms versus about 206 ms for the previous path.

### Segment 07 Responder

- Added deterministic investigation/remediation, mock npm/GitHub rotation providers, safe snapshot restore/quarantine, idempotent response state, and incident reports.
- Added two restricted optional Cline SDK sessions and a standalone responder CLI.

### Segment 08A Dashboard

- Added a loopback-only authenticated dashboard, decision/session timeline, risk/sandbox evidence, approval endpoints/waiter, and incident listing.
- Dashboard approval is not yet connected to the engine or root CLI.

### Demo Parts 1 and 2

- Added a fake failing Node repo, poisoned issue #42, localhost attacker, replay fixture, and colored trace.
- Part 1 proves the fake token leaks without Warden.
- Part 2 replays real Cursor/Cline payload shapes through `runHook`; Warden carries taint across days, sandboxes the script, blocks it, and sends nothing to the attacker.

## Current decisions

- Session and file taint are sticky. Trusted edits do not automatically clear provenance.
- Raw hook/tool output is hashed and classified, not saved verbatim.
- A sandbox allow continues the remaining engine pipeline; it is not an unconditional final allow.
- Sandbox evidence persistence now follows engine invocation and is linked to the decision.
- Installer removal paths are derived from fixed supported events; manifest paths are never trusted directly.
- Existing Cline hooks are never overwritten or automatically chained.
- Cursor commands reference stable project-local wrappers.
- Plain init and doctor do not open the database/keychain; only `init --seed-env` opens the vault.

## Next step

Connect dashboard approval waiting to `Engine.decide`, add root CLI dispatch for dashboard/respond, then add responder recovery as demo Part 3.

## Remaining work

- Improve observation of dynamically generated shell paths, writes performed inside scripts, and broad file listing/search output.
- Wire the implemented responder/dashboard commands into the root CLI and connect approval waiting to the engine.
- Add responder recovery to demo Part 3.
- Add explicit review/trust-reset semantics rather than auto-clearing taint.

## Install manual verification / packaging

- Manually verify `.ps1` discovery with the installed Cline version on Windows.
- Enable Cline Hooks manually in Feature Settings.
- Add Unix wrapper execution to a real Linux CI runner.
- Compile TypeScript for a distributable release so runtime hooks do not depend on source-checkout `tsx`.
- Decide whether a future dispatcher should compose occupied Cline event filenames.

## Verification

- `npm.cmd test`: 117 passed, 0 failed, 0 skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

## Active risks

- Cline `cancel` aborts the whole task; approval must be resolved before replying.
- Cursor `ask` is not reliably enforced.
- Guardrail and trust shell matching remain lexical and visibility-limited.
- Docker tests require a running daemon and cached `node:22-alpine`; the full merged validation ran them successfully.
- `@cline/sdk@0.0.90` currently adds documented transitive audit findings; deterministic responder mode does not load it.
- The real OS keychain adapter is not exercised by automated tests.