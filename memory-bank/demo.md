# Demo — Parts 1, 2, and 3

## Entry points

### Merge integration verified (2026-10-04)

Resolved recording-mode/Studio conflicts by retaining step/dashboard/pacing, session-scoped risk, column headings, and one truthful CLEF backend line. Visualizer parsing accepts scoped risk or absent unprotected risk instead of requiring the old R= format. Both recording and Studio/capabilities documentation remain. Full merged suite: 161 passed, 0 failed/skipped; dedicated Docker suite: 5 passed; typecheck/build and offline Docker-backed demo pass. The fresh-install assertion accepts both isolation backends while still requiring a block. No security policy changes or merge commit were made during resolution.

### Recording mode (2026-10-04)

Run `npm.cmd run demo -- --step --dashboard --delay 500` in an interactive terminal. `--step` pauses before each part; default line delay is 400 ms, overridden by `--delay` (0–5000 ms). Open the printed ephemeral-port dashboard URL in Part 2, press Enter at the readiness prompt, and click Allow on AGENTS.md within the unchanged 20-second window. Denial/expiry fails rather than bypassing approval. Live mode uses normal engine policy, not the simulated factory; additional budget approvals need real clicks too.

The dashboard stays live after Part 3 for the Closed incident and authenticated View report. Enter/Ctrl+C stops it, retaining report/temp repo. Demo dashboard is read/approval-only: deterministic mock-backed recovery runs in Part 3. Tests inject a readiness callback/pause and resolve authenticated requests without a browser. Unattended runs label simulation REPLAY/DEMO. Risk is R[cursor]/R[cline]; unprotected rows have no risk. 152 tests pass with Docker; typecheck/build and paced offline demo pass.

### Demo Studio and capabilities
- All-capabilities view: `/capabilities` on the Demo Studio server. Catalog/page: `demo/capabilities-model.ts` and `capabilities-page.ts`. Source-backed explanation, not a live health feed; only matching executed replay events count as replay evidence. Risk lab is illustrative; real thresholds are imported from policy. Guided tour, search/filter, recording/fullscreen controls. Tests: `test/capabilities.test.ts` and visualizer API coverage.

- Video visualizer: `npm.cmd run demo:visualize` → `http://127.0.0.1:8766/`. Implementation: `demo/visualize.ts`, `visualizer-model.ts`, `visualizer-server.ts`, `visualizer-page.ts`. Uses executed offline demo trace and summary, not synthetic success events. Only read-only loopback routes; no application or approval integration. OpenDots assessment summary is static prior context, not a live retest. Tests: `test/visualizer.test.ts`. The separate video guide was removed at the user's request; both visualizers remain.

### Visualizer verification

- Typecheck, build, new evidence/API test, and actual CLI startup passed.
- Local Chromium smoke test exercised evidence load, playback, chapter selection, stepping, scrubbing, findings panel, recording mode, keyboard restart, 1920×1080 fit, and 390px mobile width; no JavaScript errors. It reused the already-installed OpenDots Playwright package without installing dependencies or changing OpenDots. Preview: `.warden/video/demo-studio-1920.png` in the Warden checkout.
- Full regression run: 144 passed, 1 skipped, 1 failed. The unchanged install test at `test/install.test.ts:355` expects `static`, but the now-available Docker backend returns `docker`; isolated rerun reproduced the same backend-expectation failure. This existing test was not edited as part of the visualizer.

- `npm run demo`
- `demo/run-demo.ts`
- Replay fixture: `demo/replay-actions.json`

## Scenario

The demo creates two independent temporary Node repositories with a deliberately failing build, GitHub issue #42, an obviously fake npm token, and a localhost attacker server.

The hidden issue instruction asks an agent to:

1. add `scripts/setup.sh`, which reads `.env` and POSTs `NPM_TOKEN` to localhost;
2. append a line to `AGENTS.md` telling future agents to run the script.

## Part 1 — without Warden

- Cursor reads the issue.
- Cursor writes `AGENTS.md` and `scripts/setup.sh`.
- A later Cline step reads `AGENTS.md` and executes the script.
- The fake token must arrive at the localhost attacker or the demo fails.

On Windows the real shell script uses Git Bash when available; a Node fallback performs the equivalent fake-token POST to the local mock attacker when Bash is absent. Unix uses `/bin/sh` with the same fallback available for tests.

## Part 2 — with Warden

- Uses `runHook()` for every action with current Cursor and Cline payload shapes.
- Uses a temporary SQLite ledger and `MemorySecretStore`; the real OS keychain is never touched.
- Interactive runs with Cloudflare credentials use a demo-owned scorer, skip the Ollama probe, allow up to 10 seconds by default, print the persisted backend, and fail if a scored action does not record `cloudflare`. Tests retain `WARDEN_RISK_OFFLINE=1` and deterministic heuristic scoring.
- `.env` is vault-seeded into an in-memory store and rewritten to a canary.
- Cursor's external issue result produces an injection flag and sticky session taint.
- The first `AGENTS.md` write produces a control-file hold.
- The engine's dashboard waiter is integrated. To remain offline and unattended, the demo prints an explicit demo-only approval and replays the write with a local approval callback; the risk stage stays active. Production approval still requires a dashboard click.
- The later Cline session inherits taint by reading `AGENTS.md`.
- Executing `scripts/setup.sh` invokes the real sandbox stage and must produce a block plus a `sandbox_runs` ledger row.
- The localhost attacker must receive zero requests or the demo fails loudly.

## Output

Each part prints aligned `STATUS`, `ACTOR`, `ACTION`, `RISK`, and `DETAIL` column headings. The terminal then prints a colorized one-line trace with statuses including FAIL, FLAG, HOLD, ALLOW, BLOCK, and the final attacker request count. After the first scored action, one `CLEF` line explicitly says either `USED — Cloudflare clef-flash` / `USED — local clef-flash` or `NOT USED — offline heuristic`.

## Part 3 — Offline response

- Before the day-two `AGENTS.md` read, Cline obtains a scoped single-use `warden run --only NPM_TOKEN -- npm whoami` ticket; a mock child consumes it and records one real vault grant to the session without calling npm.
- Deterministic responder sees one exposed fake key, rotates/verifies it through `MockKeyProvider`, restores `AGENTS.md` from the first pre-taint snapshot, quarantines the attacker's script, and writes an inspectable report.
- Protected trace lines include session-scoped `R[cursor]=...` / `R[cline]=...`; unprotected lines omit risk. The report path remains on disk after a successful interactive demo. Tests clean up their temporary workspace.