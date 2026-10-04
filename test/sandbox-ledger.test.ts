import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { Engine } from "../src/core/engine.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

test("sandbox summary is redacted, linked to action and decision, and migration v5 survives reopen", async () => {
  const root = tempWorkspace();
  const filename = path.join(root, "warden.db");
  const store = new WardenStore(filename);
  try {
    const engine = new Engine(store, { workspaceRoot: root, stages: {
      guardrails: () => [{ verdict: "sandbox", label: "test", reason: "inspect" }],
      sandbox: () => ({ verdict: "block", reason: "network access to https://example.invalid/private?token=real-secret", evidence: {
        backend: "static", inspectedFiles: ["setup.sh", "https://example.invalid/private?token=real-secret"], changedFiles: ["AGENTS.md"],
        secretFiles: [".env"], canaries: ["__WARDEN_CANARY__NPM_TOKEN__0123456789abcdef01234567__"],
        networkAttempts: ["https://example.invalid/private?token=real-secret"], controlFiles: ["AGENTS.md"],
        tokenReferences: ["real-secret"], obfuscation: [], outsideWorkspace: [], exitCode: 1,
        timedOut: false, executionError: null, labels: ["sandbox:network"],
      } }),
    } });
    const result = await engine.decide({ source: "replay", sessionId: "s", agent: "test", kind: "exec", tool: "shell",
      target: "sh setup.sh", content: "sh setup.sh", untrustedInput: false, userIntent: "test" });
    assert.equal(result.verdict, "block");
    const row = store.database.prepare("SELECT s.*, d.id AS linked FROM sandbox_runs s JOIN decisions d ON d.id = s.decision_id WHERE d.verdict = 'block'").get()!;
    assert.equal(row.backend, "static");
    assert.equal(row.canaries_count, 1);
    assert.deepEqual(JSON.parse(String(row.inspected_files_json)), ["setup.sh", "[REDACTED]"]);
    assert.deepEqual(JSON.parse(String(row.changed_files_json)), ["AGENTS.md"]);
    assert.deepEqual(JSON.parse(String(row.secret_files_json)), [".env"]);
    assert.equal(row.action_id, store.database.prepare("SELECT id FROM actions LIMIT 1").get()?.id);
    assert.ok(Number(row.duration_ms) >= 0);
    assert.ok(!JSON.stringify(row).includes("real-secret"));
    store.close();
    const reopened = new WardenStore(filename);
    assert.equal(reopened.database.prepare("SELECT COUNT(*) AS n FROM sandbox_runs").get()?.n, 1);
    assert.equal(reopened.database.prepare("PRAGMA user_version").get()?.user_version, 5);
    reopened.close();
  } finally { if (store.database.isOpen) store.close(); rmSync(root, { recursive: true, force: true }); }
});