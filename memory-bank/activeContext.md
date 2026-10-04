# Active Context

## Current focus

### Recording polish (2026-10-04)

- Demo CLI supports `--step`, `--dashboard`, and `--delay 0..5000`. Step mode pauses before each part and defaults to 400 ms per line. Dashboard mode starts a dedicated ephemeral-port dashboard on the protected temp repo, pauses for browser readiness, uses the real approval endpoint/deadline, and stays live after recovery until Enter/Ctrl+C.
- Live mode never uses the simulated approval factory. Unattended playback labels it REPLAY/DEMO. FLAG wording, separate R[cursor]/R[cline] labels, and ten-character status alignment are polished; fake credentials/mock recovery remain disclosed.
- Dashboard compares stable snapshots excluding remainingMs; unchanged polls preserve buttons while countdowns continue. Report viewer opens synchronously from the click and displays authenticated text via textContent.
- Reports distinguish deterministic and agent-assisted execution and no exposure versus verified rotation. Closure/security decisions remain unchanged.
- Validation: 152 tests passed, 0 failures/skips with Docker 28.3.2; typecheck/build/diff checks and paced offline demo pass. Real HTTP approval/report integration is tested, not a manual browser click-through.

### Cloudflare latency and baseline fix (2026-10-04)

- User reports real Cloudflare latency of 400–800 ms and benign combined p around 0.2. Configured Cloudflare hook default is now 1000 ms; local default remains 350 ms. Valid explicit overrides win, and the package `.env` now loads `WARDEN_CLEF_TIMEOUT_MS`.
- Only Cloudflare combined p <= 0.30 adds zero budget; higher scores retain the existing increment. Heuristic/Ollama small-signal accumulation and deterministic policies are unchanged. Existing budgets remain sticky.
- `WARDEN_CLOUDFLARE_SEND_SAFE_STATE=1` explicitly permits a gated 1500-character action/intent excerpt. Structural-only stays the default; full input is screened before truncation, URL details are removed, and sensitive input omits the excerpt. Pattern filtering is not a guarantee of secrecy.
- Regression tests cover 15 benign Cloudflare actions, meaningful-risk escalation, 500 ms inference, overrides, opt-in privacy, and secrets after the excerpt limit. Dependency-manifest edits present before this work are user-owned and preserved.

### Demo, Docker and responder additions

- SDK responder now loads a dedicated allowlist from the Warden package-root `.env` only for explicit `respond --sdk`. OpenAI native uses `OPENAI_API_KEY` (or responder override), provider `openai-native`, model `gpt-4.1-mini`; process variables win. Ordinary hooks/scoring still do not load responder credentials. Local `.env` configured without displaying key values; live SDK import issue remains unverified.

- Expanded Demo Studio with `/capabilities`, a 12-area source-backed Capability Explorer, searchable/filterable cards, four-step diagrams, source/test references, replay evidence links, visible limitations, guided recording tour, and an illustrative risk budget lab. No operational actions or live health claims. Original replay stays at `/`; same loopback read-only server and no added dependencies.

- Added `test/docker-sandbox.test.ts` and strict `npm.cmd run test:docker` launcher. Tests require actual Docker backend evidence, cover runtime writes/canaries/isolation/ledger links, and use only temporary fixtures. Ordinary tests skip if Docker is absent; explicit Docker verification fails. Updated the existing install test to accept either valid backend while still requiring a block.

- Added a standalone video presentation in `demo/visualize.ts` (`npm.cmd run demo:visualize`). It executes the existing offline demo in temporary workspaces, cleans those up, and serves an in-memory evidence replay on loopback port 8766. No OpenDots files are accessed. Playback includes attack flow, chapters, stepping, speed, recording mode, and explicit mock/replay labels. The separate video guide was removed at the user's request; both visualizers remain.

Segments 00–08 and the three-part offline demo are integrated. Fresh-init observation hooks, conservative no-Docker execution, serialized risk thresholds, compiled runtime, and fail-closed provider defaults were added in the hardening sweep. External host, model, Docker and real-credential checks remain pending.

## Repository state

- Minimum Node version is 22.13.
- PowerShell blocks `npm.ps1`; use `npm.cmd` locally.
- Run `npm ci` on a fresh checkout because `node_modules` is not committed.
- Source-checkout launchers use `tsx` when installed; `npm run build` generates `dist/` for a production-only runtime without `tsx`.

## Recent changes

### Segment 04 and sandbox ledger

- CLEF typed noul scores use configured Cloudflare Workers AI first, then the offline heuristic on failure; absent credentials use the heuristic immediately. Local Ollama `/v1/systemone` is attempted only with `WARDEN_ENABLE_OLLAMA=1` and no configured Cloudflare. Cloudflare state is structural only. `warden clef check` is explicitly local-only and does not change normal provider priority; hooks honor bounded `WARDEN_CLEF_TIMEOUT_MS`.
- Cloudflare bearer credentials can be read from an allowlisted Warden package-root `.env`; use `CLOUDFLARE_ACCOUNT_ID` plus `CLOUDFLARE_API_TOKEN`. `clef check` now tests Cloudflare by default; `clef check --local` never calls Cloudflare.
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
- Added project-local Cursor wrappers and merged `preToolUse`, `postToolUse`, `afterShellExecution`, `afterMCPExecution`, and `beforeSubmitPrompt` entries; Cline also installs `PostToolUse`. Specialized Cursor before-hooks are not installed alongside generic preToolUse, avoiding duplicate budget increments.
- Added ownership metadata with fixed-event and hash-checked uninstall behavior.
- Added idempotency, existing-hook preservation, malicious-manifest containment, duplicate Cursor-entry, CLI-process, and generated-wrapper tests.
- Added `README.md` with installation and usage instructions.
- Added `bin/hook.mjs`; local startup benchmark was about 175 ms versus about 206 ms for the previous path.

### Segment 07 Responder

- Added deterministic investigation/remediation, mock npm/GitHub rotation providers, safe snapshot restore/quarantine, idempotent response state, and incident reports.
- Added two restricted optional Cline SDK sessions and a standalone responder CLI.

### Segment 08A Dashboard

- Added a loopback-only authenticated dashboard, decision/session timeline, risk/sandbox evidence, approval endpoints/waiter, and incident listing.
- Engine approval waits on the dashboard and finalizes the recorded ask in place. Root `warden dashboard` and `warden respond` dispatch. Open incidents are derived from sandbox/canary blocks before a report exists. Dashboard callback runs deterministic responder and serves reports behind authentication.

### Demo Parts 1, 2 and 3

- Added a fake failing Node repo, poisoned issue #42, localhost attacker, replay fixture, and colored trace.
- Part 1 proves the fake token leaks without Warden.
- Part 2 replays real Cursor/Cline payload shapes through `runHook`; Warden carries taint across days, sandboxes the script, blocks it, and sends nothing to the attacker. Part 3 rotates a **mock** key, verifies old-key rejection, restores the original `AGENTS.md`, quarantines the malicious script, and writes a report.
- Configured interactive demo runs skip Ollama and require persisted `cloudflare` scoring within a 10-second demo-only timeout; automated tests remain offline.
- The demo prints one explicit `CLEF` status line after the first scored action and aligned `STATUS`, `ACTOR`, `ACTION`, `RISK`, and `DETAIL` headings for every part.

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

Test real host hook timing, Docker shadow behavior, a live local CLEF model and OS keychain on target machines. Real npm/GitHub rotation providers are not installed: production incidents with exposed keys remain open rather than falsely claiming a rotation.

## Remaining work

- Improve observation of dynamically generated shell paths, writes performed inside scripts, and broad file listing/search output.
- Validate a real browser/Cline hook approval under the 30-second VS Code timeout.
- Add verified real rotation providers after a credential/API contract review; the CLI cannot invoke mock providers, and the offline demo injects them in-process.
- File taint can be cleared only with interactive `warden trust review-file` after a matching pre-taint baseline or quarantine; session trust intentionally stays sticky.

## Install manual verification / packaging

- Manually verify `.ps1` discovery with the installed Cline version on Windows.
- Enable Cline Hooks manually in Feature Settings.
- Add Unix wrapper execution to a real Linux CI runner.
- Compiled `dist/` and production-only no-`tsx` CLI/hook smoke test pass; package/publish workflow still needs a dedicated release process.
- Decide whether a future dispatcher should compose occupied Cline event filenames.

## Verification

- Full suite: 142 passed, 0 failed, 3 Docker-only skips (October 4, 2026 after changing to Cloudflare-first scoring); compiled hook/CLI production-only smoke test passed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 findings after removing the optional SDK from default dependencies. SDK installation needs separate audit.

## Active risks

- Cline `cancel` aborts the whole task; approval must be resolved before replying.
- Cursor `ask` is not reliably enforced.
- Guardrail and trust shell matching remain lexical and visibility-limited.
- Docker client is present locally but daemon is down; three Docker-only tests skip, and static-only untrusted executable code is denied.
- `@cline/sdk@0.0.90` currently adds documented transitive audit findings; deterministic responder mode does not load it.
- The real OS keychain adapter is not exercised by automated tests.