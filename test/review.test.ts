import assert from "node:assert/strict";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { reviewRestoredFile } from "../src/core/review.js";
import { WardenStore } from "../src/store/database.js";
import { tempWorkspace } from "./helpers.js";

test("review clears file taint only when the original snapshot is restored; session stays untrusted", () => {
  const root = tempWorkspace();
  const store = new WardenStore(path.join(root, ".warden", "warden.db"));
  try {
    store.record({ source: "cursor", sessionId: "attacker", agent: "cursor", kind: "write", tool: "write",
      target: "AGENTS.md", content: "injected", untrustedInput: true, userIntent: "" }, {
      verdict: "allow", reason: "test", labels: [], risk: { actionProbability: 0, sessionBudget: 0, backend: "none",
        questions: { injection: 0, secrets: 0, destructive: 0, offIntent: 0 } },
    });
    const original = path.join(root, "AGENTS.md");
    writeFileSync(original, "trusted baseline\n");
    const snapshot = path.join(root, ".warden", "snapshots", "baseline");
    mkdirSync(path.dirname(snapshot), { recursive: true });
    writeFileSync(snapshot, "trusted baseline\n");
    store.markFile("agents.md", "attacker", "external issue", snapshot, true);
    writeFileSync(original, "injected\n");
    assert.throws(() => reviewRestoredFile(store, root, "AGENTS.md"), /differs/);
    assert.ok(store.fileOrigin("agents.md"));
    writeFileSync(original, "trusted baseline\n");
    assert.equal(reviewRestoredFile(store, root, "AGENTS.md"), "agents.md");
    assert.equal(store.fileOrigin("agents.md"), null);
    assert.equal(store.database.prepare("SELECT untrusted FROM sessions WHERE session_id='attacker'").get()?.untrusted, 1);
    store.markFile("new.txt", "attacker", "external issue", null, false);
    writeFileSync(path.join(root, "new.txt"), "injected");
    assert.throws(() => reviewRestoredFile(store, root, "new.txt"), /still exists/);
    rmSync(path.join(root, "new.txt"));
    assert.equal(existsSync(path.join(root, "new.txt")), false);
    assert.equal(reviewRestoredFile(store, root, "new.txt"), "new.txt");
  } finally { store.close(); rmSync(root, { recursive: true, force: true }); }
});