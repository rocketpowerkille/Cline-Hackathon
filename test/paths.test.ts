import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { wardenStatePath, workspacePath } from "../src/core/paths.js";

test("workspacePath resolves and normalizes a target", () => {
  const root = path.resolve("fixture-repo");
  const result = workspacePath(root, path.join("src", "index.ts"));

  assert.equal(result.absolute, path.join(root, "src", "index.ts"));
  assert.equal(result.relative, path.join("src", "index.ts"));
  assert.equal(result.match, "src/index.ts");
});

test("wardenStatePath keeps state inside .warden", () => {
  const root = path.resolve("fixture-repo");
  assert.equal(wardenStatePath(root, "warden.db"), path.join(root, ".warden", "warden.db"));
});