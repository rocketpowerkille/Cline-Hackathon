import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { runDemo } from "../demo/run-demo.js";

test("demo proves the leak, blocks it, and rotates/restores/quarantines offline", async () => {
  const result = await runDemo({ color: false, print: () => {}, forceNodeFallback: true });
  try {
    assert.deepEqual(result.unprotectedReceipts, ["npm_demo_FAKE_TOKEN_not_real_12345"]);
    assert.deepEqual(result.protectedReceipts, []);
    assert.deepEqual(result.riskBackends, ["heuristic"]);
    assert.ok(result.trace.some((line) => line.startsWith("HOLD")));
    assert.ok(result.trace.some((line) => line.startsWith("BLOCK")));
    assert.deepEqual(result.recovery.exposedKeys, ["NPM_TOKEN"]);
    assert.equal(result.recovery.rotationCount, 1);
    assert.equal(result.recovery.oldRejected, true);
    assert.equal(result.recovery.agentsRestored, true);
    assert.equal(result.recovery.setupQuarantined, true);
    assert.equal(result.recovery.closed, true);
    assert.match(result.recovery.report, /Sandbox evidence[\s\S]*scripts\/setup\.sh/);
    assert.match(result.recovery.reportPath, /incident_[^\\/]+\.md$/);
    assert.equal(readFileSync(path.join(result.protectedRoot, "AGENTS.md"), "utf8"), "# Agent notes\nKeep setup instructions here.\n");
    assert.equal(existsSync(path.join(result.protectedRoot, "scripts", "setup.sh")), false);
    assert.equal(existsSync(result.recovery.reportPath), true);
    assert.match(readFileSync(result.recovery.reportPath, "utf8"), /NPM_TOKEN.*old credential is rejected/);
    assert.match(result.recovery.report, /scripts\/setup\.sh.*quarantined/i);
    assert.ok(result.trace.some((line) => line.startsWith("ROTATE") && line.includes("old key rejected")));
    assert.ok(result.trace.some((line) => line.startsWith("QUARANTINE")));
    assert.ok(result.trace.every((line) => /R=\d+\.\d\d/.test(line)), "every trace line must show a risk budget");
    assert.ok(result.trace.every((line) => line.length < 125), "projector trace must stay short");
    assert.ok(result.trace.some((line) => line.includes("AGENTS.md")));
    assert.ok(result.trace.some((line) => line.includes("GitHub issue #42")));
    assert.ok(!result.trace.some((line) => line.includes("get_issue github/get_issue")));
    assert.match(result.replayFile, /replay-actions\.json$/);
  } finally {
    rmSync(result.protectedRoot, { recursive: true, force: true });
  }
});