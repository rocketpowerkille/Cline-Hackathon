import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Explicit Docker verification fails rather than passing with skipped tests or static-only evidence.
const result = spawnSync(process.execPath, [
  "--import", "./test/offline.mjs", "--import", "tsx", "--test", "--test-concurrency=1", "test/docker-sandbox.test.ts",
], {
  cwd: fileURLToPath(new URL("../", import.meta.url)),
  env: { ...process.env, WARDEN_REQUIRE_DOCKER: "1" },
  stdio: "inherit",
});
if (result.error) console.error(result.error.message);
process.exitCode = result.status ?? 1;