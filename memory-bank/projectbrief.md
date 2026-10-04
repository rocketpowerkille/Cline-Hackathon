# Warden Project Brief

Warden is local detection and response for AI coding agents. It sits in front of agent tool calls, follows trust and risk across actions, sessions, agents, and days, and repairs damage when prevention is insufficient.

## Core goal

Demonstrate and stop a Clinejection-style chain: a poisoned issue influences one agent to write persistent instructions and a setup script; another session trusts those files and executes the script; the script attempts to exfiltrate an npm token.

## Required behavior

- Normalize Cline, Cursor, and replay actions into one `AgentAction` contract.
- Make every policy decision through `Engine.decide()`.
- Combine trust, fixed guardrails, sandbox evidence, vault canaries, cumulative risk, write provenance, and human approval in the specified order.
- Store the shared ledger in `.warden/warden.db` inside the protected repository.
- Fail open when Warden itself fails; fail closed when an approval expires.
- Work offline and on Windows 11 without breaking macOS or Linux.
- Keep real secrets out of agent-readable files and Warden logs.
- Recover by rotating exposed keys, reverting tainted edits, quarantining newly created files, and writing an incident report.

## MVP segments

1. Agent Hooks
2. Guardrails
3. Trust Tracking
4. Risk Scoring
5. Secret Vault
6. Sandbox
7. Cline Responder
8. Dashboard + Install

## Scope boundary

Not in the MVP: hosted control plane, team policies, shared immunity, scheduled red-team runs, or adapters for Claude Code, Copilot, and OpenClaw. The normalized action contract must not prevent adding those later.

## Success criteria

- `npm test` and `npm run typecheck` pass without credentials.
- The demo first proves the attack works without Warden, then proves Warden blocks exfiltration and completes deterministic recovery.
- A fresh repository can be protected with `warden init`.
- Files and explanations stay small, direct, and dependency-light.