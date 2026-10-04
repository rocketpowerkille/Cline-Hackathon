import { Engine } from "../../src/core/engine.js";
import { WardenStore } from "../../src/store/database.js";

const [database, root, session] = process.argv.slice(2);
if (!database || !root || !session) throw new Error("risk-worker requires database, root and session");
const store = new WardenStore(database);
try {
  const engine = new Engine(store, { workspaceRoot: root,
    approval: async () => ({ id: null, status: "denied", reason: "test denied" }),
    stages: { risk: async () => ({ backend: "heuristic", actionProbability: 0.6,
      questions: { injection: 0.6, secrets: 0, destructive: 0, offIntent: 0 }, sessionBudget: 0 }) } });
  const decision = await engine.decide({ source: "replay", sessionId: session, agent: "worker", kind: "write",
    tool: "write_to_file", target: `${process.pid}.txt`, content: "safe", untrustedInput: false, userIntent: "test" });
  process.stdout.write(JSON.stringify({ verdict: decision.verdict, budget: decision.risk.sessionBudget }));
} finally { store.close(); }