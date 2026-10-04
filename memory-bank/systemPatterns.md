# System Patterns

## Primary flow

```text
agent hook -> adapter -> AgentAction -> Engine.decide -> Decision -> adapter response
                                      -> shared SQLite ledger
```

## Engine order

1. Trust tracking
2. Guardrails
3. Sandbox when requested by a guardrail
4. Vault canary scan
5. Risk score and session budget
6. Write provenance
7. Human approval resolution
8. Decision persistence

Only the engine combines stage results or changes verdict precedence.

## Hook layer (Segment 01)

```text
src/hooks/main.ts  (stdin bytes -> decodeHookInput -> runHook -> stdout JSON, exit 0)
src/hooks/run.ts   (adapter.eventName -> adapter.normalize -> EngineFactory(root).decide -> adapter.respond)
src/adapters/{common,cline,cursor}.ts
```

- `HostAdapter.normalize` returns `{action | null, workspaceRoot}`; `null` skips the engine and returns host allow.
- `HostAdapter.respond(event, null)` is the fail-open output; it is always valid host JSON.
- `EngineFactory` is injectable so tests can produce non-allow verdicts without real policy.
- Host contract details live in `hookContracts.md`.

## Boundaries

- Adapters validate host input, normalize it, and translate the final verdict.
- Policy modules return small results and labels; they do not write host-specific responses.
- The store owns SQL and transactions.
- Real secrets are referenced by keychain identifiers and never persisted in SQLite.
- The responder runbook is deterministic; an SDK agent may invoke it but does not redefine it.
- Secret storage is abstracted behind `SecretStore`; production uses the OS keychain and tests use memory.
- SQLite stores vault names, canaries, source paths, and session grants, never real secret values.
- `warden run` integration will call the vault's child-process launcher so secrets never enter the parent process environment.

## Reliability patterns

- Hook boundary catches failures and returns host-specific allow output.
- Approval timeout is a policy result and returns deny.
- Optional services use short timeouts and deterministic fallbacks.
- Paths retain an original representation for logs and a canonical slash-separated representation for matching.
- Tests use temporary or in-memory state and require no network or credentials.
- Vault seeding resolves real paths and refuses environment files outside the protected repository.