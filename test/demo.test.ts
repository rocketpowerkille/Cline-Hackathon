import assert from "node:assert/strict";
import test from "node:test";
import { runDemo } from "../demo/run-demo.js";

test("demo proves the leak without Warden and blocks it through real hook payloads", async () => {
  const result = await runDemo({ color: false, print: () => {} });
  assert.deepEqual(result.unprotectedReceipts, ["npm_demo_FAKE_TOKEN_not_real_12345"]);
  assert.deepEqual(result.protectedReceipts, []);
  assert.ok(result.trace.some((line) => line.startsWith("HOLD")));
  assert.ok(result.trace.some((line) => line.startsWith("BLOCK")));
  assert.match(result.replayFile, /replay-actions\.json$/);
});