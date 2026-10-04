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

## Engine and policy (Segment 02)

```text
src/core/engine.ts       Engine(store, {workspaceRoot, stages}).decide(action): Promise<Decision>
src/policy/guardrails.ts GuardrailStage(action, PolicyContext) -> Finding[]
src/policy/targets.ts    pathKey() canonicalization + shellSegments() light tokenizer
src/policy/pathRules.ts  control / secret / Warden path classifiers
src/policy/commandRules.ts destructive / remote-exec / egress / Warden CLI classifiers
src/store/schema.ts      migrations[] + migrate() (PRAGMA user_version)
```

- Stages are plain functions in `EngineStages`; tests pass `stages: {guardrails: fake}`. Later segments add stages to the same interface.
- Stages never pick the verdict. `combine(findings)` applies block > ask > sandbox > allow, joins top reasons, and unions labels.
- `PolicyContext` gives stages read-only workspace facts (`isCanariedEnv`), so policy modules don't touch SQL.
- Rule details: `guardrails.md`.

## Boundaries

- Adapters validate host input, normalize it, and translate the final verdict.
- Policy modules return small results and labels; they do not write host-specific responses.
- The store owns SQL and transactions.
- Real secrets are referenced by keychain identifiers and never persisted in SQLite.
- The responder runbook is deterministic; an SDK agent may invoke it but does not redefine it.
- Secret storage is abstracted behind `SecretStore`; production uses the OS keychain and tests use memory.
- SQLite stores vault names, canaries, source paths, and session grants, never real secret values.
- `warden run` integration will call the vault's child-process launcher so secrets never enter the parent process environment.
- Allowed `warden run` actions create a 30-second single-use ticket bound to session ID, exact child argv, and exact key selection.
- The CLI consumes the ticket atomically; missing, expired, reused, mismatched, or ambiguous tickets fail closed.
- Canary presence in outbound exec, net, write, or MCP content is an unconditional engine block before any run ticket is issued.

## Sandbox layer (Segment 06)

```text
Guardrails request sandbox -> shadowRun -> static evidence
                                      -> optional Docker evidence
                                      -> allow/block recommendation
```

- The sandbox never decides which actions should be sandboxed; Guardrails and Engine own that decision.
- Static inspection always runs and is the complete offline fallback.
- Docker receives a sanitized temporary copy, never the original repository or real vault values.
- Docker is used only with a responsive daemon and an already-cached image whose declared environment has no secret-like names.
- Static and runtime evidence are combined; Docker success cannot erase a static secret or network finding.
- The result callback is the persistence boundary until shared sandbox ledger wiring is added.

## Trust tracking (Segment 03)

- Post-result hooks observe actual external output, hash it for audit, and flag injection-like patterns. They never block. Any successful external result taints its session regardless of classifier result.
- `trust_origins` holds sticky first exposure; `tainted_files` holds first writer and baseline snapshot; reads propagate reason chains across agents/days.
- Allowed tainted writes capture a pre-write baseline once under `.warden/snapshots/`. Trusted edits preserve existing taint; explicit review and trust reset are future work.
- Engine calls sandbox only for guardrail sandbox requests when no higher-priority finding exists. An allow proceeds through the remaining decision path, not an unconditional policy bypass.

### Engine integration contract (implemented)

```text
trust result
  -> guardrail result
     -> guardrail sandbox? shadowRun(workspaceRoot, action) : skip
        -> sandbox block: final block candidate
        -> sandbox allow: continue engine pipeline
  -> vault canary scan
  -> risk/session budget
  -> provenance
  -> approval
  -> persist one final Decision plus redacted sandbox evidence summary
```

- `Engine` receives `workspaceRoot` separately from `AgentAction`; action paths and commands are untrusted inputs, not repository identity.
- Injectable `stages.sandbox` and `stages.risk` let tests run without Docker or model network calls.
- Guardrails select `sandbox`; the sandbox returns only `allow` or `block` evidence. It must not implement trust, risk, or approval policy.
- A sandbox allow means “safe enough to continue evaluation,” not “execute unconditionally.”
- A sandbox block reason and labels participate in the same final decision composition as other engine stages.
- Persist sandbox evidence through the store after an action row exists; the sandbox module does not own SQLite.
- Implemented: schema v5 `sandbox_runs` records a redacted summary linked to `action_id` and `decision_id`, without raw stdout/script content.

## Risk layer (Segment 04)

- `src/policy/risk.ts` provides typed CLEF noul questions, noisy-OR probability, weighted budget increment, and short-timeout Ollama/Cloudflare/offline heuristic scoring; details and sources: `riskScoring.md`.
- Engine scores only non-post, non-prompt actions without higher-priority findings; reads count 0.2x and never block solely on risk. A generic budget reason is hidden by more specific findings.
- Store persists `sessions.risk_budget` increments, `decisions.risk_latency_ms`, and the existing question/backend fields. Inference failure falls back to heuristic rather than failing open with an empty risk score.

## Install layer (Segment 08B)

```text
warden init
  -> preflight hook launcher / tsx / Cursor JSON
  -> optional vault seed
  -> create unoccupied Cline wrappers
  -> create owned Cursor wrappers
  -> merge Cursor hook entries
  -> ensure .warden/ is ignored
  -> write .warden/install.json ownership manifest
```

- Cline exposes fixed event filenames. Existing files are preserved and reported; Warden never overwrites or automatically chains them.
- Cursor supports hook arrays, so Warden appends exact repository-relative wrapper commands without replacing existing entries.
- The manifest is bookkeeping, not authority: uninstall derives removable paths from fixed supported events and requires recorded hashes to match.
- Cursor uninstall removes one owned matching entry, preserving identical duplicates added later.
- Modified managed files survive repeat init and uninstall.
- Install and doctor preflight the source-checkout `tsx` loader before writing hooks.
- Optional `.env` seeding delegates to `SecretVault` before hook/config changes.

## Reliability patterns

- Hook boundary catches failures and returns host-specific allow output.
- Approval timeout is a policy result and returns deny.
- Optional services use short timeouts and deterministic fallbacks.
- Paths retain an original representation for logs and a canonical slash-separated representation for matching.
- Tests use temporary or in-memory state and require no network or credentials.
- Vault seeding resolves real paths and refuses environment files outside the protected repository.
- Real values are read after ticket consumption and passed only in the child environment; SQLite stores key names only.
- Exposure grants are recorded on the child `spawn` event, not before process creation succeeds.
- Sandbox temporary directories are removed in `finally`; named containers receive repeated forced cleanup attempts.
- Scripts outside the protected repository, timeouts, and Docker execution failures fail closed.
- Installer tests use only OS temporary repositories; automated tests never initialize the Warden development repository.