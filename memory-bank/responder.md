# Responder (Segment 07)

## Scope and isolation

Implementation is isolated to:

- `src/responder/`
- `src/cli/respond.ts`
- `test/responder.test.ts`
- this document

No Engine or shared store/schema code is modified by this branch.

## Deterministic architecture

The deterministic functions are authoritative and require no API key:

1. `investigateIncident()` reads the shared SQLite ledger.
2. It traces `trust_origins` from the affected session back to the first recorded session.
3. It reads actions/decisions, tainted files, vault grants, and run tickets for that chain.
4. Only `vault_grants` for the affected session count as real credential exposure. Placeholders and run tickets alone do not count.
5. `rotateExposedKeys()` rotates only exposed keys and verifies the old credential is rejected.
6. `repairTaintedFiles()` restores snapshot-backed files or quarantines attacker-created files only when their current hash still matches the last exact recorded attack write.
7. Files changed after the attack, files without an exact expected hash, or missing snapshots are left untouched and flagged for review.
8. `writeIncidentReport()` writes a concise Markdown report with agent attribution, exposure, recovery, and closure state.

## Idempotency

Responder state is stored as non-secret JSON under:

```text
.warden/incidents/response_<session>.json
```

- Rotation receipts are persisted immediately after provider rotation and before verification.
- A rerun never rotates a key twice; it re-verifies the old credential using the saved receipt.
- Restored/quarantined files are recorded and independently revalidated on rerun; changed, missing, or recreated files reopen the incident for review.
- Incident closure requires every supported exposed key to have a rejected old credential and no file requiring review.

No secret values are written to responder state or reports.

## Mock providers

`providers.ts` defines a small `KeyProvider` interface and mock npm/GitHub providers. Real provider adapters can replace them later without changing the runbook.

## Two restricted Cline SDK sessions

The optional SDK flow runs two separate `Agent` sessions:

### Investigator

Tools:

- `read_incident_chain`
- `submit_investigation`

The session has read-only access to the precomputed ledger investigation. It has no shell, filesystem, web, MCP, or arbitrary SQL tools.

### Responder

Tools:

- `read_response_plan`
- `rotate_exposed_keys`
- `repair_tainted_files`
- `write_incident_report`
- `submit_response`

These tools call the same deterministic bounded functions. No built-in ClineCore tools are provided.

The SDK is loaded dynamically only when credentials are present and deterministic mode is not requested. Tests use a fake runner and make no API calls.

## CLI

Standalone command file:

```text
tsx src/cli/respond.ts --session <id> --trigger "<why>" [--deterministic]
```

Behavior:

- `--deterministic` always uses the offline runbook.
- With no responder/Anthropic API key, it automatically falls back to deterministic mode.
- With `WARDEN_RESPONDER_API_KEY` or `ANTHROPIC_API_KEY`, it runs investigator and responder SDK sessions, then deterministically guarantees all steps complete.
- Exit code `0` means closed; exit code `2` means the incident remains open.

The shared root CLI still needs a future dispatcher entry for `warden respond`; this branch intentionally adds only the standalone command file.

## Schema decision

No new table is required for the MVP. Idempotency uses the responder-owned state file.

If queryable responder state is added later, reserve append-only schema migration **v6**. Migration v5 belongs to parallel work. Do not edit earlier migrations.

## Known limitations / later integration

- Real npm/GitHub rotation providers are mocked.
- Exact post-attack edit detection is available only when the ledger contains an exact full-write content hash. Patch/shell/dynamic writes are conservatively flagged for review.
- Investigator and report now include persisted, redacted `sandbox_runs` evidence for the traced session chain.
- Root `warden respond` dispatch and dashboard deterministic response callback are integrated.
- The responder should eventually be exercised by the full offline demo.
- `@cline/sdk@0.0.90` currently has declaration incompatibilities with strict NodeNext, so the runtime adapter is isolated behind a locally typed dynamic import rather than weakening `tsconfig`.
- Installing the current SDK adds transitive audit findings (32 total at implementation time: 14 high, 13 moderate, 5 low). No direct vulnerable API is used in deterministic mode, but production use should update once the SDK publishes remediated dependencies.