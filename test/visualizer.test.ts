import assert from "node:assert/strict";
import { Script } from "node:vm";
import { request } from "node:http";
import test from "node:test";
import { runDemo } from "../demo/run-demo.js";
import { buildVisualizerReplay } from "../demo/visualizer-model.js";
import { visualizerPage, visualizerScript } from "../demo/visualizer-page.js";
import { startVisualizer } from "../demo/visualizer-server.js";
import { capabilityCatalog } from "../demo/capabilities-model.js";
import { capabilitiesPage } from "../demo/capabilities-page.js";

test("visualizer serves actual offline evidence, redacts the fake token, and rejects mutations and hostile hosts", async () => {
  const result = await runDemo({ color: false, cleanup: true, forceNodeFallback: true, print: () => {} });
  const replay = buildVisualizerReplay(result, "2026-10-04T00:00:00.000Z");
  assert.equal(replay.evidence, "executed-offline-demo");
  assert.deepEqual([...new Set(replay.events.map((event) => event.chapter))], ["unprotected", "protected", "recovery"]);
  assert.equal(replay.events.length, result.trace.length);
  assert.equal(replay.summary.unprotectedLeaks, 1);
  assert.equal(replay.summary.protectedLeaks, 0);
  assert.equal(replay.summary.mockRotations, 1);
  assert.equal(replay.summary.incidentClosed, true);
  assert.ok(!JSON.stringify(replay).includes("npm_demo_FAKE_TOKEN"));
  assert.ok(!JSON.stringify(replay).includes(result.protectedRoot));
  assert.ok(replay.events.some((event) => event.status === "SANDBOX" && event.node === "sandbox"));
  assert.ok(replay.events.some((event) => event.status === "ROTATE" && event.node === "recovery"));
  assert.throws(() => buildVisualizerReplay({ ...result, trace: ["not a trace"] }), /Unexpected/);
  assert.throws(() => buildVisualizerReplay({ ...result, trace: result.trace.filter((line) => !line.startsWith("CLOSED")) }), /Incomplete/);
  new Script(visualizerScript);
  const viewer = await startVisualizer(replay);
  try {
    const page = await fetch(viewer.url);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), visualizerPage);
    assert.match(page.headers.get("content-security-policy")!, /script-src 'self'/);
    assert.equal(page.headers.get("cache-control"), "no-store");
    const data = await fetch(new URL("api/replay", viewer.url));
    assert.deepEqual(await data.json(), replay);
    const catalog = await fetch(new URL("api/capabilities", viewer.url));
    assert.deepEqual(await catalog.json(), capabilityCatalog);
    assert.equal(await (await fetch(new URL("capabilities", viewer.url))).text(), capabilitiesPage);
    for (const route of ["capabilities.js", "capabilities.css"]) assert.equal((await fetch(new URL(route, viewer.url))).status, 200);
    assert.equal((await fetch(new URL("api/capabilities", viewer.url), { method: "POST" })).status, 405);
    for (const route of ["app.js", "style.css"]) assert.equal((await fetch(new URL(route, viewer.url))).status, 200);
    assert.equal((await fetch(viewer.url, { method: "POST" })).status, 405);
    const hostileHostStatus = await new Promise<number>((resolve, reject) => {
      const call = request(viewer.url, { headers: { Host: "attacker.invalid" } }, (response) => {
        response.resume();
        resolve(response.statusCode!);
      });
      call.on("error", reject);
      call.end();
    });
    assert.equal(hostileHostStatus, 403);
    assert.equal((await fetch(viewer.url, { headers: { Origin: "https://attacker.invalid" } })).status, 403);
    assert.equal((await fetch(viewer.url, { headers: { "Sec-Fetch-Site": "cross-site" } })).status, 403);
    assert.equal((await fetch(new URL("api/run", viewer.url))).status, 404);
  } finally { await viewer.close(); }
});