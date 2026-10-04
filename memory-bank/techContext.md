# Technical Context

## Stack

- TypeScript with strict checking
- Node.js 22.13 or newer
- ECMAScript modules
- `tsx` for execution and tests
- Built-in `node:sqlite` with `DatabaseSync`
- Built-in `node:test`

## Dependency policy

Approved runtime dependencies, added only when needed:

- `@napi-rs/keyring` for the OS keychain
- `@cline/sdk` for the optional responder agent

Approved development dependencies:

- `tsx`
- `typescript`
- `@types/node`

Ask before adding anything else.

## Platform requirements

- Primary environment: Windows 11 and PowerShell.
- Use `.ps1` wrappers where supported on Windows.
- Keep path matching portable across backslashes, forward slashes, and Windows case folding.
- Do not require Docker; it is an optional sandbox backend.

## State

All protected-repository state lives under `.warden/`:

```text
.warden/warden.db
.warden/incidents/
.warden/quarantine/
```

## Commands

```text
npm.cmd test
npm.cmd run typecheck
```

On systems where PowerShell execution policy does not shadow npm, normal `npm` commands work.

## Optional integrations

- Ollama CLEF/System One
- Cloudflare Workers AI CLEF
- Docker sandbox
- Cline SDK responder
- Anthropic-compatible responder credentials

Every optional integration requires an offline fallback.

## Vault implementation

- `@napi-rs/keyring` 2.1.0 is installed as a runtime dependency.
- Production storage uses synchronous `Entry(service, account)` operations.
- Tests use `MemorySecretStore`; they do not access Windows Credential Manager, macOS Keychain, or Linux credential stores.
- Vault metadata is stored in `vault_entries` and `vault_grants` tables created by the isolated module until shared-schema integration.