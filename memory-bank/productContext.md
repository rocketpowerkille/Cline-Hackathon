# Product Context

## Why Warden exists

Coding agents consume untrusted text and then act with developer credentials and shell access. A malicious instruction can be split across apparently normal actions and persist in files that later agents trust. Per-call checks miss this chain because no single step necessarily looks malicious.

## Problem solved

Warden adds memory and response to agent security:

- Trust follows untrusted inputs into sessions and files.
- Taint crosses agent and session boundaries.
- Small risks accumulate in a session budget.
- Secret canaries expose attempted leakage.
- Risky commands are shadow-run before touching the real workspace.
- The responder determines actual exposure and repairs only affected resources.

## Intended experience

- Installation is one command.
- Normal work stays quiet and fast.
- Decisions have short reasons suitable for a live demo.
- Sensitive actions ask for one-click approval when the dashboard is available.
- Warden failures do not brick the coding agent.
- Approval timeouts deny the action.
- The full demo works offline with fake credentials and deterministic providers.

## Demo story

Without Warden, a poisoned issue leads to a token reaching a local mock attacker. With Warden, the session becomes untrusted, control-file persistence requires approval, execution is sandboxed, secret/network behavior is blocked, and the responder rotates the exposed mock key, restores files, quarantines additions, and writes an incident report.