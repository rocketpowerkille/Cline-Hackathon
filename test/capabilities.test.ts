import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import test from "node:test";
import { capabilityCatalog } from "../demo/capabilities-model.js";
import { capabilitiesPage, capabilitiesScript } from "../demo/capabilities-page.js";
import { ASK_BUDGET, BLOCK_BUDGET, budgetIncrement } from "../src/policy/risk.js";

test("capability catalog covers implemented layers with existing regression references and visible limitations", () => {
  const catalog = capabilityCatalog.capabilities;
  assert.equal(catalog.length, 12);
  assert.equal(new Set(catalog.map((cap) => cap.id)).size, 12);
  assert.deepEqual(new Set(catalog.map((cap) => cap.layer)), new Set(["Observe", "Decide", "Protect", "Recover", "Operate"]));
  for (const cap of catalog) {
    assert.equal(cap.flow.length, 4);
    assert.equal(cap.features.length, 4);
    assert.ok(cap.boundary.length > 50);
    for (const filename of cap.tests) assert.ok(existsSync(fileURLToPath(new URL(`../${filename}`, import.meta.url))), filename);
  }
  for (const id of capabilityCatalog.pipeline) assert.ok(catalog.some((cap) => cap.id === id));
  assert.match(catalog.find((cap) => cap.id === "response")!.boundary, /real exposed keys remain OPEN/);
  assert.match(catalog.find((cap) => cap.id === "hooks")!.boundary, /fail open/);
  assert.match(catalog.find((cap) => cap.id === "sandbox")!.boundary, /Static fallback cannot certify/);
  assert.equal(capabilityCatalog.risk.ask, ASK_BUDGET);
  assert.equal(capabilityCatalog.risk.block, BLOCK_BUDGET);
  assert.ok(Math.abs(budgetIncrement(0.12, "write") * 10 - 1.2783337151) < 0.000001);
  assert.equal(budgetIncrement(0.12, "read"), budgetIncrement(0.12, "write") * capabilityCatalog.risk.readWeight);
  new Script(capabilitiesScript);
  assert.match(capabilitiesPage, /ILLUSTRATIVE \/ NO ENGINE CALL/);
});