import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseDemoArgs, runDemo } from "../demo/run-demo.js";
import { readDashboard } from "../src/dashboard/data.js";

test("demo proves the leak, blocks it, and rotates/restores/quarantines offline", async () => {
  const output: string[] = [];
  const result = await runDemo({ color: false, print: (line) => output.push(line), forceNodeFallback: true });
  try {
    assert.deepEqual(result.unprotectedReceipts, ["npm_demo_FAKE_TOKEN_not_real_12345"]);
    assert.deepEqual(result.protectedReceipts, []);
    assert.deepEqual(result.riskBackends, ["heuristic"]);
    assert.equal(result.trace.filter((line) => line.startsWith("CLEF")).length, 1);
    assert.ok(result.trace.some((line) => line.startsWith("CLEF") && line.includes("NOT USED — offline heuristic")));
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
    assert.ok(result.trace.some((line) => /R\[cursor\]=\d+\.\d\d/.test(line)));
    assert.ok(result.trace.some((line) => /R\[cline\]=\d+\.\d\d/.test(line)));
    assert.ok(!result.trace.some((line) => /hidden instruction; none|demo-only approval/.test(line)));
    assert.ok(result.trace.filter((line) => line.includes("RESPONDER")).every((line) => line.indexOf("RESPONDER") === 11));
    assert.ok(result.trace.every((line) => line.length < 125), "projector trace must stay short");
    assert.ok(result.trace.some((line) => line.includes("AGENTS.md")));
    assert.ok(result.trace.some((line) => line.includes("GitHub issue #42")));
    assert.ok(!result.trace.some((line) => line.includes("get_issue github/get_issue")));
    const headings = output.filter((line) => line.startsWith("STATUS"));
    assert.equal(headings.length, 3);
    assert.ok(headings.every((line) => /STATUS\s+ACTOR\s+ACTION\s+RISK\s+DETAIL/.test(line)));
    assert.ok(result.trace.find((line) => line.startsWith("QUARANTINE"))?.includes(" RESPONDER  scripts/setup.sh"));
    assert.match(result.replayFile, /replay-actions\.json$/);
  } finally {
    rmSync(result.protectedRoot, { recursive: true, force: true });
  }
});

test("demo presenter flags validate pacing and reject unknown options", () => {
  assert.deepEqual(parseDemoArgs(["--step", "--dashboard"]), { step: true, dashboard: true, lineDelayMs: 400 });
  assert.deepEqual(parseDemoArgs(["--delay", "0", "--step"]), { step: true, lineDelayMs: 0 });
  for (const args of [["--delay"], ["--delay", "-1"], ["--delay", "5001"], ["--other"]]) assert.throws(() => parseDemoArgs(args));
});

test("dashboard demo uses real approval endpoints and keeps recovered report available", async () => {
  let timer: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const choices: string[] = [];
  const pauses: string[] = [];
  const result = await runDemo({ color: false, print: () => {}, dashboard: true, step: true, lineDelayMs: 1,
    forceNodeFallback: true, pause: async (message) => { pauses.push(message); },
    onDashboardReady(server, root) {
      const { token } = JSON.parse(readFileSync(path.join(root, ".warden", "dashboard.json"), "utf8")) as { token: string };
      timer = setInterval(() => {
        if (polling) return;
        polling = true;
        void (async () => {
          for (const approval of readDashboard(root).approvals) {
            const response = await fetch(new URL(`/api/approvals/${String(approval.id)}`, server.url), { method: "POST",
              headers: { origin: server.url.slice(0, -1), "content-type": "application/json", "x-warden-token": token },
              body: JSON.stringify({ choice: "approved" }) });
            assert.equal(response.status, 200);
            choices.push(String(approval.target));
          }
        })().finally(() => { polling = false; });
      }, 25);
    },
  }).finally(() => { if (timer) clearInterval(timer); });
  try {
    assert.ok(choices.includes("AGENTS.md"));
    assert.equal(pauses.length, 4);
    assert.ok(result.trace.some((line) => line.startsWith("APPROVE") && line.includes("live dashboard")));
    assert.ok(!result.trace.some((line) => line.startsWith("REPLAY")));
    assert.deepEqual(result.protectedReceipts, []);
    const { token } = JSON.parse(readFileSync(path.join(result.protectedRoot, ".warden", "dashboard.json"), "utf8")) as { token: string };
    const incident = readDashboard(result.protectedRoot).incidents.find((item) => item.sessionId === "cline-day-2");
    assert.equal(incident?.status, "Closed");
    const report = await fetch(new URL(`/api/reports/${incident!.report}`, result.dashboard!.url), { headers: { "x-warden-token": token } });
    assert.equal(report.status, 200);
    assert.match(await report.text(), /No investigator or responder Cline SDK sessions were launched/);
  } finally { await result.dashboard?.close(); rmSync(result.protectedRoot, { recursive: true, force: true }); }
});