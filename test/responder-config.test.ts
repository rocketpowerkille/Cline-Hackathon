import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { responderConfiguration } from "../src/config/responder.js";
import { loadRiskEnvironment } from "../src/config/environment.js";
import { tempWorkspace } from "./helpers.js";

test("OpenAI responder loads package .env without mutating environment or exposing credentials to hooks", () => {
  const root = tempWorkspace();
  try {
    writeFileSync(path.join(root, ".env"), "WARDEN_RESPONDER_PROVIDER=openai-native\nWARDEN_RESPONDER_MODEL=gpt-4.1-mini\nOPENAI_API_KEY=fake-openai\nNPM_TOKEN=unrelated\n");
    const env: NodeJS.ProcessEnv = {};
    assert.deepEqual(responderConfiguration(root, env), { providerId: "openai-native", modelId: "gpt-4.1-mini", apiKey: "fake-openai" });
    assert.deepEqual(env, {});
    assert.deepEqual(loadRiskEnvironment(root, env), []);
    assert.deepEqual(env, {});
    assert.deepEqual(responderConfiguration(root, { WARDEN_RESPONDER_PROVIDER: "openai", WARDEN_RESPONDER_MODEL: "custom-model", WARDEN_RESPONDER_API_KEY: "explicit-fake" }),
      { providerId: "openai-native", modelId: "custom-model", apiKey: "explicit-fake" });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("responder refuses missing/mismatched keys and unsafe config with content-free errors", () => {
  const root = tempWorkspace();
  try {
    assert.throws(() => responderConfiguration(root, { WARDEN_RESPONDER_PROVIDER: "openai-native", ANTHROPIC_API_KEY: "wrong-provider" }), /needs OPENAI_API_KEY/);
    assert.deepEqual(responderConfiguration(root, { ANTHROPIC_API_KEY: "fake-anthropic" }), { providerId: "anthropic", modelId: "claude-sonnet-4-6", apiKey: "fake-anthropic" });
    assert.throws(() => responderConfiguration(root, { OPENAI_API_KEY: "fake\nsecret", WARDEN_RESPONDER_PROVIDER: "openai-native" }), /Invalid multiline/);
    assert.throws(() => responderConfiguration(root, { WARDEN_RESPONDER_PROVIDER: "other", WARDEN_RESPONDER_API_KEY: "fake" }), /Set WARDEN_RESPONDER_MODEL/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});