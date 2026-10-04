import { ASK_BUDGET, BLOCK_BUDGET } from "../src/policy/risk.js";

export interface Capability {
  id: string;
  title: string;
  layer: "Observe" | "Decide" | "Protect" | "Recover" | "Operate";
  icon: string;
  tagline: string;
  features: string[];
  flow: string[];
  boundary: string;
  implementation: string;
  tests: string[];
  replayStatuses: string[];
}

/** Source-backed feature descriptions, not a live health check or a test-results feed. */
export const capabilities: Capability[] = [
  { id: "hooks", title: "Agent hooks", layer: "Observe", icon: "⌘", tagline: "One security contract across Cline and Cursor.",
    features: ["Pre-tool permission checks and post-tool observations", "Read, write, exec, network, MCP and prompt normalization", "Host-specific Cline cancel and Cursor deny responses", "User intent captured from prompts and task start"],
    flow: ["Cline / Cursor tool call", "Normalize AgentAction", "Engine decision", "Host allow or deny"],
    boundary: "Hook discovery and enablement depend on the editor. Warden hook failures fail open; Cline cancellation can abort the task. No automatic OpenDots runtime integration.",
    implementation: "src/adapters/ · src/hooks/", tests: ["test/cline-adapter.test.ts", "test/cursor-adapter.test.ts", "test/hooks.test.ts"], replayStatuses: [] },
  { id: "guardrails", title: "Deterministic guardrails", layer: "Decide", icon: "⊣", tagline: "Fixed rules before a model has a say.",
    features: ["Control-file writes and destructive actions require approval", "Secret reads require approval unless vault-seeded and fully canaried", "Warden state and hook tampering is blocked", "Remote execution, untrusted execution and egress are sandboxed or blocked"],
    flow: ["Action + canonical paths", "Match fixed rules", "Strictest finding wins", "Allow / ask / sandbox / block"],
    boundary: "Shell matching is lexical, not a complete interpreter. Variables, encoded code and internal script writes need additional isolation and observation.",
    implementation: "src/policy/guardrails.ts · pathRules.ts · commandRules.ts", tests: ["test/guardrails-control.test.ts", "test/guardrails-risk.test.ts", "test/guardrails-quiet.test.ts"], replayStatuses: ["HOLD", "BLOCK"] },
  { id: "trust", title: "Cross-agent trust memory", layer: "Observe", icon: "↳", tagline: "The attack remembers. So does Warden.",
    features: ["External tool results conservatively taint sessions", "Injection observations are classified and hashed, not stored raw", "Tainted file reads propagate provenance to later agents", "First pre-taint snapshots preserve the original baseline"],
    flow: ["Poisoned issue → Cursor", "Tainted AGENTS.md", "Next-day Cline read", "Inherited untrusted execution"],
    boundary: "Result-observation hooks must be installed. Session taint is sticky; trusted edits do not clear it. Dynamic file access can exceed current visibility.",
    implementation: "src/core/trust.ts · src/core/engine.ts", tests: ["test/trust.test.ts", "test/install.test.ts"], replayStatuses: ["FLAG"] },
  { id: "risk", title: "Cumulative risk scoring", layer: "Decide", icon: "∑", tagline: "Small suspicious steps add up.",
    features: ["Four questions: injection, secrets, destruction and off-intent", "Noisy-OR combines probabilities into action risk", "Weighted cumulative session budget; concurrent updates serialized", "Configured Cloudflare CLEF → heuristic fallback; local Ollama only with explicit opt-in and no Cloudflare"],
    flow: ["Four question scores", "p = 1 − ∏(1 − q)", "Budget += −ln(1 − p)", "Ask ≥ 1.2 / block ≥ 2.3"],
    boundary: "Heuristic scores are not calibrated probabilities. Cloudflare is structural-only by default; explicit safe-state opt-in sends a gated excerpt. Cloudflare p ≤ 0.30 adds no budget. Reads weigh 0.2× and do not budget-block. This viewer uses no live model; the risk lab illustrates the base formula, not backend-specific adjustments.",
    implementation: "src/policy/risk.ts · src/config/environment.ts", tests: ["test/risk.test.ts", "test/clef-cli.test.ts", "test/environment.test.ts"], replayStatuses: ["CLEF"] },
  { id: "vault", title: "Secret vault & canaries", layer: "Protect", icon: "◇", tagline: "Keep real values out of agent-readable files.",
    features: ["OS-keychain-backed secret values; SQLite stores metadata", "Seed environment files with detectable canary placeholders", "Outbound canaries block exec, network, writes and MCP", "Vault listing exposes names, not secret values"],
    flow: ["Environment values", "OS keychain vault", "Canaries in workspace", "Outbound canary → block"],
    boundary: "Native keychain requires environment verification. The offline demo uses MemorySecretStore and fake credentials. Canary detection is not a universal data-loss-prevention system.",
    implementation: "src/vault/secrets.ts · src/vault/canary.ts", tests: ["test/vault.test.ts", "test/engine.test.ts"], replayStatuses: [] },
  { id: "tickets", title: "Scoped secret injection", layer: "Protect", icon: "⌁", tagline: "A secret goes to one approved child, not the agent.",
    features: ["warden run consumes a single-use ticket", "Ticket bound to session, exact argv and key selection", "30-second expiry; reuse, mismatch and ambiguity fail closed", "Secret exposure grant recorded when the child actually spawns"],
    flow: ["Allowed warden run", "Issue exact-command ticket", "Consume once", "Selected keys → child only"],
    boundary: "This is scoped credential delivery, not credential rotation. The demo uses a mock child and fake NPM_TOKEN; the command shown is not run against npm.",
    implementation: "src/vault/secrets.ts · src/cli/args.ts · src/cli/warden.ts", tests: ["test/vault.test.ts", "test/cli.test.ts"], replayStatuses: [] },
  { id: "sandbox", title: "Docker shadow sandbox", layer: "Protect", icon: "▣", tagline: "Inspect behavior before real execution.",
    features: ["Execute in a sanitized temporary workspace copy", "No network, dropped capabilities and no-new-privileges", "PID, memory, CPU and execution-time limits; cached image only", "Detect changed files, control writes, canaries and network attempts"],
    flow: ["Copy + sanitize workspace", "Isolated Docker execution", "Collect behavioral evidence", "Block unsafe real execution"],
    boundary: "Docker requires a daemon and cached secret-free image. Static fallback cannot certify executable code and blocks unverified execution. Shadow allow continues the remaining engine checks.",
    implementation: "src/sandbox/shadow.ts", tests: ["test/docker-sandbox.test.ts", "test/sandbox.test.ts"], replayStatuses: ["SANDBOX", "BLOCK"] },
  { id: "approvals", title: "Human approval handoff", layer: "Decide", icon: "✓", tagline: "Sensitive decisions belong to a person.",
    features: ["Persist pending ask before waiting for a decision", "Per-process token and matching browser origin", "Single-use approval; expired or duplicate clicks rejected", "No dashboard, timeout or denial → block"],
    flow: ["Sensitive action → ask", "Local dashboard review", "Approve / deny / expire", "Finalize original decision"],
    boundary: "Approval waits up to 20 seconds. The attack replay uses a labeled demo-only approval callback; this capabilities viewer cannot approve real actions.",
    implementation: "src/dashboard/approval.ts · src/dashboard/server.ts", tests: ["test/dashboard.test.ts", "test/integration-loop.test.ts"], replayStatuses: ["HOLD", "APPROVE"] },
  { id: "ledger", title: "Ledger & live dashboard", layer: "Observe", icon: "≡", tagline: "Explain the decision, preserve the chain.",
    features: ["Repository-local SQLite ledger shared across agents", "Actions, verdicts, provenance, scoring backend and session budgets", "Redacted sandbox evidence linked to action and decision", "Operational dashboard shows approvals, incidents and response reports"],
    flow: ["Engine decision", "Redacted SQLite record", "Provenance + evidence", "Local operational dashboard"],
    boundary: "Demo Studio is a replay/explanation view, not the operational dashboard. Local security does not defend against a hostile local process with workspace access.",
    implementation: "src/store/ · src/dashboard/ · src/cli/status.ts · src/cli/score.ts", tests: ["test/store.test.ts", "test/sandbox-ledger.test.ts", "test/dashboard.test.ts"], replayStatuses: [] },
  { id: "response", title: "Incident investigation & repair", layer: "Recover", icon: "↺", tagline: "Trace exposure. Repair only what was affected.",
    features: ["Trace cross-session provenance and actual vault grants", "Rotate supported exposed keys and verify old-key rejection", "Restore snapshot-backed files; quarantine attacker-created files", "Idempotent recovery; later edits retained for review; report closure checks"],
    flow: ["Investigate ledger chain", "Verify exposed-key rotation", "Restore / quarantine", "Close only if checks pass"],
    boundary: "Real rotation providers are not configured: real exposed keys remain OPEN. Replay rotation is mock-backed. Optional restricted Cline SDK sessions require separate installation and audit.",
    implementation: "src/responder/ · src/cli/respond.ts", tests: ["test/responder.test.ts", "test/integration-loop.test.ts", "test/demo.test.ts"], replayStatuses: ["FIND", "ROTATE", "RESTORE", "QUARANTINE", "CLOSED"] },
  { id: "review", title: "Explicit trust review", layer: "Recover", icon: "◎", tagline: "Recovery does not silently erase provenance.",
    features: ["Interactive local confirmation required", "Original files must match the pre-taint snapshot exactly", "Attacker-created files must be absent after quarantine", "Only reviewed file taint clears; session taint remains"],
    flow: ["Repaired file", "Human typed confirmation", "Verify baseline or absence", "Clear file taint only"],
    boundary: "Unsafe paths, symlinks, missing snapshots and later edits retain taint. No automatic reset of session trust.",
    implementation: "src/core/review.ts · src/cli/warden.ts", tests: ["test/review.test.ts"], replayStatuses: [] },
  { id: "install", title: "Install, diagnose & uninstall", layer: "Operate", icon: "⚙", tagline: "Protect a repository without owning its configuration.",
    features: ["warden init installs platform-specific Cline/Cursor wrappers", "Existing user hooks preserved; repeat installs are safe", "warden doctor checks launcher, hooks, config and ignore state", "Hash/ownership-checked uninstall preserves modified or user-owned hooks"],
    flow: ["Preflight runtime", "Install owned hooks", "Doctor verification", "Safe uninstall"],
    boundary: "Host enablement still needs manual verification. Uninstall preserves ledger/incident state and does not delete keychain secrets. No hosted control plane or automatic runtime protection.",
    implementation: "src/install/init.ts · bin/", tests: ["test/install.test.ts"], replayStatuses: [] },
];

export const capabilityCatalog = {
  kind: "source-backed-explanation" as const,
  capabilities,
  risk: { ask: ASK_BUDGET, block: BLOCK_BUDGET, cap: 0.95, readWeight: 0.2 },
  pipeline: ["hooks", "trust", "guardrails", "sandbox", "vault", "risk", "ledger", "approvals", "tickets"],
};