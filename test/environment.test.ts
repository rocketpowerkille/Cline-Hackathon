import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadRiskEnvironment } from "../src/config/environment.js";
import { tempWorkspace } from "./helpers.js";

test("package .env loads only Cloudflare risk settings and preserves explicit values", () => {
  const root = tempWorkspace();
  const environment: NodeJS.ProcessEnv = { CLOUDFLARE_ACCOUNT_ID: "explicit-account" };
  try {
    writeFileSync(path.join(root, ".env"), [
      "CLOUDFLARE_ACCOUNT_ID=dotenv-account",
      "CLOUDFLARE_API_TOKEN='scoped-token'",
      "NPM_TOKEN=must-not-enter-warden",
      "UNRELATED=value",
      "",
    ].join("\n"), "utf8");
    assert.deepEqual(loadRiskEnvironment(root, environment), ["CLOUDFLARE_API_TOKEN"]);
    assert.equal(environment.CLOUDFLARE_ACCOUNT_ID, "explicit-account");
    assert.equal(environment.CLOUDFLARE_API_TOKEN, "scoped-token");
    assert.equal(environment.NPM_TOKEN, undefined);
    assert.equal(environment.UNRELATED, undefined);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("missing or malformed package .env fails safely", () => {
  const root = tempWorkspace();
  try {
    const environment: NodeJS.ProcessEnv = {};
    assert.deepEqual(loadRiskEnvironment(root, environment), []);
    writeFileSync(path.join(root, ".env"), "CLOUDFLARE_API_TOKEN='unterminated\n", "utf8");
    assert.deepEqual(loadRiskEnvironment(root, environment), []);
    assert.deepEqual(environment, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});