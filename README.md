# Warden

Warden is local detection and response for AI coding agents such as Cline and Cursor. It observes agent tool calls, applies deterministic security rules, detects secret canaries, and records decisions in a repository-local SQLite ledger.

Warden is designed for attacks that look harmless one step at a time—for example, a poisoned issue causing one agent to write persistent instructions that a later agent follows to leak a credential.

## Current status

Implemented:

- Cline and Cursor hook adapters
- Deterministic guardrails
- Trust propagation across sessions and agents
- Risk scoring and cumulative session budgets
- Secret vault backed by the OS keychain
- Secret canaries and outbound canary blocking
- Ticketed `warden run` secret injection
- Static and optional Docker shadow sandbox
- Guardrail-triggered live sandbox invocation
- Persisted redacted sandbox evidence
- Deterministic incident responder with optional restricted Cline SDK sessions
- Local dashboard and approval service
- Offline attack demo Parts 1, 2, and 3 (mock credentials and provider)
- Windows/Linux/macOS hook installer with result-observation hooks
- `warden doctor` and safe uninstall

Still requiring integration verification: real Cline/Cursor host sessions, live CLEF, native keychain, Docker, and real credential rotation providers. No real credential rotation is claimed by the default responder.

## Requirements

- [Node.js 22.13 or newer](https://nodejs.org/en/download) and npm (verify with `node --version` and `npm --version`).
- Git to clone this repository; Cline and/or Cursor installed to exercise agent hooks.
- Windows 11, macOS, or Linux. The OS keychain is needed **only** if you seed or add secrets.
- Docker and Ollama/CLEF are optional. Without a usable Docker sandbox, Warden blocks untrusted executable code rather than treating a static scan as proof of safety. Risk scoring tries configured Cloudflare Workers AI first, then the offline heuristic. Local Ollama is attempted only if Cloudflare is unconfigured **and** `WARDEN_ENABLE_OLLAMA=1` is explicitly set.

## Cloudflare Workers AI scoring (preferred CLEF backend)

Hooks default to **1000 ms for configured Cloudflare** and **350 ms for local Ollama**. Set `WARDEN_CLEF_TIMEOUT_MS` (1–5000 ms) in Warden's `.env` or the editor's inherited environment to override; explicit environment values win. Remove an old `WARDEN_CLEF_TIMEOUT_MS=350` override to use the new Cloudflare default.

Cloudflare's combined `p <= 0.30` is treated as baseline noise: its raw score stays visible, but adds zero session budget. Above 0.30, the existing `-ln(1-p)` increment applies (reads weighted 0.2). This floor does not affect heuristic/Ollama accumulation or deterministic guardrails, canaries, and sandbox decisions. It is a practical noise filter, not a calibrated safety guarantee; existing accumulated budgets are not reset.

Cloudflare requests remain **structural-only by default**. Optionally set `WARDEN_CLOUDFLARE_SEND_SAFE_STATE=1` in Warden's `.env` or the editor environment to include a bounded action/intent excerpt. The complete input is screened before truncation; suspected credentials, secret-file references, or canaries omit the entire excerpt. URLs are reduced to origins. **This pattern-based filter cannot guarantee arbitrary text is secret-free; opt-in may send source code, paths, and task text to Cloudflare.** Leave it unset unless that data sharing is acceptable. Restart the editor after changing inherited environment settings.

Create a scoped Cloudflare API token with access to Workers AI. **From the Warden checkout** (not your protected project), copy its configuration template:

```powershell
Copy-Item .env.example .env
```

Set both values in the Warden checkout's `.env`:

```dotenv
CLOUDFLARE_ACCOUNT_ID=your-account-id
CLOUDFLARE_API_TOKEN=your-scoped-api-token
```

Warden calls `@cf/cloudflare/clef-flash` with `Authorization: Bearer`. Explicit process environment variables override `.env`. `CLOUDFLARE_AUTH_TOKEN` remains supported, and `CLOUDFLARE_API_KEY` is accepted as an alias only when it contains a scoped bearer API token. Do not put a legacy Cloudflare Global API Key there. Warden loads only allowlisted risk-provider settings and ignores unrelated application credentials.

Cloudflare is the default model-backed option on machines without a working Ollama server. If its request fails or exceeds the hook's bounded timeout, Warden immediately scores with its offline heuristic—**it does not probe Ollama afterward**. No Cloudflare credentials means immediate offline heuristic scoring unless local Ollama was explicitly enabled. Confirm actual use by looking for `backend=cloudflare` (or `backend=heuristic` for fallback) on a new ordinary decision in the dashboard; the demo alone does not validate your editor hooks.

From the **protected project's root**, run `node "$HOME\warden\bin\warden.mjs" clef check` in Windows PowerShell (or `node "$HOME/warden/bin/warden.mjs" clef check` on macOS/Linux) to make a harmless four-question request to **Cloudflare**. A successful result says `backend=cloudflare`; a missing token or invalid response exits nonzero. This diagnostic uses a longer timeout than live hooks and does not write a ledger decision. Start/restart Cline or Cursor so it inherits the same provider settings, perform one ordinary action, and confirm `backend=cloudflare` on the dashboard; otherwise the action used the offline heuristic. Tests never send real network requests or require API credentials.

Run setup from a **separate Warden checkout**, not inside the repository you intend to protect. Install Warden on the **same machine** where Cline/Cursor run: installed hook wrappers refer to the absolute Warden location. Keep that checkout in place while its hooks are installed. No registry publishing or hosted service is required.

For a source checkout, install dependencies with `npm ci` and run `npm run build`. A compiled production-only runtime can use `npm ci --omit=dev` without `tsx`.

## Windows 11 setup (PowerShell)

1. Install Node.js 22.13+ and Git; install Cline (VS Code) and/or Cursor. Open a **new PowerShell terminal** and check:

   ```powershell
   node --version
   npm.cmd --version
   git --version
   ```

2. Clone and build Warden. Use `npm.cmd`, not `npm`, if PowerShell blocks `npm.ps1`:

   ```powershell
   git clone https://github.com/rocketpowerkille/hackathon.git "$HOME\warden"
   Set-Location "$HOME\warden"
   npm.cmd ci
   npm.cmd run build
   ```

3. Open a **different project** in Cline/Cursor, then initialize Warden from that project's root (replace the example path):

   ```powershell
   Set-Location C:\path\to\your-project
   node "$HOME\warden\bin\warden.mjs" init
   node "$HOME\warden\bin\warden.mjs" doctor
   ```

   If the project already has a `.env` with **fake test values**, choose `init --seed-env` instead of `init` to move its values to Windows Credential Manager. Do not seed production credentials while evaluating this MVP. If `doctor` reports an occupied Cline hook filename, Warden preserved the original; that event is **not protected** until you resolve the collision.

4. If using Cline, open the project in VS Code and enable **Hooks** in Cline's Feature Settings. If using Cursor, open this same project in Cursor; `init` writes project-local `.cursor/hooks.json`. Restart/reopen the editor after installation if it does not see newly installed hooks. Check the installed files with `doctor` again.

5. In a **second PowerShell terminal**, start the approval dashboard from the protected project:

   ```powershell
   Set-Location C:\path\to\your-project
   node "$HOME\warden\bin\warden.mjs" dashboard
   ```

   Keep the terminal running while working in Cline/Cursor; press Ctrl+C to stop it. Without it, requests needing approval are denied immediately. In the first terminal, `node "$HOME\warden\bin\warden.mjs" status` and `node "$HOME\warden\bin\warden.mjs" score` inspect the ledger.

## macOS setup (Terminal)

1. Install Node.js 22.13+, Git, and Cline (VS Code) and/or Cursor; verify `node --version`, `npm --version`, and `git --version`.
2. Clone and build Warden:

   ```bash
   git clone https://github.com/rocketpowerkille/hackathon.git "$HOME/warden"
   cd "$HOME/warden"
   npm ci
   npm run build
   ```

3. From the root of the **different** repository to protect, initialize and check its hooks:

   ```bash
   cd /absolute/path/to/your-project
   node "$HOME/warden/bin/warden.mjs" init
   node "$HOME/warden/bin/warden.mjs" doctor
   ```

4. Enable **Hooks** in Cline Feature Settings if using Cline; open this project in Cline/Cursor. Start the dashboard in another Terminal window, from the **same project root**, and visit `http://127.0.0.1:8765/`:

   ```bash
   cd /absolute/path/to/your-project
   node "$HOME/warden/bin/warden.mjs" dashboard
   ```

   Keep it open for approvals; stop with Ctrl+C. Check `node "$HOME/warden/bin/warden.mjs" status` or `score` in a separate terminal.

## Linux setup (shell)

1. Install Node.js 22.13+, npm, Git, and Cline (VS Code) and/or Cursor; verify `node --version`, `npm --version`, and `git --version`. Ensure the OS keychain works in your desktop/session **before** seeding real values; Warden's automated suite uses an in-memory substitute.
2. Clone and build Warden:

   ```bash
   git clone https://github.com/rocketpowerkille/hackathon.git "$HOME/warden"
   cd "$HOME/warden"
   npm ci
   npm run build
   ```

3. From the root of a **different** repository, initialize and verify:

   ```bash
   cd /absolute/path/to/your-project
   node "$HOME/warden/bin/warden.mjs" init
   node "$HOME/warden/bin/warden.mjs" doctor
   ```

4. Enable **Hooks** in Cline Feature Settings if using Cline; open the project in Cline/Cursor. In another terminal run, from this project root:

   ```bash
   cd /absolute/path/to/your-project
   node "$HOME/warden/bin/warden.mjs" dashboard
   ```

   Open `http://127.0.0.1:8765/` locally. Keep the terminal open for approvals; stop with Ctrl+C. Use `node "$HOME/warden/bin/warden.mjs" status` or `score` in another terminal.

### Optional shorter command

From the Warden checkout, `npm.cmd link` (Windows) or `npm link` (macOS/Linux) installs a global shim. In the protected project, use `warden.cmd` in PowerShell (or `warden` on macOS/Linux) in place of each `node .../bin/warden.mjs` command above. If the shim is not on `PATH`, use the absolute launcher commands instead. Do **not** run `warden init` from the Warden source checkout unless that checkout is the project you intend to protect.

The generic `warden ...` examples below assume this optional link. Without it, run each command as `node "$HOME\warden\bin\warden.mjs" ...` on Windows or `node "$HOME/warden/bin/warden.mjs" ...` on macOS/Linux, **from the protected project's root**.

## What `warden init` does

`warden init`:

- Creates Cline hooks for `PreToolUse`, `PostToolUse`, `TaskStart`, and `UserPromptSubmit`
- Adds Warden entries to Cursor's `.cursor/hooks.json`
- Preserves existing Cursor hook entries
- Refuses to overwrite existing Cline hook files
- Adds `.warden/` to `.gitignore`
- Writes ownership metadata to `.warden/install.json`
- Is safe to run repeatedly

### Windows files

```text
.clinerules/hooks/PreToolUse.ps1
.clinerules/hooks/PostToolUse.ps1
.clinerules/hooks/TaskStart.ps1
.clinerules/hooks/UserPromptSubmit.ps1
.warden/hooks/cursor-preToolUse.ps1
.warden/hooks/cursor-postToolUse.ps1
.warden/hooks/cursor-afterShellExecution.ps1
.warden/hooks/cursor-afterMCPExecution.ps1
.warden/hooks/cursor-beforeSubmitPrompt.ps1
```

### Linux/macOS files

The equivalent Cline and Cursor wrappers are written without extensions and made executable.

## Initialize and seed `.env`

To move values from `.env` into the OS keychain during installation:

```bash
warden init --seed-env
```

Warden replaces real values in `.env` with randomized canary placeholders. Real values are not stored in SQLite.

Use only fake credentials while experimenting with the hackathon build.

## Verify installation

Run:

```bash
warden doctor
```

Doctor checks:

- Node.js version
- Warden hook launcher
- A compiled `dist/` runtime **or** the source-checkout `tsx` loader
- `.warden/` Git ignore entry
- Exact Cline wrapper contents
- Exact Cursor wrapper contents
- Cursor hook configuration

Doctor also reminds you to enable Cline hooks manually.

## Enable and test Cline

1. Open the protected repository in VS Code.
2. Open Cline settings.
3. Enable **Hooks** under Feature Settings.
4. Start a Cline task and request a harmless action, such as:

   ```text
   Read package.json
   ```

5. Confirm that the ledger exists:

   Windows:

   ```powershell
   Test-Path .warden\warden.db
   ```

   Linux/macOS:

   ```bash
   test -f .warden/warden.db && echo "Warden ledger created"
   ```

6. Test a protected control-file action:

   ```text
   Add a line to AGENTS.md
   ```

   Start `warden dashboard` in another terminal first. An ask waits up to 20 seconds for a click; deny, expiry, or a missing dashboard blocks the action. Cline's file-hook cancel stops the task, not just the tool call.

    To confirm result observation rather than only pre-tool checks, ask the agent to read a harmless public page or issue. Then inspect `warden score` and the local dashboard. **Do not test with real credentials.** If an expected hook file is missing or occupied, `warden doctor` reports it; an occupied hook means that event is not protected by Warden.

> Cline exposes one workspace hook filename per event. If a Cline hook already exists, Warden preserves it and `warden doctor` reports the collision instead of overwriting it.

## Verify Cursor

After `warden init`, open the repository in Cursor. Warden entries are merged into:

```text
.cursor/hooks.json
```

Existing entries remain intact. Run `warden doctor` to confirm the Warden wrappers and configuration are present.

## Optional local CLEF risk model (Ollama opt-in; not required)

**Do not install or start Ollama for the normal Cloudflare-first setup.** If you later want fully local inference, leave Cloudflare unconfigured and explicitly set `WARDEN_ENABLE_OLLAMA=1` in the environment inherited by the editor (or the allowlisted Warden checkout `.env`). The engine then calls Ollama's `/v1/systemone` with four typed yes/no (`noul`) questions. If Ollama fails, Warden uses the offline heuristic. **Even if Ollama is enabled, a configured Cloudflare failure falls directly to the heuristic, never to Ollama.** Install **Ollama 0.35.1 or newer** on the **same host** as Warden. `clef-flash` is a 9B model whose current download is approximately **11 GB**; allow for disk space and model warm-up. The default Ollama URL is `http://127.0.0.1:11434/v1/systemone`. See Ollama's [Windows](https://docs.ollama.com/windows), [macOS](https://docs.ollama.com/macos), and [Linux](https://docs.ollama.com/linux) instructions and the [clef-flash model page](https://ollama.com/library/clef-flash).

**Windows PowerShell:** install the native Ollama app using the [official Windows installer](https://docs.ollama.com/windows), launch Ollama, open a fresh terminal, then:

```powershell
ollama --version
ollama pull clef-flash
ollama list
```

Confirm `ollama --version` reports **0.35.1 or newer**; update Ollama if it does not. Check that `ollama list` contains `clef-flash`. The Windows app normally starts the local server in the background. If it is not running, start Ollama from the installed app; do not start a second server on the same port. After the model is downloaded, from the **protected project directory** run Warden's **local-only** diagnostic:

```powershell
Set-Location C:\path\to\your-project
Remove-Item Env:WARDEN_RISK_OFFLINE -ErrorAction SilentlyContinue
node "$HOME\warden\bin\warden.mjs" clef check --local
```

`clef check --local` makes a harmless local CLEF request with the same four questions as real hooks and reports `backend=ollama`, latency, and probabilities on success. It returns a nonzero exit code when the model is unavailable or replies with invalid answers. Unlike `clef check` without the flag, it never contacts Cloudflare or writes to the decision ledger. A successful local check also clears Warden's cached previous Ollama failure for this project. Use the `node ...` path above if you did not run the optional `npm.cmd link` step.

**If it fails on Windows:** `ollama list` only proves the model was downloaded, not that it fits in memory or can answer. Run `Get-Content "$env:LOCALAPPDATA\Ollama\server.log" -Tail 80` in PowerShell and look for `out of memory`, model-load failures, or an HTTP 500 on `/v1/systemone`; `ollama ps` shows models actually loaded. Close competing GPU workloads and retry. To **experiment** with CPU-only inference after a GPU out-of-memory error, first **Quit** the Ollama tray app so port 11434 is free; then, in a separate PowerShell window, start the server with these process-local settings:

```powershell
$env:CUDA_VISIBLE_DEVICES='-1'
$env:OLLAMA_VULKAN='0'
ollama serve
```

Leave that window open and rerun `node "$HOME\warden\bin\warden.mjs" clef check --local` from the protected project in another window. If the model cannot load on your hardware, or CPU inference is slower than the bounded hook timeout, **do not claim local CLEF is active**: Warden will use configured Cloudflare or its offline heuristic. Do not set `OLLAMA_HOST` to a public address. Ollama documents its [Windows log location](https://docs.ollama.com/windows) and [GPU selection settings](https://docs.ollama.com/gpu).

For the optional local path, remove Cloudflare credentials from the editor's environment and Warden checkout `.env`, set `$env:WARDEN_ENABLE_OLLAMA='1'`, then start/restart **Cline/Cursor** from that environment without `WARDEN_RISK_OFFLINE=1`. Take one harmless agent action such as editing a non-sensitive note. Keep `node "$HOME\warden\bin\warden.mjs" dashboard` running in another PowerShell window. `backend=ollama` on the new decision proves a real hook used local CLEF; `backend=heuristic` means it fell back. If Cloudflare remains configured, its `backend=cloudflare` takes priority regardless of the Ollama opt-in. Approval or a deterministic block can skip inference entirely; choose an ordinary action. `warden score` displays the cumulative budget, while the dashboard also displays its backend.

**macOS:** install the native Ollama app, start it, then run `ollama --version`, `ollama pull clef-flash`, and `ollama list` in Terminal. The current Ollama macOS requirements are macOS 14+; Apple Silicon supports GPU inference, while Intel Macs run on CPU.

**Linux:** follow the official [Linux install instructions](https://docs.ollama.com/linux), start/enable its service as documented there (or run `ollama serve` in a separate terminal for a manual installation), then run `ollama --version`, `ollama pull clef-flash`, and `ollama list`.

Ollama is **not started by Warden**. Keep its server running while using the model, and keep your protected project in the editor's workspace; changing the model does not require reinstalling Warden hooks.

`warden clef check --local` deliberately probes **local Ollama only**, even when normal hooks prioritize Cloudflare. `warden clef check` without the flag checks **configured Cloudflare**. To inspect the **raw local decision API** separately, use a harmless manual request (each `noul` answer is a number between 0 and 1). On macOS/Linux:

```bash
curl -sS http://127.0.0.1:11434/v1/systemone \
  -H 'Content-Type: application/json' \
  -d '{"model":"clef-flash","state":"A harmless greeting","questions":{"greeting":{"type":"noul","instructions":"Is this a greeting?","criteria":{"true":"The text greets someone.","false":"There is no greeting."}}}}'
```

On Windows PowerShell:

```powershell
$request = @{ model = 'clef-flash'; state = 'A harmless greeting'; questions = @{ greeting = @{ type = 'noul'; instructions = 'Is this a greeting?'; criteria = @{ 'true' = 'The text greets someone.'; 'false' = 'There is no greeting.' } } } } | ConvertTo-Json -Depth 6
Invoke-RestMethod -Uri 'http://127.0.0.1:11434/v1/systemone' -Method Post -ContentType 'application/json' -Body $request
```

The diagnostic allows up to 60 seconds to warm a cold model. **Agent hooks are faster:** local Ollama defaults to **350 ms** per action; configured Cloudflare defaults to **1000 ms**. A cold start or CPU-only 9B run may exceed the hook allowance, so that action falls back to the heuristic even when the diagnostic succeeds. Override with `WARDEN_CLEF_TIMEOUT_MS` between **1 and 5000** in Warden's `.env` or the editor's inherited environment. Restart the editor after changing inherited settings. Larger limits slow tool calls; keep margin below Cline's 30-second hook deadline. Inspect backend and latency on ordinary actions: configured Cloudflare should show `cloudflare`, opt-in local inference without Cloudflare should show `ollama`, and fallback shows `heuristic`. Set `WARDEN_RISK_OFFLINE=1` to force offline scoring. Local requests are loopback-only and screened for likely secrets, but the filter is **pattern-based**, not proof that arbitrary content contains no secrets.

### Should we Dockerize CLEF?

**Not as Warden's default or a required dependency.** CLEF is a model hosted by Ollama, not a separate service Warden needs to containerize. Native Ollama is simpler on a developer laptop and avoids making model availability depend on Docker Desktop; Warden already uses Docker *separately* for optional command isolation. The [official Ollama container](https://docs.ollama.com/docker) is a reasonable **opt-in** for Linux/Windows systems with a working Docker daemon and suitable model resources. It needs a persistent model volume and a **loopback-only** published port; Docker's default `-p 11434:11434` would expose the API more widely. Do not mount your repository, `.warden/`, secret files, or Docker socket into the Ollama container.

If you prefer Docker, stop any native Ollama server occupying 11434, start the Docker daemon, then use the official image:

```bash
docker run -d --name warden-ollama -p 127.0.0.1:11434:11434 -v warden-ollama-models:/root/.ollama ollama/ollama
docker exec warden-ollama ollama --version
docker exec warden-ollama ollama pull clef-flash
```

Confirm the printed container version is **0.35.1+** before pulling the model; update the image if it is older. On Windows, these `docker` commands work in PowerShell as written. On Linux with a configured NVIDIA Container Toolkit, add `--gpus=all` to the `docker run` command; do not assume GPU pass-through is available on every platform. The official image documents CPU, NVIDIA, and AMD configurations. Verify the decision endpoint with the platform-specific request above; use `docker stop warden-ollama` and `docker start warden-ollama` to stop/restart without losing the named model volume. **Do not run Ollama in Warden's sandbox container:** sandboxed commands intentionally have no network access, while Ollama is a distinct local inference service.

### Optional Docker command-isolation backend (different from Ollama)

Start Docker Desktop (Windows/macOS) or the Docker daemon (Linux), verify `docker info`, then cache the separate sandbox image with `docker pull node:22-alpine`. Warden uses this image for shadow execution with Docker networking disabled; `--pull=never` means Warden will not fetch it during a hook. When the daemon or image is unavailable, executable code requested by an untrusted session is **blocked**, even if a static check looks harmless. The Docker-specific automated tests skip until the daemon and cached image are both available.

## Vault commands

Add one secret using a hidden prompt:

```bash
warden vault add NPM_TOKEN
```

Seed an environment file:

```bash
warden vault seed .env
```

List stored key names without showing values:

```bash
warden vault list
```

## Run a command with vaulted secrets

Agent-approved commands use short-lived, single-use tickets. An agent may request:

```bash
warden run -- npm publish
```

Limit injection to selected keys:

```bash
warden run --only NPM_TOKEN -- npm publish
```

`warden run` fails closed when its ticket is missing, expired, reused, ambiguous, or does not match the exact command.

## Dashboard and incident response

Run `warden dashboard` from the protected repository to start a loopback-only dashboard at `127.0.0.1:8765`. Approvals and incident response require the dashboard's per-process token and matching browser origin. Exposed keys with no configured real rotation provider leave an incident **OPEN**; the default responder never treats mock rotation as real.

Use `warden respond --session <id> --deterministic` for offline, fail-closed investigation and file recovery. The optional `--sdk` mode requires installing and auditing `@cline/sdk` separately. The CLI never loads mock rotation providers; the offline demo injects its mocks in-process and **must not** be used for real credentials.

After reviewing responder recovery, `warden trust review-file <PATH>` requires an interactive local terminal and a typed confirmation; it clears file taint only if the content equals the original pre-taint snapshot or the attacker-created file has been removed. Session taint remains sticky.

## Uninstall repository hooks

From the protected repository:

```bash
warden uninstall
```

Uninstall:

- Removes only Warden-owned, unmodified hook files
- Removes only the Cursor entries Warden added
- Preserves user-owned and modified hooks
- Keeps `.warden/` ignored when database or incident state remains
- Does not delete vault values from the OS keychain

Run `warden doctor` afterward if you want to inspect the remaining setup.

## Development

Windows PowerShell:

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run build
```

Linux/macOS:

```bash
npm test
npm run typecheck
npm run build
```

Tests require no API keys, cloud services, or Docker. Docker-only sandbox tests skip automatically when Docker or the configured image is unavailable.

## Run the complete offline demo

From the **Warden checkout** (not the protected project), after `npm ci`, run `npm.cmd run demo` in Windows PowerShell or `npm run demo` on macOS/Linux. The demo creates temporary repositories, a loopback-only fake attacker, and fake credentials. It needs no running IDE, CLEF, or Docker daemon. On Windows it uses Git Bash when available and otherwise uses a Node fallback. It prints the location of its retained incident report; the demo's key rotation is mock-backed and is **not** evidence of rotation at a real provider.

## Repository state

All runtime state belongs inside the protected repository:

```text
.warden/
├── warden.db
├── install.json
├── hooks/
├── incidents/
└── quarantine/
```

Real secret values are stored in the operating system keychain, not in `.warden/`.

## Important limitations

- This is an in-progress hackathon MVP.
- Static-only sandbox evaluation cannot certify executable code. Without Docker, untrusted execution is blocked even if the static scan looks clean.
- The demo's key rotation is explicitly mock-backed; the default responder will leave exposed keys open until verified real provider adapters exist.
- The hook wrappers are tested as subprocesses, but real IDE version/enablement behavior, a live CLEF model, native keychain, and Docker daemon still require environment checks.
- Cline Windows `.ps1` discovery should be manually verified against the installed Cline version.
- Compile before a production-only install; `bin/` uses `dist/` without `tsx` when source-loader dependencies are absent. Do not deploy an unbuilt checkout with dev dependencies omitted.
- Do not use real production credentials for manual testing yet.