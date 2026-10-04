# Active Context

## Current focus

Segment 05 is complete on the isolated `segment-05-vault` branch. Work is paused before integration, commit, or push.

## Repository state

- The repository began empty except for an empty `.clinerule`.
- The local runtime is Node 24.15.0, compatible with the Node 22.13 minimum.
- PowerShell blocks `npm.ps1`; use `npm.cmd` in Windows validation commands.

## Recent changes

- Added strict TypeScript and ESM project configuration.
- Added normalized action, verdict, decision, and risk contracts.
- Added portable workspace and `.warden` path helpers.
- Added the initial `node:sqlite` schema and transactional ledger writer.
- Added an allow-only engine skeleton that logs every decision.
- Added foundation tests for paths, redaction, persistence, and engine logging.
- Added native keychain and in-memory secret-store adapters.
- Added `.env` seeding with randomized Warden canaries.
- Added canary scanning, session grant records, and child-process-only secret injection.

## Current decisions

- Effective minimum Node version is 22.13 so `node:sqlite` does not require an experimental flag.
- Only approved development dependencies are introduced during Segment 00.
- The ledger stores a redacted content preview and SHA-256 hash, not arbitrary raw content.
- `Engine` is the sole decision compositor; adapters only normalize and translate.
- Future segment files are created only when their implementation begins.
- Vault tables are created by the vault module for parallel isolation; they can move into shared schema migrations during integration.
- Vault tests use only the in-memory store and obviously fake values; no real OS credentials are created.

## Next step

Wait for the parallel Segment 01–02 work, then integrate the vault with the shared schema, engine canary stage, and CLI commands.

## Verification

- `npm.cmd test`: 11 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.
- `npm.cmd audit --omit=dev`: 0 vulnerabilities.

## Active risks

- Cline Windows hook documentation and current `.ps1` discovery behavior are inconsistent; Segment 01 needs fixtures and a capability-oriented installer design.
- Cursor may ignore `ask` in some Auto-review configurations; `deny` remains the reliable enforcement path.
- Exact local Ollama System One compatibility will be tested in Segment 04 rather than assumed.
- `@napi-rs/keyring` behavior is adapter-tested by type contract only; automated tests intentionally avoid writing to the developer's real keychain.