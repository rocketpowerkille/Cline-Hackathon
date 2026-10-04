# Active Context

## Current focus

Segment 00 is complete. Work is paused before Segment 01 pending user approval.

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

## Current decisions

- Effective minimum Node version is 22.13 so `node:sqlite` does not require an experimental flag.
- Only approved development dependencies are introduced during Segment 00.
- The ledger stores a redacted content preview and SHA-256 hash, not arbitrary raw content.
- `Engine` is the sole decision compositor; adapters only normalize and translate.
- Future segment files are created only when their implementation begins.

## Next step

Segment 01 will implement current Cline and Cursor hook adapters after explicit user approval.

## Verification

- `npm.cmd test`: 4 passed, 0 failed.
- `npm.cmd run typecheck`: passed.
- `git diff --check`: passed.

## Active risks

- Cline Windows hook documentation and current `.ps1` discovery behavior are inconsistent; Segment 01 needs fixtures and a capability-oriented installer design.
- Cursor may ignore `ask` in some Auto-review configurations; `deny` remains the reliable enforcement path.
- Exact local Ollama System One compatibility will be tested in Segment 04 rather than assumed.