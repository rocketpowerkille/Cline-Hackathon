# Active Context

## Current focus

Segment 04 risk scoring and schema-v5 sandbox evidence persistence are in this working tree, along with separate CLI status/score modules. Do not touch dashboard/responder/demo folders: parallel branches own them.

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

Segment 07 responder and Segment 08A Dashboard are being handled on parallel branches. Remaining risk work: live model smoke tests and calibration, robust handling of concurrent budget updates, and broader secret-safe local-model gating.

## Remaining work

- Improve observation of dynamically generated shell paths, writes performed inside scripts, and broad file listing/search output.
- Implement responder, dashboard approvals, and offline demo on their respective branches.
- Add explicit review/trust-reset semantics rather than auto-clearing taint.

## Install manual verification / packaging

- Manually verify `.ps1` discovery with the installed Cline version on Windows.
- Enable Cline Hooks manually in Feature Settings.
- Add Unix wrapper execution to a real Linux CI runner.
- Compile TypeScript for a distributable release so runtime hooks do not depend on source-checkout `tsx`.
- Decide whether a future dispatcher should compose occupied Cline event filenames.

## Verification

- `npm.cmd test`: 99 passed, 0 failed, 3 Docker-only tests skipped.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

## Active risks

- Cline `cancel` aborts the whole task; approval must be resolved before replying.
- Cursor `ask` is not reliably enforced.
- Guardrail and trust shell matching remain lexical and visibility-limited.
- Docker runtime tests skip when the daemon/image is unavailable.
- The real OS keychain adapter is not exercised by automated tests.