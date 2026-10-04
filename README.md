# Warden

Warden is local detection and response for AI coding agents such as Cline and Cursor. It observes agent tool calls, applies deterministic security rules, detects secret canaries, and records decisions in a repository-local SQLite ledger.

Warden is designed for attacks that look harmless one step at a time—for example, a poisoned issue causing one agent to write persistent instructions that a later agent follows to leak a credential.

## Current status

Implemented:

- Cline and Cursor hook adapters
- Deterministic guardrails
- Trust propagation across sessions and agents
- Secret vault backed by the OS keychain
- Secret canaries and outbound canary blocking
- Ticketed `warden run` secret injection
- Static and optional Docker shadow sandbox
- Guardrail-triggered live sandbox invocation
- Windows/Linux/macOS hook installer
- `warden doctor` and safe uninstall

Still in progress:

- Risk scoring and cumulative session budgets
- Sandbox evidence persistence
- Deterministic incident responder
- Dashboard and human approval flow
- Full offline attack demo

## Requirements

- Node.js **22.13 or newer**
- npm
- Windows 11, Linux, or macOS
- Cline and/or Cursor
- Docker is optional

The current hackathon build runs TypeScript through `tsx`, so install all repository dependencies before using the hooks.

## Install Warden itself

Clone Warden and install its dependencies:

```bash
git clone https://github.com/rocketpowerkille/hackathon.git warden
cd warden
npm install
```

### Option 1: create a global development link

From the Warden checkout:

```bash
npm link
```

You can then run `warden` from a repository you want to protect.

On Windows PowerShell, use `npm.cmd` instead of `npm` if execution policy blocks `npm.ps1`:

```powershell
npm.cmd install
npm.cmd link
```

### Option 2: run Warden directly from its checkout

No global link is required. From the repository you want to protect, run the launcher by absolute path.

Windows:

```powershell
node "C:\path\to\warden\bin\warden.mjs" init
```

Linux/macOS:

```bash
node /path/to/warden/bin/warden.mjs init
```

## Protect a repository

Change into the repository that Cline or Cursor will use:

```bash
cd /path/to/project
```

Then initialize Warden:

```bash
warden init
```

Or, when using the source checkout directly:

```bash
node /path/to/warden/bin/warden.mjs init
```

`warden init`:

- Creates Cline hooks for `PreToolUse`, `TaskStart`, and `UserPromptSubmit`
- Adds Warden entries to Cursor's `.cursor/hooks.json`
- Preserves existing Cursor hook entries
- Refuses to overwrite existing Cline hook files
- Adds `.warden/` to `.gitignore`
- Writes ownership metadata to `.warden/install.json`
- Is safe to run repeatedly

### Windows files

```text
.clinerules/hooks/PreToolUse.ps1
.clinerules/hooks/TaskStart.ps1
.clinerules/hooks/UserPromptSubmit.ps1
.warden/hooks/cursor-preToolUse.ps1
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
- `tsx` runtime availability
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

   The current file-hook behavior cancels a non-allowed Cline action. Dashboard approval handling is not implemented yet.

> Cline exposes one workspace hook filename per event. If a Cline hook already exists, Warden preserves it and `warden doctor` reports the collision instead of overwriting it.

## Verify Cursor

After `warden init`, open the repository in Cursor. Warden entries are merged into:

```text
.cursor/hooks.json
```

Existing entries remain intact. Run `warden doctor` to confirm the Warden wrappers and configuration are present.

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
```

Linux/macOS:

```bash
npm test
npm run typecheck
```

Tests require no API keys, cloud services, or Docker. Docker-only sandbox tests skip automatically when Docker or the configured image is unavailable.

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
- The dashboard and approval UI are not implemented.
- Sandbox decisions run live, but their evidence summaries are not yet persisted in a dedicated ledger table.
- Cline Windows `.ps1` discovery should be manually verified against the installed Cline version.
- The source-checkout installer requires `tsx`; a distributable release should compile TypeScript to JavaScript.
- Do not use real production credentials for manual testing yet.